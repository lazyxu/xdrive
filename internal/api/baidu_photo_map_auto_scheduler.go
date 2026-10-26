package api

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const (
	baiduPhotoMapAutoReconcileInterval = 30 * time.Second
	// Consume at most one Owner-scoped intent each second, independent of
	// 30-second discovery. Existing cross-replica fleet/Owner quotas and
	// leases remain the final global admission control.
	baiduPhotoMapAutoConsumeInterval       = time.Second
	baiduPhotoMapAutoConsumeFailureBackoff = 30 * time.Second
	baiduPhotoMapAutoOwnerLimit            = 8
	baiduPhotoMapAutoBatchesPerOwner       = 4
	// Recheck previously drained Owners after ~10 minutes. This permits
	// recovery of an old active lease after it expires without a restart,
	// but avoids rescanning an unchanged 100k library every 30 seconds.
	baiduPhotoMapAutoDrainedRevisitTicks = 20
)

// runBaiduPhotoMapAutoPlanner fills the existing durable IndexIntent queue
// for current Owner GPS at a bounded rate. It starts alongside the shared
// MediaIndexer and is strictly a private producer: no external map request,
// no Baidu AK read, no raw GPS returned to a client, and no separate consent.
//
// This process-local drained set avoids repeated 100k-library scans when an
// Owner has caught up. MediaIndex system events independently enqueue new
// or edited GPS, while a restart starts another bounded reconciliation.
func (s *Server) runBaiduPhotoMapAutoPlanner(ctx context.Context) {
	if ctx == nil || s == nil || s.DB == nil {
		return
	}
	ticker := time.NewTicker(baiduPhotoMapAutoReconcileInterval)
	defer ticker.Stop()
	afterOwner := uint64(0)
	drained := make(map[uint64]struct{})
	revisitTicks := 0
	for {
		if revisitTicks >= baiduPhotoMapAutoDrainedRevisitTicks {
			clear(drained)
			revisitTicks = 0
		}
		if ctx.Err() != nil {
			return
		}
		if err := s.planBaiduPhotoMapAutoOwnersOnce(ctx, &afterOwner, drained); err != nil &&
			!errors.Is(err, context.Canceled) {
			// Never log SQL, GPS values, photo identities or provider secrets.
			slog.Warn("baidu_photo_map_auto_plan_unavailable")
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			revisitTicks++
		}
	}
}

// runBaiduPhotoMapAutoConsumer drains the same verified durable queue without
// waiting for the 30-second discovery sweep. One request per tick caps a
// single Server's normal egress; existing fleet/Owner PostgreSQL admission
// remains authoritative across replicas. After an actual dispatch error,
// pause rather than burning through the remaining Owner photos on a broken
// Provider or exhausted quota. A disabled/unconfigured AK is a no-op: the
// durable job remains queued for the next tick after configuration changes.
func (s *Server) runBaiduPhotoMapAutoConsumer(ctx context.Context) {
	if s == nil || s.DB == nil || ctx == nil {
		return
	}
	afterOwner := uint64(0)
	for ctx.Err() == nil {
		pause := baiduPhotoMapAutoConsumeInterval
		if err := s.consumeBaiduPhotoMapAutoOwnersOnce(ctx, &afterOwner); err != nil {
			if errors.Is(err, context.Canceled) || ctx.Err() != nil {
				return
			}
			slog.Warn("baidu_photo_map_auto_consume_unavailable")
			pause = baiduPhotoMapAutoConsumeFailureBackoff
		}
		timer := time.NewTimer(pause)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

// Each pass reads at most eight active Owner IDs and queues at most 4 * 32
// current photo intents per Owner, with independent row/version validation.
// No owner-supplied IDs, viewport bounds or consent records enter this scan.
// Cancellation or a DB error prevents a false "drained" claim.
func (s *Server) planBaiduPhotoMapAutoOwnersOnce(
	ctx context.Context, afterOwner *uint64, drained map[uint64]struct{},
) error {
	if s == nil || s.DB == nil || ctx == nil || ctx.Err() != nil ||
		afterOwner == nil || drained == nil {
		return errBaiduPhotoMapAutoPlanUnavailable
	}
	readCtx, cancel := context.WithTimeout(ctx, baiduPhotoMapAutoPlanTimeout)
	defer cancel()
	var ownerIDs []uint64
	db := s.DB.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	if err := db.WithContext(readCtx).Model(&meta.User{}).
		Where("id > ? AND disabled_at IS NULL AND must_change_password = ? AND session_version > 0", *afterOwner, false).
		Order("id ASC").Limit(baiduPhotoMapAutoOwnerLimit).
		Pluck("id", &ownerIDs).Error; err != nil || readCtx.Err() != nil {
		return errBaiduPhotoMapAutoPlanUnavailable
	}
	if len(ownerIDs) == 0 {
		*afterOwner = 0
		return nil
	}
	for _, ownerID := range ownerIDs {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		*afterOwner = ownerID
		if _, done := drained[ownerID]; done {
			continue
		}
		for attempt := 0; attempt < baiduPhotoMapAutoBatchesPerOwner; attempt++ {
			progress, err := planBaiduPhotoMapOwnerBackfillBatch(
				ctx, db, ownerID, 0, baiduPhotoMapAutoPlanMaxItems,
			)
			if err != nil {
				return errBaiduPhotoMapAutoPlanUnavailable
			}
			if !progress.HasMore {
				drained[ownerID] = struct{}{}
				break
			}
		}
	}
	return nil
}
