package pullworker

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"gorm.io/gorm"
)

const defaultRunCancellationPollInterval = 250 * time.Millisecond

type RunSession struct {
	Source  meta.Source
	Owner   meta.User
	Run     client.SyncRun
	API     *OwnerSourceAPI
	Context context.Context

	cancel context.CancelFunc
}

func BeginRunSession(
	ctx context.Context,
	db *gorm.DB,
	serverURL string,
	jwtSecret string,
	source meta.Source,
	expectedKind string,
) (*RunSession, error) {
	if db == nil {
		return nil, fmt.Errorf("pull worker database is unavailable")
	}
	if source.ID == 0 || source.Kind != expectedKind ||
		source.Direction != meta.SourceDirectionPull ||
		source.SyncMode != meta.SourceSyncModeBackup ||
		source.Status != meta.SourceStatusActive ||
		!meta.ValidSourceRunMode(source.RunMode) {
		return nil, fmt.Errorf("source %d is not an active %s pull source", source.ID, expectedKind)
	}

	var owner meta.User
	if err := db.WithContext(ctx).First(&owner, source.OwnerID).Error; err != nil {
		return nil, err
	}
	if owner.DisabledAt != nil {
		return nil, fmt.Errorf("source owner account is disabled")
	}
	if owner.MustChangePassword {
		return nil, fmt.Errorf("source owner must change password before scheduled scans")
	}

	api, err := NewOwnerSourceAPI(serverURL, jwtSecret, owner)
	if err != nil {
		return nil, err
	}
	trigger := meta.SyncRunTriggerScheduled
	if source.RunRequestedAt != nil {
		trigger = meta.SyncRunTriggerManual
	}
	run, err := api.BeginSourceRun(ctx, source.ID, uuid.NewString(), trigger)
	if err != nil {
		return nil, err
	}
	runCtx, cancel := context.WithCancel(ctx)
	api.SetCancelRun(cancel)
	go watchRunCancellation(
		runCtx,
		defaultRunCancellationPollInterval,
		func(checkCtx context.Context) (bool, error) {
			var state struct {
				CancelRequestedAt *time.Time
			}
			err := db.WithContext(checkCtx).
				Model(&meta.SyncRun{}).
				Select("cancel_requested_at").
				Where("id = ? AND source_id = ?", run.ID, source.ID).
				Take(&state).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return false, nil
			}
			return state.CancelRequestedAt != nil, err
		},
		cancel,
	)
	return &RunSession{
		Source: source, Owner: owner, Run: run, API: api,
		Context: runCtx, cancel: cancel,
	}, nil
}

func (s *RunSession) Close() {
	if s != nil && s.cancel != nil {
		s.cancel()
	}
}

func watchRunCancellation(
	ctx context.Context,
	interval time.Duration,
	check func(context.Context) (bool, error),
	cancel context.CancelFunc,
) {
	if check == nil || cancel == nil {
		return
	}
	if interval <= 0 {
		interval = defaultRunCancellationPollInterval
	}
	checkNow := func() bool {
		requested, err := check(ctx)
		if err == nil && requested {
			cancel()
			return true
		}
		return false
	}
	if checkNow() {
		return
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if checkNow() {
				return
			}
		}
	}
}

func (s *RunSession) FinishFailure(
	cause error,
	summary *sourcepkg.Summary,
	summaryFailed bool,
	errorText string,
) (client.SyncRun, error) {
	if s == nil || s.API == nil || s.Run.ID == "" {
		return client.SyncRun{}, cause
	}
	if summary == nil {
		summary = &sourcepkg.Summary{}
	}
	if summaryFailed && !errors.Is(cause, context.Canceled) && !errors.Is(cause, context.DeadlineExceeded) {
		summary.AddFailure()
	}
	status := meta.SyncRunStatusFailed
	if errors.Is(cause, context.Canceled) || errors.Is(cause, context.DeadlineExceeded) {
		status = meta.SyncRunStatusCancelled
	}
	errorText = strings.TrimSpace(errorText)
	if errorText == "" && cause != nil {
		errorText = strings.TrimSpace(cause.Error())
	}

	finishCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	finished, err := s.API.FinishSourceRun(finishCtx, s.Source.ID, s.Run.ID, client.FinishSourceRunInput{
		Status:            status,
		CompleteInventory: false,
		Summary:           *summary,
		Error:             errorText,
	})
	if err != nil {
		return client.SyncRun{}, fmt.Errorf("finish failed pull run: %w", err)
	}
	return finished, nil
}

func (s *RunSession) FinishSuccess(summary sourcepkg.Summary, errorText string) (client.SyncRun, error) {
	if s == nil || s.API == nil || s.Run.ID == "" {
		return client.SyncRun{}, fmt.Errorf("pull run session is unavailable")
	}
	return s.API.FinishSourceRun(s.Context, s.Source.ID, s.Run.ID, client.FinishSourceRunInput{
		Status:            meta.SyncRunStatusCompleted,
		CompleteInventory: true,
		Summary:           summary,
		Error:             strings.TrimSpace(errorText),
	})
}
