package synologyfilesworker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/pullworker"
	"github.com/lazyxu/xdrive/internal/sourcecredential"
	"github.com/lazyxu/xdrive/internal/synology"
	"github.com/lazyxu/xdrive/internal/synologyfilesync"
	"gorm.io/gorm"
)

type RemoteSession interface {
	synologyfilesync.Remote
	synologyfilesync.DownloadRemote
	Close(context.Context) error
}

type RemoteFactory func(context.Context, synology.Credential) (RemoteSession, error)

type Runner struct {
	DB            *gorm.DB
	Keyring       *connectorsecret.Keyring
	ServerURL     string
	JWTSecret     string
	RemoteFactory RemoteFactory
	Logger        *slog.Logger
}

func (r *Runner) RunPullSource(ctx context.Context, source meta.Source) (client.SyncRun, error) {
	run, _, err := r.RunSource(ctx, source)
	return run, err
}

func (r *Runner) PullSourceConcurrencyKey(ctx context.Context, source meta.Source) string {
	if r == nil || r.DB == nil || r.Keyring == nil {
		return ""
	}
	plaintext, err := sourcecredential.Get(ctx, r.DB, r.Keyring, source)
	if err != nil {
		return ""
	}
	defer clear(plaintext)
	var credential synology.Credential
	if err := json.Unmarshal(plaintext, &credential); err != nil {
		return ""
	}
	key := synology.AccountConcurrencyKey(credential)
	credential.Password = ""
	return key
}

func (r *Runner) RunSource(ctx context.Context, source meta.Source) (client.SyncRun, synologyfilesync.Result, error) {
	var result synologyfilesync.Result
	if err := r.validate(); err != nil {
		return client.SyncRun{}, result, err
	}

	session, err := pullworker.BeginRunSession(ctx, r.DB, r.ServerURL, r.JWTSecret, source, synologyfilesync.SourceKind)
	if err != nil {
		return client.SyncRun{}, result, err
	}
	defer session.Close()
	run := session.Run
	runCtx := session.Context
	api := session.API

	finishFailure := func(cause error, summaryFailed bool) (client.SyncRun, synologyfilesync.Result, error) {
		finished, finishErr := session.FinishFailure(cause, &result.Summary, summaryFailed, sourceErrorMessage(cause))
		if finishErr != nil {
			return client.SyncRun{}, result, errors.Join(cause, finishErr)
		}
		return finished, result, cause
	}

	plaintext, err := sourcecredential.Get(runCtx, r.DB, r.Keyring, source)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return finishFailure(fmt.Errorf("Synology File Station source credential is not configured"), true)
		}
		return finishFailure(fmt.Errorf("load Synology File Station credential: %w", err), true)
	}
	defer clear(plaintext)

	var credential synology.Credential
	if err := json.Unmarshal(plaintext, &credential); err != nil {
		return finishFailure(fmt.Errorf("decode Synology File Station credential: %w", err), true)
	}
	remote, err := r.remoteFactory()(runCtx, credential)
	credential.Password = ""
	if err != nil {
		return finishFailure(fmt.Errorf("connect Synology File Station: %w", err), true)
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := remote.Close(closeCtx); err != nil {
			r.logger().Warn("synology_files_logout_failed", "source_id", source.ID, "error", err)
		}
	}()

	roots, err := r.loadRoots(runCtx, source.ID)
	if err != nil {
		return finishFailure(fmt.Errorf("load Synology File Station connector config: %w", err), true)
	}

	var executor synologyfilesync.PlanExecutor
	if run.Mode == meta.SourceRunModeSync {
		if run.TargetNodeID == nil || *run.TargetNodeID == 0 {
			return finishFailure(fmt.Errorf("Synology File Station sync target is unavailable"), true)
		}
		fileExecutor := synologyfilesync.NewExecutor(remote, pullworker.NewExecutionAPI(api), *run.TargetNodeID)
		fileExecutor.Heartbeat = func(heartbeatCtx context.Context) error {
			return api.HeartbeatSourceRun(heartbeatCtx, source.ID, run.ID)
		}
		fileExecutor.Progress = func(progressCtx context.Context, itemPath string, done, total int64) error {
			return api.UpdateSourceRunTransferProgress(progressCtx, source.ID, run.ID, itemPath, done, total)
		}
		executor = fileExecutor
	}

	result, err = (synologyfilesync.Scanner{
		Remote:      remote,
		API:         api,
		SourceID:    source.ID,
		RunID:       run.ID,
		IgnoreRules: run.IgnoreRules,
		Mode:        run.Mode,
		Roots:       roots,
		Executor:    executor,
	}).Scan(runCtx)
	if err != nil {
		return finishFailure(err, true)
	}

	finished, err := session.FinishSuccess(result.Summary, strings.Join(result.Errors, "\n"))
	if err != nil {
		return client.SyncRun{}, result, err
	}
	if finished.Status != meta.SyncRunStatusCompleted {
		return finished, result, fmt.Errorf("Synology File Station pull run finished %s with %d failed items", finished.Status, finished.FailedItems)
	}
	return finished, result, nil
}

