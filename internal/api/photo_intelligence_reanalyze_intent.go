package api

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const (
	photoIntelligencePhaseReanalyzeQueued   = "reanalyze_queued"
	photoIntelligencePhaseReanalyzeApplying = "reanalyze_applying"
)

func (s *Server) persistPhotoIntelligenceReanalyzeIntents(
	ctx context.Context,
	ownerID uint64,
	kinds []photoIntelligenceTaskKind,
	trigger background.Trigger,
	initiator background.Initiator,
	initiatorID uint64,
) error {
	if s == nil || s.DB == nil || ownerID == 0 || len(kinds) == 0 {
		return errPhotoIntelligenceUnavailable
	}
	for _, kind := range kinds {
		if !s.photoIntelligenceAvailable(kind) {
			return errPhotoIntelligenceUnavailable
		}
	}
	now := time.Now().UTC()
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, kind := range kinds {
			var epoch uint64
			row := tx.Raw(`
				INSERT INTO xd_photo_intelligence_reanalyze_intents (
					owner_id,
					kind,
					requested_epoch,
					applied_epoch,
					trigger,
					initiator,
					initiator_id,
					requested_at,
					created_at,
					updated_at
				)
				VALUES (?, ?, 1, 0, ?, ?, ?, ?, ?, ?)
				ON CONFLICT (owner_id, kind) DO UPDATE SET
					requested_epoch =
						xd_photo_intelligence_reanalyze_intents.requested_epoch + 1,
					trigger = EXCLUDED.trigger,
					initiator = EXCLUDED.initiator,
					initiator_id = EXCLUDED.initiator_id,
					requested_at = EXCLUDED.requested_at,
					updated_at = EXCLUDED.updated_at
				RETURNING requested_epoch
			`,
				ownerID,
				string(kind),
				string(trigger),
				string(initiator),
				initiatorID,
				now,
				now,
				now,
			).Row()
			if err := row.Scan(&epoch); err != nil {
				return err
			}
			if epoch == 0 {
				return fmt.Errorf(
					"persist photo intelligence reanalyze intent returned zero epoch",
				)
			}
		}
		return nil
	})
}

func (s *Server) enqueuePhotoIntelligenceReanalysis(
	ctx context.Context,
	ownerID uint64,
	kinds []photoIntelligenceTaskKind,
	trigger background.Trigger,
	initiator background.Initiator,
	initiatorID uint64,
) error {
	if err := s.persistPhotoIntelligenceReanalyzeIntents(
		ctx,
		ownerID,
		kinds,
		trigger,
		initiator,
		initiatorID,
	); err != nil {
		return err
	}

	for _, kind := range kinds {
		if err := s.requestPhotoIntelligenceOwner(
			kind,
			ownerID,
			background.PriorityP2,
			trigger,
			initiator,
			initiatorID,
		); err != nil {
			slog.Warn(
				"photo_intelligence_reanalyze_schedule_deferred",
				"owner_id", ownerID,
				"kind", kind,
				"error", err,
			)
		}
	}
	return nil
}

func (s *Server) pendingPhotoIntelligenceReanalyzeIntents(
	ctx context.Context,
	ownerID *uint64,
	limit int,
) ([]meta.PhotoIntelligenceReanalyzeIntent, error) {
	if s == nil || s.DB == nil {
		return nil, nil
	}
	if limit <= 0 {
		limit = photoIntelligenceOwnerScanLimit
	}
	query := s.DB.WithContext(ctx).
		Where("requested_epoch > applied_epoch").
		Order("requested_at ASC, owner_id ASC, kind ASC").
		Limit(limit)
	if ownerID != nil {
		query = query.Where("owner_id = ?", *ownerID)
	}
	var intents []meta.PhotoIntelligenceReanalyzeIntent
	if err := query.Find(&intents).Error; err != nil {
		return nil, err
	}
	return intents, nil
}

func (s *Server) schedulePendingPhotoIntelligenceReanalyzeIntents(
	ctx context.Context,
) {
	intents, err := s.pendingPhotoIntelligenceReanalyzeIntents(
		ctx,
		nil,
		photoIntelligenceOwnerScanLimit,
	)
	if err != nil {
		if !errors.Is(err, context.Canceled) {
			slog.Warn(
				"photo_intelligence_reanalyze_reconcile_failed",
				"error", err,
			)
		}
		return
	}
	for _, intent := range intents {
		kind := photoIntelligenceTaskKind(intent.Kind)
		if !s.photoIntelligenceAvailable(kind) {
			continue
		}
		trigger := background.Trigger(intent.Trigger)
		initiator := background.Initiator(intent.Initiator)
		if trigger != background.TriggerUserAction &&
			trigger != background.TriggerAdminAction {
			trigger = background.TriggerReconcile
			initiator = background.InitiatorSystem
			intent.InitiatorID = 0
		}
		if err := s.requestPhotoIntelligenceOwner(
			kind,
			intent.OwnerID,
			background.PriorityP2,
			trigger,
			initiator,
			intent.InitiatorID,
		); err != nil &&
			!errors.Is(err, background.ErrClosed) &&
			!errors.Is(err, context.Canceled) {
			slog.Warn(
				"photo_intelligence_reanalyze_reconcile_schedule_failed",
				"owner_id", intent.OwnerID,
				"kind", intent.Kind,
				"error", err,
			)
		}
	}
}

