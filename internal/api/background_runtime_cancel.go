package api

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourceaccount"
	"gorm.io/gorm"
)

const backgroundRuntimeCancelFinalizeTimeout = 5 * time.Second

func backgroundRuntimeCancelableKind(kind string) bool {
	switch kind {
	case "media.index",
		"photo.face",
		"photo.place",
		"photo.person_cluster":
		return true
	default:
		return false
	}
}

func (s *Server) backgroundRuntimeCancelEpoch(
	ctx context.Context,
	ownerID uint64,
	kind string,
) (uint64, uint64, error) {
	if s == nil || s.DB == nil || ownerID == 0 ||
		!backgroundRuntimeCancelableKind(kind) {
		return 0, 0, nil
	}
	var intent meta.BackgroundRuntimeCancelIntent
	err := s.DB.WithContext(ctx).
		Where("owner_id = ? AND kind = ?", ownerID, kind).
		First(&intent).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, 0, nil
	}
	if err != nil {
		return 0, 0, err
	}
	return intent.RequestedEpoch, intent.AppliedEpoch, nil
}

func (s *Server) backgroundRuntimeCancelEpochForSubmit(
	ownerID uint64,
	kind string,
) (uint64, error) {
	if s == nil || s.DB == nil {
		return 0, nil
	}
	ctx, cancel := context.WithTimeout(
		context.Background(),
		backgroundRuntimeCancelFinalizeTimeout,
	)
	defer cancel()
	requested, _, err := s.backgroundRuntimeCancelEpoch(
		ctx,
		ownerID,
		kind,
	)
	return requested, err
}

func (s *Server) requestBackgroundRuntimeCancellation(
	ctx context.Context,
	ref backgroundTaskRef,
	initiator background.Initiator,
	initiatorID uint64,
) (uint64, error) {
	if s == nil || s.DB == nil ||
		ref.scope != background.ScopeUser ||
		ref.ownerID == 0 ||
		!backgroundRuntimeCancelableKind(ref.kind) {
		return 0, errBackgroundTaskControlUnavailable
	}

	photoReanalyzeEpoch := uint64(0)
	if photoKind, ok := photoIntelligenceKindFromBackgroundKind(ref.kind); ok {
		var reanalyze meta.PhotoIntelligenceReanalyzeIntent
		err := s.DB.WithContext(ctx).
			Where(
				"owner_id = ? AND kind = ?",
				ref.ownerID,
				string(photoKind),
			).
			First(&reanalyze).Error
		switch {
		case err == nil:
			photoReanalyzeEpoch = reanalyze.RequestedEpoch
		case errors.Is(err, gorm.ErrRecordNotFound):
		default:
			return 0, err
		}
	}

	now := time.Now().UTC()
	trigger := background.TriggerUserAction
	if initiator == background.InitiatorAdmin {
		trigger = background.TriggerAdminAction
	}
	var requestedEpoch uint64
	row := s.DB.WithContext(ctx).Raw(`
		INSERT INTO xd_background_runtime_cancel_intents (
			owner_id,
			kind,
			requested_epoch,
			applied_epoch,
			photo_reanalyze_epoch,
			trigger,
			initiator,
			initiator_id,
			requested_at,
			created_at,
			updated_at
		)
		VALUES (?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (owner_id, kind) DO UPDATE SET
			requested_epoch = CASE
				WHEN xd_background_runtime_cancel_intents.requested_epoch >
					xd_background_runtime_cancel_intents.applied_epoch
				THEN xd_background_runtime_cancel_intents.requested_epoch
				ELSE xd_background_runtime_cancel_intents.requested_epoch + 1
			END,
			photo_reanalyze_epoch = EXCLUDED.photo_reanalyze_epoch,
			trigger = EXCLUDED.trigger,
			initiator = EXCLUDED.initiator,
			initiator_id = EXCLUDED.initiator_id,
			requested_at = EXCLUDED.requested_at,
			updated_at = EXCLUDED.updated_at
		RETURNING requested_epoch
	`,
		ref.ownerID,
		ref.kind,
		photoReanalyzeEpoch,
		string(trigger),
		string(initiator),
		initiatorID,
		now,
		now,
		now,
	).Row()
	if err := row.Scan(&requestedEpoch); err != nil {
		return 0, err
	}

	s.cancelLocalRuntimeTaskGroup(ref, background.ErrCancelRequested)

	finalizeCtx, cancel := context.WithTimeout(
		context.Background(),
		backgroundRuntimeCancelFinalizeTimeout,
	)
	defer cancel()
	if err := s.tryFinalizeIdleBackgroundRuntimeCancellation(
		finalizeCtx,
		ref.ownerID,
		ref.kind,
	); err != nil {
		return requestedEpoch, err
	}
	return requestedEpoch, nil
}

