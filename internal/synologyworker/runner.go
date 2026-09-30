package synologyworker

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
	"github.com/lazyxu/xdrive/internal/sourcecollection"
	"github.com/lazyxu/xdrive/internal/sourcecredential"
	"github.com/lazyxu/xdrive/internal/sourcemetadata"
	"github.com/lazyxu/xdrive/internal/synology"
	"github.com/lazyxu/xdrive/internal/synologysync"
	"gorm.io/gorm"
)

type RemoteSession interface {
	synologysync.Remote
	synologysync.DownloadRemote
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

func (r *Runner) RunSource(ctx context.Context, source meta.Source) (client.SyncRun, synologysync.Result, error) {
	var result synologysync.Result
	if err := r.validate(); err != nil {
		return client.SyncRun{}, result, err
	}

	session, err := pullworker.BeginRunSession(ctx, r.DB, r.ServerURL, r.JWTSecret, source, synologysync.SourceKind)
	if err != nil {
		return client.SyncRun{}, result, err
	}
	defer session.Close()
	run := session.Run
	runCtx := session.Context
	api := session.API

	finishFailure := func(cause error, summaryFailed bool) (client.SyncRun, synologysync.Result, error) {
		finished, finishErr := session.FinishFailure(cause, &result.Summary, summaryFailed, sourceErrorMessage(cause))
		if finishErr != nil {
			return client.SyncRun{}, result, errors.Join(cause, finishErr)
		}
		return finished, result, cause
	}

	plaintext, err := sourcecredential.Get(runCtx, r.DB, r.Keyring, source)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return finishFailure(fmt.Errorf("Synology source credential is not configured"), true)
		}
		return finishFailure(fmt.Errorf("load Synology credential: %w", err), true)
	}
	defer clear(plaintext)

	var credential synology.Credential
	if err := json.Unmarshal(plaintext, &credential); err != nil {
		return finishFailure(fmt.Errorf("decode Synology credential: %w", err), true)
	}
	remote, err := r.remoteFactory()(runCtx, credential)
	credential.Password = ""
	if err != nil {
		return finishFailure(fmt.Errorf("connect Synology Photos: %w", err), true)
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := remote.Close(closeCtx); err != nil {
			r.logger().Warn("synology_source_logout_failed", "source_id", source.ID, "error", err)
		}
	}()

	spaces, err := r.loadSpaces(runCtx, source.ID)
	if err != nil {
		return finishFailure(fmt.Errorf("load Synology connector config: %w", err), true)
	}

	var executor synologysync.PlanExecutor
	if run.Mode == meta.SourceRunModeSync {
		if run.TargetNodeID == nil || *run.TargetNodeID == 0 {
			return finishFailure(fmt.Errorf("Synology sync target is unavailable"), true)
		}
		synologyExecutor := synologysync.NewExecutor(remote, pullworker.NewExecutionAPI(api), *run.TargetNodeID)
		synologyExecutor.Heartbeat = func(heartbeatCtx context.Context) error {
			return api.HeartbeatSourceRun(heartbeatCtx, source.ID, run.ID)
		}
		synologyExecutor.Progress = func(progressCtx context.Context, itemPath string, done, total int64) error {
			return api.UpdateSourceRunTransferProgress(progressCtx, source.ID, run.ID, itemPath, done, total)
		}
		executor = synologyExecutor
	}

	result, err = (synologysync.Scanner{
		Remote:      remote,
		API:         api,
		SourceID:    source.ID,
		RunID:       run.ID,
		IgnoreRules: run.IgnoreRules,
		Mode:        run.Mode,
		Spaces:      spaces,
		Executor:    executor,
	}).Scan(runCtx)
	if err != nil {
		return finishFailure(err, true)
	}
	if result.CollectionsComplete {
		if _, err := sourcecollection.ApplySnapshot(runCtx, r.DB, source.ID, run.ID, result.Collections); err != nil {
			return finishFailure(fmt.Errorf("apply Synology album snapshot: %w", err), true)
		}
	}
	if _, err := sourcemetadata.ApplySnapshot(runCtx, r.DB, source.ID, run.ID, result.Metadata); err != nil {
		return finishFailure(fmt.Errorf("apply Synology media metadata snapshot: %w", err), true)
	}

	finished, err := session.FinishSuccess(result.Summary, strings.Join(result.Errors, "\n"))
	if err != nil {
		return client.SyncRun{}, result, err
	}
	if finished.Status != meta.SyncRunStatusCompleted {
		return finished, result, fmt.Errorf("Synology pull run finished %s with %d failed items", finished.Status, finished.FailedItems)
	}
	return finished, result, nil
}

func (r *Runner) loadSpaces(ctx context.Context, sourceID uint64) ([]synology.Space, error) {
	var row meta.SourceConnectorConfig
	err := r.DB.WithContext(ctx).Where("source_id = ?", sourceID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return append([]synology.Space(nil), synology.DefaultPullConfig().Spaces...), nil
	}
	if err != nil {
		return nil, err
	}
	config, err := synology.ParsePullConfig([]byte(row.Payload))
	if err != nil {
		return nil, err
	}
	return append([]synology.Space(nil), config.Spaces...), nil
}

func (r *Runner) validate() error {
	if r == nil || r.DB == nil || r.Keyring == nil {
		return fmt.Errorf("Synology worker database/keyring is unavailable")
	}
	if strings.TrimSpace(r.ServerURL) == "" || strings.TrimSpace(r.JWTSecret) == "" {
		return fmt.Errorf("Synology worker server URL and JWT secret are required")
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
		return client.Connect(ctx)
	}
}

func (r *Runner) logger() *slog.Logger {
	if r != nil && r.Logger != nil {
		return r.Logger
	}
	return slog.Default()
}

func sourceErrorMessage(err error) string {
	switch {
	case errors.Is(err, context.Canceled):
		return "来源运行已取消"
	case errors.Is(err, context.DeadlineExceeded):
		return "群晖 Photos 连接或同步超时"
	case errors.Is(err, synology.ErrMultipleLogin):
		return "Synology DSM 检测到重复登录，请稍后重试并检查是否有多个程序同时使用同一账号"
	case errors.Is(err, synology.ErrPermissionDenied):
		return "Synology DSM 账号没有访问 Synology Photos 所需权限"
	case errors.Is(err, synology.ErrOTPRequired):
		return "Synology DSM 要求两步验证/OTP，当前连接器尚未提供 OTP"
	case errors.Is(err, synology.ErrAuthentication):
		return "Synology DSM 登录失败，请检查账号状态或重新保存凭据"
	case errors.Is(err, synology.ErrPhotosMissing):
		return "Synology Photos API 不可用，请确认已安装并启用 Synology Photos"
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
