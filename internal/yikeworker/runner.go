package yikeworker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourcecollection"
	"github.com/lazyxu/xdrive/internal/sourcecredential"
	"github.com/lazyxu/xdrive/internal/yike"
	"github.com/lazyxu/xdrive/internal/yikesync"
	"gorm.io/gorm"
)

const (
	internalTokenTTL   = 12 * time.Hour
	DefaultRunInterval = 6 * time.Hour
)

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
	if dueOnly {
		query = query.Where("xd_sources.last_run_at IS NULL OR xd_sources.last_run_at <= ?", now.Add(-interval))
	}
	var sources []meta.Source
	if err := query.Order("xd_sources.id ASC").Find(&sources).Error; err != nil {
		return nil, err
	}
	return sources, nil
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
			if isActiveRun(err) {
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
		"last_run_at": now,
		"last_error":  truncateError(cause),
		"updated_at":  now,
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

	var owner meta.User
	if err := r.DB.WithContext(ctx).First(&owner, source.OwnerID).Error; err != nil {
		return client.SyncRun{}, result, err
	}
	if owner.DisabledAt != nil {
		return client.SyncRun{}, result, fmt.Errorf("source owner account is disabled")
	}
	if owner.MustChangePassword {
		return client.SyncRun{}, result, fmt.Errorf("source owner must change password before scheduled scans")
	}

	api := &ownerSourceAPI{
		serverURL: strings.TrimRight(strings.TrimSpace(r.ServerURL), "/"),
		auth:      auth.New(r.JWTSecret, internalTokenTTL),
		owner:     owner,
	}
	runID := uuid.NewString()
	run, err := api.BeginSourceRun(ctx, source.ID, runID, meta.SyncRunTriggerScheduled)
	if err != nil {
		return client.SyncRun{}, result, err
	}

	finishFailure := func(cause error, summaryFailed bool) (client.SyncRun, yikesync.Result, error) {
		if summaryFailed {
			result.Summary.AddFailure()
		}
		status := meta.SyncRunStatusFailed
		if errors.Is(cause, context.Canceled) || errors.Is(cause, context.DeadlineExceeded) {
			status = meta.SyncRunStatusCancelled
		}
		finishCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		finished, finishErr := api.FinishSourceRun(finishCtx, source.ID, run.ID, client.FinishSourceRunInput{
			Status:            status,
			CompleteInventory: false,
			Summary:           result.Summary,
			Error:             truncateError(cause),
		})
		if finishErr != nil {
			return client.SyncRun{}, result, errors.Join(cause, fmt.Errorf("finish failed Yike run: %w", finishErr))
		}
		return finished, result, cause
	}

	credentialPlaintext, err := sourcecredential.Get(ctx, r.DB, r.Keyring, source)
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
		yikeExecutor := yikesync.NewExecutor(transferRemote, &ownerExecutionAPI{sourceAPI: api}, *run.TargetNodeID)
		yikeExecutor.Heartbeat = func(heartbeatCtx context.Context) error {
			return api.HeartbeatSourceRun(heartbeatCtx, source.ID, run.ID)
		}
		executor = yikeExecutor
	}

	result, err = (yikesync.Scanner{
		Remote:      remote,
		API:         api,
		SourceID:    source.ID,
		RunID:       run.ID,
		IgnoreRules: run.IgnoreRules,
		Mode:        run.Mode,
		Executor:    executor,
	}).Scan(ctx)
	if err != nil {
		return finishFailure(err, true)
	}

	if _, err := sourcecollection.ApplySnapshot(ctx, r.DB, source.ID, run.ID, result.Collections); err != nil {
		return finishFailure(fmt.Errorf("apply Yike collection snapshot: %w", err), true)
	}

	finished, err := api.FinishSourceRun(ctx, source.ID, run.ID, client.FinishSourceRunInput{
		Status:            meta.SyncRunStatusCompleted,
		CompleteInventory: true,
		Summary:           result.Summary,
		Error:             strings.Join(result.Errors, "\n"),
	})
	if err != nil {
		return client.SyncRun{}, result, err
	}
	if finished.Status != meta.SyncRunStatusCompleted {
		return finished, result, fmt.Errorf("Yike pull run finished %s with %d failed items", finished.Status, finished.FailedItems)
	}
	return finished, result, nil
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

