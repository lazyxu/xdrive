package yikeworker

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
	"github.com/lazyxu/xdrive/internal/sourceschedule"
	"github.com/lazyxu/xdrive/internal/yike"
	"github.com/lazyxu/xdrive/internal/yikesync"
	"gorm.io/gorm"
)

const DefaultRunInterval = 6 * time.Hour

type RemoteFactory func(cookie string) (yikesync.Remote, error)

type Runner struct {
	DB            *gorm.DB
	Keyring       *connectorsecret.Keyring
	ServerURL     string
	JWTSecret     string
	RemoteFactory RemoteFactory
	Logger        *slog.Logger
}

type RunAllReport struct {
	Eligible  int
	Completed int
	Skipped   int
	Failed    int
}

func (r *Runner) RunAll(ctx context.Context) (RunAllReport, error) {
	sources, err := r.loadSources(ctx, false, time.Time{}, 0)
	if err != nil {
		return RunAllReport{}, err
	}
	return r.runSources(ctx, sources, time.Now().UTC())
}

func (r *Runner) RunDue(ctx context.Context, now time.Time, interval time.Duration) (RunAllReport, error) {
	if interval <= 0 {
		interval = DefaultRunInterval
	}
	sources, err := r.loadSources(ctx, true, now.UTC(), interval)
	if err != nil {
		return RunAllReport{}, err
	}
	return r.runSources(ctx, sources, now.UTC())
}

func (r *Runner) loadSources(ctx context.Context, dueOnly bool, now time.Time, interval time.Duration) ([]meta.Source, error) {
	if err := r.validate(); err != nil {
		return nil, err
	}
	query := r.DB.WithContext(ctx).
		Model(&meta.Source{}).
		Where("xd_sources.kind = ? AND xd_sources.direction = ? AND xd_sources.status = ? AND xd_sources.sync_mode = ?",
			yikesync.SourceKind, meta.SourceDirectionPull, meta.SourceStatusActive, meta.SourceSyncModeBackup)
	var sources []meta.Source
	if err := query.Order("xd_sources.id ASC").Find(&sources).Error; err != nil {
		return nil, err
	}
	if !dueOnly {
		return sources, nil
	}
	due := make([]meta.Source, 0, len(sources))
	for _, source := range sources {
		isDue, err := sourceschedule.Due(source, now, interval)
		if err != nil {
			return nil, fmt.Errorf("source %d schedule: %w", source.ID, err)
		}
		if isDue {
			due = append(due, source)
		}
	}
	return due, nil
}

func (r *Runner) runSources(ctx context.Context, sources []meta.Source, now time.Time) (RunAllReport, error) {
	report := RunAllReport{Eligible: len(sources)}
	var errs []error
	for _, source := range sources {
		if err := ctx.Err(); err != nil {
			return report, err
		}
		run, result, err := r.RunSource(ctx, source)
		if err != nil {
			if pullworker.IsActiveRun(err) {
				report.Skipped++
				r.logger().Info("yike_source_skipped_active_run",
					"source_id", source.ID,
					"source_name", source.Name,
				)
				continue
			}
			if run.ID == "" && !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
				if recordErr := r.recordPreflightFailure(ctx, source.ID, time.Now().UTC(), err); recordErr != nil {
					err = errors.Join(err, fmt.Errorf("record source preflight failure: %w", recordErr))
				}
			}
			report.Failed++
			errs = append(errs, fmt.Errorf("source %d (%s): %w", source.ID, source.Name, err))
			r.logger().Error("yike_source_pull_failed",
				"source_id", source.ID,
				"source_name", source.Name,
				"error", err,
			)
			continue
		}
		report.Completed++
		r.logger().Info("yike_source_pull_completed",
			"source_id", source.ID,
			"source_name", source.Name,
			"run_id", run.ID,
			"status", run.Status,
			"scanned_items", run.ScannedItems,
			"planned_transfer_items", run.PlannedTransferItems,
			"planned_transfer_bytes", run.PlannedTransferBytes,
			"transferred_items", run.TransferredItems,
			"transferred_bytes", run.TransferredBytes,
			"missing_items", run.MissingItems,
			"albums", result.Albums,
			"root_items", result.RootItems,
			"album_memberships", result.AlbumMemberships,
			"duplicate_memberships", result.DuplicateMemberships,
			"shared_items", result.SharedItems,
		)
	}
	return report, errors.Join(errs...)
}