func (s *Server) consumePhotoIntelligenceReanalyzeIntent(
	ctx context.Context,
	kind photoIntelligenceTaskKind,
	ownerID uint64,
) (bool, error) {
	if s == nil || s.DB == nil || ownerID == 0 {
		return false, nil
	}
	var intent meta.PhotoIntelligenceReanalyzeIntent
	err := s.DB.WithContext(ctx).
		Where("owner_id = ? AND kind = ?", ownerID, string(kind)).
		First(&intent).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if intent.RequestedEpoch <= intent.AppliedEpoch {
		return false, nil
	}
	targetEpoch := intent.RequestedEpoch
	background.ReportProgress(ctx, background.TaskProgress{
		Phase: photoIntelligencePhaseReanalyzeApplying,
	})
	if err := s.invalidatePhotoIntelligenceOwner(
		ctx,
		kind,
		ownerID,
	); err != nil {
		return true, err
	}

	now := time.Now().UTC()
	if err := s.DB.WithContext(ctx).
		Model(&meta.PhotoIntelligenceReanalyzeIntent{}).
		Where(
			"owner_id = ? AND kind = ? AND applied_epoch < ?",
			ownerID,
			string(kind),
			targetEpoch,
		).
		Updates(map[string]any{
			"applied_epoch": targetEpoch,
			"applied_at":    now,
			"updated_at":    now,
		}).Error; err != nil {
		return true, err
	}
	return true, nil
}

func photoIntelligenceTaskResource(
	kind photoIntelligenceTaskKind,
) background.ResourceClass {
	if kind == photoIntelligenceFace {
		return background.ResourceMLCPU
	}
	return background.ResourceBackgroundCPU
}

func (s *Server) backgroundPhotoIntelligenceIntentTasks(
	ctx context.Context,
	ownerID *uint64,
	viewerID uint64,
	admin bool,
	limit int,
) ([]backgroundTaskDTO, error) {
	intents, err := s.pendingPhotoIntelligenceReanalyzeIntents(
		ctx,
		ownerID,
		limit,
	)
	if err != nil {
		return nil, err
	}
	out := make([]backgroundTaskDTO, 0, len(intents))
	for _, intent := range intents {
		kind := photoIntelligenceTaskKind(intent.Kind)
		switch kind {
		case photoIntelligenceFace,
			photoIntelligencePlace,
			photoIntelligencePersonCluster:
		default:
			continue
		}
		kindName := "photo." + string(kind)
		priority := uint8(background.PriorityP2)
		task := backgroundTaskDTO{
			ID: "runtime:" +
				string(background.ScopeUser) + ":" +
				fmt.Sprintf("%d", intent.OwnerID) + ":" +
				kindName,
			Kind:        kindName,
			Domain:      "scheduler",
			Scope:       string(background.ScopeUser),
			OwnerID:     intent.OwnerID,
			State:       "queued",
			Trigger:     intent.Trigger,
			Initiator:   intent.Initiator,
			Priority:    &priority,
			Resource:    string(photoIntelligenceTaskResource(kind)),
			UpdatedAt:   intent.UpdatedAt,
			ActiveCount: 1,
			QueuedCount: 1,
			Progress: backgroundTaskProgressDTO{
				Phase: photoIntelligencePhaseReanalyzeQueued,
			},
		}
		task.ControlActions = backgroundRuntimeControlActions(
			kindName,
			background.ScopeUser,
			intent.OwnerID,
			viewerID,
			admin,
		)
		out = append(out, task)
	}
	return out, nil
}

func mergePhotoIntelligenceIntentTasks(
	tasks []backgroundTaskDTO,
	intents []backgroundTaskDTO,
) []backgroundTaskDTO {
	indexByID := make(map[string]int, len(tasks))
	for index := range tasks {
		indexByID[tasks[index].ID] = index
	}
	for _, intent := range intents {
		index, exists := indexByID[intent.ID]
		if !exists {
			indexByID[intent.ID] = len(tasks)
			tasks = append(tasks, intent)
			continue
		}
		task := &tasks[index]
		if task.Progress.Phase != "waiting_for_cluster_lease" &&
			task.Progress.Phase != photoIntelligencePhaseReanalyzeApplying {
			task.Progress.Phase = photoIntelligencePhaseReanalyzeQueued
		}
		if intent.UpdatedAt.After(task.UpdatedAt) {
			task.UpdatedAt = intent.UpdatedAt
		}
		task.Trigger = intent.Trigger
		task.Initiator = intent.Initiator
		task.ControlActions = intent.ControlActions
	}
	return tasks
}