func (s *Server) tryFinalizeIdleBackgroundRuntimeCancellation(
	ctx context.Context,
	ownerID uint64,
	kind string,
) error {
	if s == nil || s.DB == nil {
		return nil
	}
	lease, acquired, err := sourceaccount.TryAcquire(
		ctx,
		s.DB,
		backgroundOwnerLeaseKey(kind, ownerID),
	)
	if err != nil {
		return err
	}
	if !acquired {
		return nil
	}
	defer lease.Close()
	return s.finalizeBackgroundRuntimeCancellation(
		ctx,
		ownerID,
		kind,
	)
}

func (s *Server) finalizeBackgroundRuntimeCancellation(
	ctx context.Context,
	ownerID uint64,
	kind string,
) error {
	if s == nil || s.DB == nil {
		return nil
	}
	var intent meta.BackgroundRuntimeCancelIntent
	err := s.DB.WithContext(ctx).
		Where(
			"owner_id = ? AND kind = ? AND requested_epoch > applied_epoch",
			ownerID,
			kind,
		).
		First(&intent).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}

	if photoKind, ok := photoIntelligenceKindFromBackgroundKind(kind); ok {
		if err := s.restoreCancelledPhotoIntelligenceState(
			ctx,
			photoKind,
			ownerID,
		); err != nil {
			return err
		}
		if intent.PhotoReanalyzeEpoch > 0 {
			if err := s.DB.WithContext(ctx).
				Model(&meta.PhotoIntelligenceReanalyzeIntent{}).
				Where(
					"owner_id = ? AND kind = ? AND applied_epoch < ?",
					ownerID,
					string(photoKind),
					intent.PhotoReanalyzeEpoch,
				).
				Updates(map[string]any{
					"applied_epoch": gorm.Expr(
						"LEAST(requested_epoch, ?)",
						intent.PhotoReanalyzeEpoch,
					),
					"applied_at": time.Now().UTC(),
					"updated_at": time.Now().UTC(),
				}).Error; err != nil {
				return err
			}
		}
	}

	now := time.Now().UTC()
	return s.DB.WithContext(ctx).
		Model(&meta.BackgroundRuntimeCancelIntent{}).
		Where(
			"owner_id = ? AND kind = ? AND applied_epoch < ?",
			ownerID,
			kind,
			intent.RequestedEpoch,
		).
		Updates(map[string]any{
			"applied_epoch": intent.RequestedEpoch,
			"applied_at":    now,
			"updated_at":    now,
		}).Error
}

func (s *Server) restoreCancelledPhotoIntelligenceState(
	ctx context.Context,
	kind photoIntelligenceTaskKind,
	ownerID uint64,
) error {
	assetIDs := s.DB.WithContext(ctx).
		Model(&meta.PhotoAsset{}).
		Select("id").
		Where("owner_id = ?", ownerID)
	now := time.Now().UTC()

	switch kind {
	case photoIntelligenceFace:
		return s.DB.WithContext(ctx).
			Model(&meta.PhotoAnalysisState{}).
			Where("asset_id IN (?)", assetIDs).
			Where(
				"kind IN ? AND state = ?",
				[]string{
					meta.PhotoAnalysisKindFaceDetection,
					meta.PhotoAnalysisKindFaceEmbedding,
				},
				meta.PhotoAnalysisStateRunning,
			).
			Updates(map[string]any{
				"state":        meta.PhotoAnalysisStateStale,
				"last_error":   "",
				"completed_at": nil,
				"updated_at":   now,
			}).Error
	case photoIntelligencePlace:
		return s.DB.WithContext(ctx).
			Model(&meta.PhotoAnalysisState{}).
			Where("asset_id IN (?)", assetIDs).
			Where(
				"kind = ? AND state = ?",
				meta.PhotoAnalysisKindPlaceLabel,
				meta.PhotoAnalysisStateRunning,
			).
			Updates(map[string]any{
				"state":        meta.PhotoAnalysisStateStale,
				"last_error":   "",
				"completed_at": nil,
				"updated_at":   now,
			}).Error
	case photoIntelligencePersonCluster:
		return s.DB.WithContext(ctx).
			Model(&meta.PhotoPersonClusterState{}).
			Where(
				"owner_id = ? AND state = ?",
				ownerID,
				meta.PhotoAnalysisStateRunning,
			).
			Updates(map[string]any{
				"state":        meta.PhotoAnalysisStateStale,
				"last_error":   "",
				"completed_at": nil,
				"updated_at":   now,
			}).Error
	default:
		return fmt.Errorf("unsupported runtime cancellation kind %q", kind)
	}
}