func isActiveRun(err error) bool {
	var apiErr *client.APIError
	return errors.As(err, &apiErr) &&
		apiErr.Status == http.StatusConflict &&
		apiErr.Msg == "source already has an active run"
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

type ownerSourceAPI struct {
	serverURL string
	auth      auth.Manager
	owner     meta.User
}

func (a *ownerSourceAPI) client() (*client.Client, error) {
	token, err := a.auth.Issue(a.owner.ID, a.owner.SessionVersion)
	if err != nil {
		return nil, err
	}
	out := client.New(a.serverURL, token)
	out.HTTP = &http.Client{Timeout: 30 * time.Second}
	return out, nil
}

type ownerExecutionAPI struct {
	sourceAPI *ownerSourceAPI
}

func (a *ownerExecutionAPI) List(ctx context.Context, parentID uint64) ([]client.Node, error) {
	c, err := a.sourceAPI.client()
	if err != nil {
		return nil, err
	}
	return c.List(ctx, parentID)
}

func (a *ownerExecutionAPI) CreateDir(ctx context.Context, parentID uint64, name string) (client.Node, error) {
	c, err := a.sourceAPI.client()
	if err != nil {
		return client.Node{}, err
	}
	return c.CreateDir(ctx, parentID, name)
}

func (a *ownerExecutionAPI) RenameMove(ctx context.Context, id, revision uint64, name *string, parentID *uint64) (client.Node, error) {
	c, err := a.sourceAPI.client()
	if err != nil {
		return client.Node{}, err
	}
	return c.RenameMove(ctx, id, revision, name, parentID)
}

func (a *ownerExecutionAPI) UploadStreamResumableResult(
	ctx context.Context,
	parentID uint64,
	name string,
	size int64,
	resumeKey string,
	open client.UploadStreamOpen,
	progress client.UploadProgress,
) (client.UploadResult, error) {
	c, err := a.sourceAPI.client()
	if err != nil {
		return client.UploadResult{}, err
	}
	return c.UploadStreamResumableResult(ctx, parentID, name, size, resumeKey, open, progress)
}

func (a *ownerExecutionAPI) OverwriteStreamResumableResult(
	ctx context.Context,
	nodeID, revision uint64,
	size int64,
	resumeKey string,
	open client.UploadStreamOpen,
	progress client.UploadProgress,
) (client.UploadResult, error) {
	c, err := a.sourceAPI.client()
	if err != nil {
		return client.UploadResult{}, err
	}
	return c.OverwriteStreamResumableResult(ctx, nodeID, revision, size, resumeKey, open, progress)
}

func (a *ownerSourceAPI) BeginSourceRun(ctx context.Context, sourceID uint64, runID, trigger string) (client.SyncRun, error) {
	c, err := a.client()
	if err != nil {
		return client.SyncRun{}, err
	}
	return c.BeginSourceRun(ctx, sourceID, runID, trigger)
}

func (a *ownerSourceAPI) ObserveSourceItems(ctx context.Context, sourceID uint64, runID string, items []client.SourceObservation) ([]client.SourcePlan, error) {
	c, err := a.client()
	if err != nil {
		return nil, err
	}
	return c.ObserveSourceItems(ctx, sourceID, runID, items)
}

func (a *ownerSourceAPI) CommitSourceItems(ctx context.Context, sourceID uint64, runID string, items []client.SourceCommit) error {
	c, err := a.client()
	if err != nil {
		return err
	}
	return c.CommitSourceItems(ctx, sourceID, runID, items)
}

func (a *ownerSourceAPI) HeartbeatSourceRun(ctx context.Context, sourceID uint64, runID string) error {
	c, err := a.client()
	if err != nil {
		return err
	}
	return c.HeartbeatSourceRun(ctx, sourceID, runID)
}

func (a *ownerSourceAPI) FinishSourceRun(ctx context.Context, sourceID uint64, runID string, input client.FinishSourceRunInput) (client.SyncRun, error) {
	c, err := a.client()
	if err != nil {
		return client.SyncRun{}, err
	}
	return c.FinishSourceRun(ctx, sourceID, runID, input)
}