func (r *Runner) loadRoots(ctx context.Context, sourceID uint64) ([]string, error) {
	var row meta.SourceConnectorConfig
	if err := r.DB.WithContext(ctx).Where("source_id = ?", sourceID).First(&row).Error; err != nil {
		return nil, err
	}
	config, err := synology.ParseFilePullConfig([]byte(row.Payload))
	if err != nil {
		return nil, err
	}
	return append([]string(nil), config.Roots...), nil
}

func (r *Runner) validate() error {
	if r == nil || r.DB == nil || r.Keyring == nil {
		return fmt.Errorf("Synology File Station worker database/keyring is unavailable")
	}
	if strings.TrimSpace(r.ServerURL) == "" || strings.TrimSpace(r.JWTSecret) == "" {
		return fmt.Errorf("Synology File Station worker server URL and JWT secret are required")
	}
	return nil
}

func (r *Runner) remoteFactory() RemoteFactory {
	if r.RemoteFactory != nil {
		return r.RemoteFactory
	}
	return func(ctx context.Context, credential synology.Credential) (RemoteSession, error) {
		client, err := synology.New(credential)
		if err != nil {
			return nil, err
		}
		return client.ConnectFileStation(ctx)
	}
}

func (r *Runner) logger() *slog.Logger {
	if r != nil && r.Logger != nil {
		return r.Logger
	}
	return slog.Default()
}

func (r *Runner) ClassifyPullRetry(err error) pullworker.RetryClass {
	switch {
	case err == nil, errors.Is(err, context.Canceled):
		return pullworker.RetryNone
	case errors.Is(err, synology.ErrMultipleLogin):
		return pullworker.RetryRateLimited
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, synology.ErrSessionExpired):
		return pullworker.RetryTransient
	case errors.Is(err, synology.ErrAuthentication),
		errors.Is(err, synology.ErrHTTPForbidden),
		errors.Is(err, synology.ErrPermissionDenied),
		errors.Is(err, synology.ErrOTPRequired),
		errors.Is(err, synology.ErrFileStationMissing),
		errors.Is(err, synology.ErrFileStationOperation):
		return pullworker.RetryNone
	case errors.Is(err, synology.ErrUnavailable):
		var dsmErr *synology.DSMAPIError
		if errors.As(err, &dsmErr) && dsmErr.Code == 402 {
			return pullworker.RetryTransient
		}
		diagnostic := synology.DiagnoseConnectionError(err)
		switch diagnostic.Code {
		case "synology_timeout",
			"synology_dns_failed",
			"synology_connection_refused",
			"synology_network_unreachable",
			"synology_unavailable":
			return pullworker.RetryTransient
		default:
			return pullworker.RetryNone
		}
	default:
		return pullworker.RetryNone
	}
}

func sourceErrorMessage(err error) string {
	switch {
	case errors.Is(err, context.Canceled):
		return "来源运行已取消"
	case errors.Is(err, context.DeadlineExceeded):
		return "群晖 File Station 连接或同步超时"
	case errors.Is(err, synology.ErrMultipleLogin):
		return "Synology DSM 检测到重复登录，请稍后重试并检查是否有多个程序同时使用同一账号"
	case errors.Is(err, synology.ErrPermissionDenied):
		return "Synology DSM 账号没有访问所选 File Station 路径的权限"
	case errors.Is(err, synology.ErrOTPRequired):
		return "Synology DSM 要求两步验证/OTP，当前连接器尚未提供 OTP"
	case errors.Is(err, synology.ErrAuthentication):
		return "Synology DSM 登录失败，请检查账号状态或重新保存凭据"
	case errors.Is(err, synology.ErrHTTPForbidden):
		return "Synology DSM 或应用入口返回 HTTP 403；这不代表密码错误，请检查登录门户/反向代理、来源 IP 限制和应用访问权限"
	case errors.Is(err, synology.ErrFileStationMissing):
		return "Synology File Station API 不可用，请确认 DSM File Station 服务可用"
	case errors.Is(err, synology.ErrFileStationOperation):
		return "Synology File Station 文件操作失败，请检查远端路径和权限"
	case errors.Is(err, synology.ErrUnavailable):
		return "Synology DSM 暂时不可用，请稍后重试"
	default:
		value := strings.TrimSpace(err.Error())
		if len(value) > 4096 {
			value = value[:4096]
		}
		return value
	}
}
