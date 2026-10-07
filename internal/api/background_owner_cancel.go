package api

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourceaccount"
	"gorm.io/gorm"
)

const backgroundOwnerCancelTimeout = 5 * time.Second

func backgroundOwnerCancellableKind(kind string) bool {
	switch strings.TrimSpace(kind) {
	case "media.index",
		"photo.face",
		"photo.smart_search",
		"photo.semantic_search",
		"photo.place",
		"photo.person_cluster":
		return true
	default:
		return false
	}
}

func (s *Server) backgroundOwnerCancelEpoch(
	ctx context.Context,
	kind string,
	ownerID uint64,
) (uint64, error) {
	if s == nil || s.DB == nil || ownerID == 0 {
		return 0, nil
	}
	var row meta.BackgroundOwnerCancellation
	result := s.DB.WithContext(ctx).
		Where("owner_id = ? AND kind = ?", ownerID, kind).
		Limit(1).
		Find(&row)
	if result.Error != nil {
		return 0, result.Error
	}
	if result.RowsAffected == 0 {
		return 0, nil
	}
	return row.RequestedEpoch, nil
}

func (s *Server) captureBackgroundOwnerCancelEpoch(
	kind string,
	ownerID uint64,
) (uint64, error) {
	ctx, cancel := context.WithTimeout(
		context.Background(),
		backgroundOwnerCancelTimeout,
	)
	defer cancel()
	return s.backgroundOwnerCancelEpoch(ctx, kind, ownerID)
}

func (s *Server) backgroundOwnerCancelledSince(
	ctx context.Context,
	kind string,
	ownerID, baseline uint64,
) (bool, uint64, error) {
	epoch, err := s.backgroundOwnerCancelEpoch(ctx, kind, ownerID)
	if err != nil {
		return false, 0, err
	}
	return epoch > baseline, epoch, nil
}

func (s *Server) backgroundOwnerCancelledSinceIndependent(
	kind string,
	ownerID, baseline uint64,
) (bool, uint64, error) {
	ctx, cancel := context.WithTimeout(
		context.Background(),
		backgroundOwnerCancelTimeout,
	)
	defer cancel()
	return s.backgroundOwnerCancelledSince(ctx, kind, ownerID, baseline)
}

func (s *Server) requestBackgroundOwnerCancellation(
	ctx context.Context,
	kind string,
	ownerID uint64,
	initiator background.Initiator,
	initiatorID uint64,
) (uint64, error) {
	kind = strings.TrimSpace(kind)
	if s == nil || s.DB == nil || ownerID == 0 ||
		!backgroundOwnerCancellableKind(kind) {
		return 0, fmt.Errorf("background owner cancellation is unavailable")
	}
	now := time.Now().UTC()
	var epoch uint64
	err := s.DB.WithContext(ctx).Raw(`
		INSERT INTO xd_background_owner_cancellations (
			owner_id,
			kind,
			requested_epoch,
			applied_epoch,
			initiator,
			initiator_id,
			requested_at,
			created_at,
			updated_at
		)
		VALUES (?, ?, 1, 0, ?, ?, ?, ?, ?)
		ON CONFLICT (owner_id, kind) DO UPDATE SET
			requested_epoch =
				xd_background_owner_cancellations.requested_epoch + 1,
			initiator = EXCLUDED.initiator,
			initiator_id = EXCLUDED.initiator_id,
			requested_at = EXCLUDED.requested_at,
			updated_at = EXCLUDED.updated_at
		RETURNING requested_epoch
	`,
		ownerID,
		kind,
		string(initiator),
		initiatorID,
		now,
		now,
		now,
	).Row().Scan(&epoch)
	return epoch, err
}

func (s *Server) cancelPendingPhotoIntelligenceReanalyzeIntent(
	ctx context.Context,
	kind photoIntelligenceTaskKind,
	ownerID uint64,
) error {
	if s == nil || s.DB == nil || ownerID == 0 {
		return nil
	}
	now := time.Now().UTC()
	return s.DB.WithContext(ctx).
		Model(&meta.PhotoIntelligenceReanalyzeIntent{}).
		Where("owner_id = ? AND kind = ?", ownerID, string(kind)).
		Updates(map[string]any{
			"cancelled_epoch": gorm.Expr("requested_epoch"),
			"cancelled_at":    now,
			"updated_at":      now,
		}).Error
}

