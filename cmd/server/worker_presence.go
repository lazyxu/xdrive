package main

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	sourceWorkerPresenceInterval = 5 * time.Second
	sourceWorkerPresenceTTL      = 20 * time.Second
)

type sourceWorkerPresenceConfig struct {
	scanInterval   time.Duration
	pollInterval   time.Duration
	maxConcurrency int
}

// Heartbeats run independently of RunDue, which can block for a long pull.
// Publishing a heartbeat proves a process is alive, not that any task succeeded.
func startSourceWorkerPresence(ctx context.Context, db *gorm.DB, cfg sourceWorkerPresenceConfig) {
	if db == nil {
		return
	}
	id := uuid.NewString()
	go func() {
		defer func() {
			cleanupCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			if err := db.WithContext(cleanupCtx).Model(&meta.SourceWorkerPresence{}).
				Where("instance_id = ?", id).
				Update("expires_at", time.Now().UTC()).Error; err != nil {
				slog.Warn("source_worker_heartbeat_expire_failed", "error", err)
			}
		}()

		// Prune ancient process leases only on start, not on every heartbeat.
		cleanupCtx, cleanupCancel := context.WithTimeout(ctx, 3*time.Second)
		if err := db.WithContext(cleanupCtx).
			Where("expires_at < ?", time.Now().UTC().Add(-7*24*time.Hour)).
			Delete(&meta.SourceWorkerPresence{}).Error; err != nil {
			slog.Warn("source_worker_heartbeat_prune_failed", "error", err)
		}
		cleanupCancel()

		publish := func() {
			pulseCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
			defer cancel()
			if err := publishSourceWorkerPresence(pulseCtx, db, id, cfg, time.Now().UTC()); err != nil && ctx.Err() == nil {
				slog.Warn("source_worker_heartbeat_publish_failed", "error", err)
			}
		}
		publish()
		ticker := time.NewTicker(sourceWorkerPresenceInterval)
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

func publishSourceWorkerPresence(
	ctx context.Context, db *gorm.DB, id string,
	cfg sourceWorkerPresenceConfig, now time.Time,
) error {
	row := meta.SourceWorkerPresence{
		InstanceID:          id,
		ScanIntervalSeconds: int64(cfg.scanInterval / time.Second),
		PollIntervalSeconds: int64(cfg.pollInterval / time.Second),
		MaxConcurrency:      cfg.maxConcurrency,
		HeartbeatAt:         now,
		ExpiresAt:           now.Add(sourceWorkerPresenceTTL),
	}
	return db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "instance_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"scan_interval_seconds", "poll_interval_seconds", "max_concurrency", "heartbeat_at", "expires_at",
		}),
	}).Create(&row).Error
}