func (r *Runner) recordPreflightFailure(ctx context.Context, sourceID uint64, now time.Time, cause error) error {
	if sourceID == 0 || cause == nil {
		return nil
	}
	return r.DB.WithContext(ctx).Model(&meta.Source{}).Where("id = ?", sourceID).Updates(map[string]any{
		"last_run_at":      now,
		"last_error":       sourceErrorMessage(cause),
		"run_requested_at": nil,
		"updated_at":       now,
	}).Error
}

func (r *Runner) RunSource(ctx context.Context, source meta.Source) (client.SyncRun, yikesync.Result, error) {
	var result yikesync.Result
	if err := r.validate(); err != nil {
		return client.SyncRun{}, result, err
	}
	if source.ID == 0 || source.Kind != yikesync.SourceKind ||
		source.Direction != meta.SourceDirectionPull ||
		source.SyncMode != meta.SourceSyncModeBackup ||
		source.Status != meta.SourceStatusActive ||
		!meta.ValidSourceRunMode(source.RunMode) {
		return client.SyncRun{}, result, fmt.Errorf("source %d is not an active Yike pull source", source.ID)
	}

	session, err := pullworker.BeginRunSession(ctx, r.DB, r.ServerURL, r.JWTSecret, source, yikesync.SourceKind)
	if err != nil {
		return client.SyncRun{}, result, err
	}
	defer session.Close()
	run := session.Run
	runCtx := session.Context
	api := session.API

	finishFailure := func(cause error, summaryFailed bool) (client.SyncRun, yikesync.Result, error) {
		finished, finishErr := session.FinishFailure(cause, &result.Summary, summaryFailed, sourceErrorMessage(cause))
		if finishErr != nil {
			return client.SyncRun{}, result, errors.Join(cause, finishErr)
		}
		return finished, result, cause
	}

	credentialPlaintext, err := sourcecredential.Get(runCtx, r.DB, r.Keyring, source)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return finishFailure(fmt.Errorf("Yike source credential is not configured"), true)
		}
		return finishFailure(fmt.Errorf("load Yike credential: %w", err), true)
	}
	defer clear(credentialPlaintext)
	var credential struct {
		Cookie string `json:"cookie"`
	}
	if err := json.Unmarshal(credentialPlaintext, &credential); err != nil {
		return finishFailure(fmt.Errorf("decode Yike credential: %w", err), true)
	}
	credential.Cookie = strings.TrimSpace(credential.Cookie)
	if credential.Cookie == "" {
		return finishFailure(fmt.Errorf("Yike credential cookie is empty"), true)
	}

	remote, err := r.remoteFactory()(credential.Cookie)
	credential.Cookie = ""
	if err != nil {
		return finishFailure(fmt.Errorf("initialize Yike client: %w", err), true)
	}

	var executor yikesync.PlanExecutor
	if run.Mode == meta.SourceRunModeSync {
		if run.TargetNodeID == nil || *run.TargetNodeID == 0 {
			return finishFailure(fmt.Errorf("Yike sync target is unavailable"), true)
		}
		transferRemote, ok := remote.(yikesync.DownloadRemote)
		if !ok {
			return finishFailure(fmt.Errorf("Yike remote does not support media streaming"), true)
		}
		yikeExecutor := yikesync.NewExecutor(transferRemote, pullworker.NewExecutionAPI(api), *run.TargetNodeID)
		yikeExecutor.Heartbeat = func(heartbeatCtx context.Context) error {
			return api.HeartbeatSourceRun(heartbeatCtx, source.ID, run.ID)
		}
		yikeExecutor.Progress = func(progressCtx context.Context, path string, done, total int64) error {
			return api.UpdateSourceRunTransferProgress(progressCtx, source.ID, run.ID, path, done, total)
		}
		executor = yikeExecutor
	}

	targetNodeID := uint64(0)
	if run.TargetNodeID != nil {
		targetNodeID = *run.TargetNodeID
	}
	result, err = (yikesync.Scanner{
		Remote:       remote,
		API:          api,
		SourceID:     source.ID,
		RunID:        run.ID,
		TargetNodeID: targetNodeID,
		IgnoreRules:  run.IgnoreRules,
		Mode:         run.Mode,
		Executor:     executor,
	}).ScanFull(runCtx)
	if err != nil {
		return finishFailure(err, !errors.Is(err, yike.ErrRateLimited))
	}

	if _, err := sourcemetadata.ApplySnapshot(runCtx, r.DB, source.ID, run.ID, result.Metadata); err != nil {
		return finishFailure(fmt.Errorf("apply Yike media metadata snapshot: %w", err), true)
	}
	if _, err := sourcecollection.ApplySnapshot(runCtx, r.DB, source.ID, run.ID, result.Collections); err != nil {
		return finishFailure(fmt.Errorf("apply Yike collection snapshot: %w", err), true)
	}

	finished, err := session.FinishSuccess(result.Summary, strings.Join(result.Errors, "\n"))
	if err != nil {
		return client.SyncRun{}, result, err
	}
	if finished.Status != meta.SyncRunStatusCompleted {
		return finished, result, fmt.Errorf("Yike pull run finished %s with %d failed items", finished.Status, finished.FailedItems)
	}
	return finished, result, nil
}