func (s *Server) reconcileBackgroundRuntimeCancellations(
	ctx context.Context,
	kinds []string,
) {
	if s == nil || s.DB == nil || ctx.Err() != nil || len(kinds) == 0 {
		return
	}
	var intents []meta.BackgroundRuntimeCancelIntent
	if err := s.DB.WithContext(ctx).
		Where("requested_epoch > applied_epoch").
		Where("kind IN ?", kinds).
		Order("requested_at ASC, owner_id ASC, kind ASC").
		Limit(backgroundTaskMaxLimit).
		Find(&intents).Error; err != nil {
		if !errors.Is(err, context.Canceled) {
			slog.Warn(
				"background_runtime_cancel_reconcile_failed",
				"error", err,
			)
		}
		return
	}
	for _, intent := range intents {
		if err := s.tryFinalizeIdleBackgroundRuntimeCancellation(
			ctx,
			intent.OwnerID,
			intent.Kind,
		); err != nil && !errors.Is(err, context.Canceled) {
			slog.Warn(
				"background_runtime_cancel_finalize_failed",
				"owner_id", intent.OwnerID,
				"kind", intent.Kind,
				"error", err,
			)
		}
	}
}

func (s *Server) backgroundRuntimeCancelTasks(
	ctx context.Context,
	ownerID *uint64,
	viewerID uint64,
	admin bool,
	limit int,
) ([]backgroundTaskDTO, error) {
	if s == nil || s.DB == nil {
		return nil, nil
	}
	if limit <= 0 {
		limit = backgroundTaskDefaultLimit
	}
	query := s.DB.WithContext(ctx).
		Order("updated_at DESC").
		Limit(limit)
	if ownerID != nil {
		query = query.Where("owner_id = ?", *ownerID)
	}
	var intents []meta.BackgroundRuntimeCancelIntent
	if err := query.Find(&intents).Error; err != nil {
		return nil, err
	}

	out := make([]backgroundTaskDTO, 0, len(intents))
	for _, intent := range intents {
		if !backgroundRuntimeCancelableKind(intent.Kind) {
			continue
		}
		state := "cancelled"
		finishedAt := intent.AppliedAt
		if intent.RequestedEpoch > intent.AppliedEpoch {
			state = "cancel_requested"
			finishedAt = nil
		}
		priority := uint8(background.PriorityP2)
		resource := background.ResourceBackgroundCPU
		switch intent.Kind {
		case "media.index":
			priority = uint8(background.PriorityP1)
			resource = background.ResourceMediaCPU
		case "photo.face":
			resource = background.ResourceMLCPU
		}
		task := backgroundTaskDTO{
			ID: "runtime:" + string(background.ScopeUser) + ":" +
				fmt.Sprintf("%d", intent.OwnerID) + ":" + intent.Kind,
			Kind:       intent.Kind,
			Domain:     "scheduler",
			Scope:      string(background.ScopeUser),
			OwnerID:    intent.OwnerID,
			State:      state,
			Trigger:    intent.Trigger,
			Initiator:  intent.Initiator,
			Priority:   &priority,
			Resource:   string(resource),
			UpdatedAt:  intent.UpdatedAt,
			FinishedAt: finishedAt,
		}
		if state == "cancel_requested" {
			task.Progress = backgroundTaskProgressDTO{
				Phase: "cancel_requested",
			}
		}
		task.ControlActions = backgroundRuntimeControlActions(
			intent.Kind,
			background.ScopeUser,
			intent.OwnerID,
			viewerID,
			admin,
		)
		if state != "queued" && state != "running" {
			task.ControlActions = nil
		}
		out = append(out, task)
	}
	return out, nil
}

func mergeBackgroundRuntimeCancelTasks(
	tasks []backgroundTaskDTO,
	cancelTasks []backgroundTaskDTO,
) []backgroundTaskDTO {
	indexByID := make(map[string]int, len(tasks))
	for index := range tasks {
		indexByID[tasks[index].ID] = index
	}
	for _, cancelTask := range cancelTasks {
		index, exists := indexByID[cancelTask.ID]
		if !exists {
			indexByID[cancelTask.ID] = len(tasks)
			tasks = append(tasks, cancelTask)
			continue
		}
		task := &tasks[index]
		if cancelTask.State == "cancel_requested" {
			task.State = "cancel_requested"
			task.Progress = cancelTask.Progress
			task.UpdatedAt = cancelTask.UpdatedAt
			task.ControlActions = nil
			continue
		}
		if task.UpdatedAt.After(cancelTask.UpdatedAt) {
			continue
		}
		*task = cancelTask
	}
	return tasks
}
