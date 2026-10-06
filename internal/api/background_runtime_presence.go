package api

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const (
	backgroundRuntimePresencePublishInterval = 2 * time.Second
	backgroundRuntimePresenceTTL             = 10 * time.Second
	backgroundRuntimePresenceCleanupTimeout  = 5 * time.Second
)

func (s *Server) StartBackgroundRuntimePresence(ctx context.Context) {
	if s == nil ||
		s.DB == nil ||
		s.BackgroundScheduler == nil ||
		strings.TrimSpace(s.BackgroundRuntimeInstanceID) == "" {
		return
	}

	go func() {
		ticker := time.NewTicker(backgroundRuntimePresencePublishInterval)
		defer ticker.Stop()
		defer s.clearBackgroundRuntimePresence()

		s.publishBackgroundRuntimePresencePass(ctx)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.publishBackgroundRuntimePresencePass(ctx)
			}
		}
	}()
}

func (s *Server) publishBackgroundRuntimePresencePass(ctx context.Context) {
	if err := s.publishBackgroundRuntimePresence(
		ctx,
		time.Now().UTC(),
	); err != nil && ctx.Err() == nil {
		slog.Warn(
			"background_runtime_presence_publish_failed",
			"instance_id", s.BackgroundRuntimeInstanceID,
			"error", err,
		)
	}
}

func (s *Server) publishBackgroundRuntimePresence(
	ctx context.Context,
	now time.Time,
) error {
	if s == nil ||
		s.DB == nil ||
		s.BackgroundScheduler == nil ||
		strings.TrimSpace(s.BackgroundRuntimeInstanceID) == "" {
		return nil
	}
	now = now.UTC()
	tasks := aggregateRuntimeBackgroundTasks(
		s.BackgroundScheduler.TaskSnapshots(nil),
		0,
		false,
	)
	expiresAt := now.Add(backgroundRuntimePresenceTTL)
	rows := make([]meta.BackgroundRuntimePresence, 0, len(tasks))
	for _, task := range tasks {
		priority := uint8(0)
		if task.Priority != nil {
			priority = *task.Priority
		}
		rows = append(rows, meta.BackgroundRuntimePresence{
			InstanceID:      s.BackgroundRuntimeInstanceID,
			TaskID:          task.ID,
			Kind:            task.Kind,
			Scope:           task.Scope,
			OwnerID:         task.OwnerID,
			State:           task.State,
			Trigger:         task.Trigger,
			Initiator:       task.Initiator,
			Priority:        priority,
			Resource:        task.Resource,
			ProgressPhase:   task.Progress.Phase,
			ProgressCurrent: task.Progress.Current,
			ProgressTotal:   task.Progress.Total,
			ProgressUnit:    task.Progress.Unit,
			ProgressMessage: task.Progress.CurrentItem,
			ActiveCount:     task.ActiveCount,
			QueuedCount:     task.QueuedCount,
			RunningCount:    task.RunningCount,
			StartedAt:       task.StartedAt,
			TaskUpdatedAt:   task.UpdatedAt,
			ExpiresAt:       expiresAt,
		})
	}

	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where(
			"instance_id = ?",
			s.BackgroundRuntimeInstanceID,
		).Delete(&meta.BackgroundRuntimePresence{}).Error; err != nil {
			return err
		}
		if len(rows) != 0 {
			if err := tx.Create(&rows).Error; err != nil {
				return err
			}
		}
		return tx.Where(
			"expires_at <= ?",
			now,
		).Delete(&meta.BackgroundRuntimePresence{}).Error
	})
}

func (s *Server) clearBackgroundRuntimePresence() {
	if s == nil ||
		s.DB == nil ||
		strings.TrimSpace(s.BackgroundRuntimeInstanceID) == "" {
		return
	}
	ctx, cancel := context.WithTimeout(
		context.Background(),
		backgroundRuntimePresenceCleanupTimeout,
	)
	defer cancel()
	if err := s.DB.WithContext(ctx).Where(
		"instance_id = ?",
		s.BackgroundRuntimeInstanceID,
	).Delete(&meta.BackgroundRuntimePresence{}).Error; err != nil {
		slog.Warn(
			"background_runtime_presence_cleanup_failed",
			"instance_id", s.BackgroundRuntimeInstanceID,
			"error", err,
		)
	}
}