func (r *Runner) RunPullSource(ctx context.Context, source meta.Source) (client.SyncRun, error) {
	run, _, err := r.RunSource(ctx, source)
	return run, err
}

func (*Runner) PullSourceChangeCapabilities() pullworker.ChangeScanCapabilities {
	return pullworker.FullReconciliationOnly()
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
	var credential struct {
		Cookie string `json:"cookie"`
	}
	if err := json.Unmarshal(plaintext, &credential); err != nil {
		return ""
	}
	cookie := strings.TrimSpace(credential.Cookie)
	credential.Cookie = ""
	if cookie == "" {
		return ""
	}
	return yike.AccountConcurrencyKey(cookie)
}

func (r *Runner) validate() error {
	if r == nil || r.DB == nil || r.Keyring == nil {
		return fmt.Errorf("Yike worker database/keyring is unavailable")
	}
	if strings.TrimSpace(r.ServerURL) == "" || strings.TrimSpace(r.JWTSecret) == "" {
		return fmt.Errorf("Yike worker server URL and JWT secret are required")
	}
	return nil
}

func (r *Runner) remoteFactory() RemoteFactory {
	if r.RemoteFactory != nil {
		return r.RemoteFactory
	}
	return func(cookie string) (yikesync.Remote, error) {
		return yike.New(cookie)
	}
}

func (r *Runner) logger() *slog.Logger {
	if r.Logger != nil {
		return r.Logger
	}
	return slog.Default()
}

func isSourceRunCancellationRequested(err error) bool {
	return pullworker.IsCancellationRequested(err)
}

func (r *Runner) ClassifyPullRetry(err error) pullworker.RetryClass {
	switch {
	case err == nil, errors.Is(err, context.Canceled):
		return pullworker.RetryNone
	case errors.Is(err, yike.ErrRateLimited):
		return pullworker.RetryRateLimitedCooldown
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, yike.ErrUnavailable):
		return pullworker.RetryTransient
	default:
		return pullworker.RetryNone
	}
}

func sourceErrorMessage(err error) string {
	switch {
	case errors.Is(err, context.Canceled):
		return "来源运行已取消"
	case errors.Is(err, yike.ErrAuthentication):
		return "一刻相册登录已失效，请更新 Cookie"
	case errors.Is(err, yike.ErrRateLimited):
		return "一刻相册请求过于频繁，已暂停本轮并进入冷却，稍后自动续跑"
	case errors.Is(err, yike.ErrUnavailable):
		return "一刻相册服务暂时不可用，请稍后重试"
	default:
		return truncateError(err)
	}
}

func truncateError(err error) string {
	if err == nil {
		return ""
	}
	value := strings.TrimSpace(err.Error())
	if len(value) <= 4096 {
		return value
	}
	return value[:4096]
}