func (s *Server) finalizeBackgroundOwnerCancellation(
	ctx context.Context,
	kind string,
	ownerID, targetEpoch uint64,
) error {
	if s == nil || s.DB == nil || ownerID == 0 || targetEpoch == 0 {
		return nil
	}
	now := time.Now().UTC()
	return s.DB.WithContext(ctx).
		Model(&meta.BackgroundOwnerCancellation{}).
		Where(
			"owner_id = ? AND kind = ? AND applied_epoch < ?",
			ownerID,
			kind,
			targetEpoch,
		).
		Updates(map[string]any{
			"applied_epoch": gorm.Expr(
				"GREATEST(applied_epoch, ?)",
				targetEpoch,
			),
			"applied_at": now,
			"updated_at": now,
		}).Error
}

func (s *Server) finalizeBackgroundOwnerCancellationIndependent(
	kind string,
	ownerID, targetEpoch uint64,
) error {
	ctx, cancel := context.WithTimeout(
		context.Background(),
		backgroundOwnerCancelTimeout,
	)
	defer cancel()
	return s.finalizeBackgroundOwnerCancellation(
		ctx,
		kind,
		ownerID,
		targetEpoch,
	)
}

func (s *Server) tryFinalizeIdleBackgroundOwnerCancellation(
	ctx context.Context,
	kind string,
	ownerID, targetEpoch uint64,
) (bool, error) {
	if s == nil || s.DB == nil || ownerID == 0 || targetEpoch == 0 {
		return false, nil
	}
	lease, acquired, err := sourceaccount.TryAcquire(
		ctx,
		s.DB,
		backgroundOwnerLeaseKey(kind, ownerID),
	)
	if err != nil {
		return false, err
	}
	if !acquired {
		return false, nil
	}
	defer lease.Close()

	if photoKind, ok := photoIntelligenceKindFromBackgroundKind(kind); ok {
		if err := s.rollbackPhotoIntelligenceOwnerAfterCancel(
			photoKind,
			ownerID,
		); err != nil {
			return false, err
		}
	}
	if err := s.finalizeBackgroundOwnerCancellation(
		ctx,
		kind,
		ownerID,
		targetEpoch,
	); err != nil {
		return false, err
	}
	return true, nil
}

func (s *Server) reconcileBackgroundOwnerCancellations(
	ctx context.Context,
	kinds []string,
) {
	if s == nil || s.DB == nil || ctx.Err() != nil || len(kinds) == 0 {
		return
	}
	var rows []meta.BackgroundOwnerCancellation
	if err := s.DB.WithContext(ctx).
		Where("requested_epoch > applied_epoch").
		Where("kind IN ?", kinds).
		Order("requested_at ASC, owner_id ASC, kind ASC").
		Limit(backgroundTaskMaxLimit).
		Find(&rows).Error; err != nil {
		if !errors.Is(err, context.Canceled) {
			slog.Warn(
				"background_owner_cancel_reconcile_failed",
				"error", err,
			)
		}
		return
	}
	for _, row := range rows {
		if _, err := s.tryFinalizeIdleBackgroundOwnerCancellation(
			ctx,
			row.Kind,
			row.OwnerID,
			row.RequestedEpoch,
		); err != nil && !errors.Is(err, context.Canceled) {
			slog.Warn(
				"background_owner_cancel_finalize_failed",
				"owner_id", row.OwnerID,
				"kind", row.Kind,
				"error", err,
			)
		}
	}
}

func (s *Server) backgroundRuntimeTaskCancellableNow(
	ctx context.Context,
	ref backgroundTaskRef,
) (bool, error) {
	if s == nil ||
		ref.scope != background.ScopeUser ||
		ref.ownerID == 0 ||
		!backgroundOwnerCancellableKind(ref.kind) {
		return false, nil
	}

	if s.BackgroundScheduler != nil {
		ownerID := ref.ownerID
		for _, snapshot := range s.BackgroundScheduler.TaskSnapshots(&ownerID) {
			if snapshot.Identity.Scope == ref.scope &&
				snapshot.Identity.OwnerID == ref.ownerID &&
				snapshot.Kind == ref.kind {
				return true, nil
			}
		}
	}

	if s.DB == nil {
		return false, nil
	}
	if kind, ok := photoIntelligenceKindFromBackgroundKind(ref.kind); ok {
		var count int64
		if err := s.DB.WithContext(ctx).
			Model(&meta.PhotoIntelligenceReanalyzeIntent{}).
			Where(
				"owner_id = ? AND kind = ? AND requested_epoch > applied_epoch AND requested_epoch > cancelled_epoch",
				ref.ownerID,
				string(kind),
			).
			Count(&count).Error; err != nil {
			return false, err
		}
		if count > 0 {
			return true, nil
		}
	}

	held, err := sourceaccount.IsHeld(
		ctx,
		s.DB,
		backgroundOwnerLeaseKey(ref.kind, ref.ownerID),
	)
	if err != nil {
		return false, err
	}
	return held, nil
}
