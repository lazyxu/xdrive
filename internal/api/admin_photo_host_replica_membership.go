package api

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	photoHostReplicaPresenceInterval = 5 * time.Second
	photoHostReplicaPresenceTTL      = 20 * time.Second
	photoHostReplicaRetention        = 24 * time.Hour
	photoHostReplicaPulseTimeout     = 3 * time.Second
	photoHostReplicaProbeTimeout     = 800 * time.Millisecond
)

func publishPhotoHostReplicaPresence(ctx context.Context, db *gorm.DB, row meta.PhotoHostReplicaPresence) error {
	return db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "instance_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"heartbeat_at", "expires_at",
		}),
	}).Create(&row).Error
}

// Every Server that can schedule background work publishes even while idle.
// A newly booted process has a fresh, private BackgroundRuntimeInstanceID.
// This is observation only: it cannot freeze future tasks or attest any
// unknown, not-yet-registered node in the deployment.
func (s *Server) StartPhotoHostReplicaPresence(ctx context.Context) {
	if s == nil || s.DB == nil ||
		strings.TrimSpace(s.BackgroundRuntimeInstanceID) == "" || ctx == nil {
		return
	}
	id := s.BackgroundRuntimeInstanceID
	db := s.DB
	started := time.Now().UTC()
	go func() {
		defer func() {
			endCtx, cancel := context.WithTimeout(context.Background(), photoHostReplicaPulseTimeout)
			defer cancel()
			if err := db.WithContext(endCtx).
				Model(&meta.PhotoHostReplicaPresence{}).
				Where("instance_id = ?", id).
				Update("expires_at", time.Now().UTC()).Error; err != nil {
				slog.Warn("photo_host_replica_expire_failed", "error", err)
			}
		}()

		// Retain a bounded history of recently missing members so clean
		// shutdowns and lost heartbeats remain stop blockers, not green.
		pruneCtx, cancel := context.WithTimeout(ctx, photoHostReplicaPulseTimeout)
		if err := db.WithContext(pruneCtx).
			Where("expires_at < ?", started.Add(-photoHostReplicaRetention)).
			Delete(&meta.PhotoHostReplicaPresence{}).Error; err != nil && ctx.Err() == nil {
			slog.Warn("photo_host_replica_prune_failed", "error", err)
		}
		cancel()

		publish := func() {
			now := time.Now().UTC()
			pulseCtx, done := context.WithTimeout(ctx, photoHostReplicaPulseTimeout)
			defer done()
			if err := publishPhotoHostReplicaPresence(pulseCtx, db, meta.PhotoHostReplicaPresence{
				InstanceID: id, StartedAt: started, HeartbeatAt: now,
				ExpiresAt: now.Add(photoHostReplicaPresenceTTL),
			}); err != nil && ctx.Err() == nil {
				slog.Warn("photo_host_replica_heartbeat_failed", "error", err)
			}
		}
		publish()
		ticker := time.NewTicker(photoHostReplicaPresenceInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				publish()
			}
		}
	}()
}

// NEGATIVE-ONLY observation. A recently seen process whose heartbeat is
// expired is a veto. Fresh rows, zero rows, legacy Servers and errors can
// NEVER certify that the full fleet is registered, quiescent or fenced.
func (s *Server) photoHostReplicaMembershipBlocker(ctx context.Context) string {
	if s == nil || s.DB == nil || ctx == nil || ctx.Err() != nil {
		return "unverified"
	}
	queryCtx, cancel := context.WithTimeout(ctx, photoHostReplicaProbeTimeout)
	defer cancel()
	now := time.Now().UTC()
	var present int
	result := s.DB.WithContext(queryCtx).
		Model(&meta.PhotoHostReplicaPresence{}).
		Select("1").
		Where("heartbeat_at >= ? AND expires_at <= ?",
			now.Add(-photoHostReplicaRetention), now).
		Limit(1).
		Scan(&present)
	if result.Error != nil || queryCtx.Err() != nil {
		return "unverified"
	}
	if result.RowsAffected != 0 {
		return "blocked"
	}
	return "unverified"
}
