package api

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourceaccount"
)

const (
	systemMaintenanceHistoryRetention = 90 * 24 * time.Hour
	systemMaintenanceHistoryBatchSize = 500
)

type systemMaintenancePassResult struct {
	CompletedSteps int
	TotalSteps     int
	issues         []string
}

func newSystemMaintenancePassResult(total int) systemMaintenancePassResult {
	if total < 0 {
		total = 0
	}
	return systemMaintenancePassResult{TotalSteps: total}
}

func (r *systemMaintenancePassResult) addIssue(
	phase string,
	err error,
) {
	if r == nil || err == nil {
		return
	}
	r.issues = append(
		r.issues,
		fmt.Sprintf("%s: %v", phase, err),
	)
}

func (r systemMaintenancePassResult) status() string {
	if len(r.issues) == 0 {
		return meta.SystemMaintenanceStatusSuccess
	}
	if r.CompletedSteps == 0 {
		return meta.SystemMaintenanceStatusFailed
	}
	return meta.SystemMaintenanceStatusPartial
}

func (r systemMaintenancePassResult) errorText() string {
	return strings.Join(r.issues, "; ")
}

func (s *Server) cleanupSystemMaintenanceHistory(ctx context.Context) error {
	if s == nil || s.DB == nil {
		return nil
	}
	cutoff := time.Now().UTC().Add(-systemMaintenanceHistoryRetention)
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		latestByKind := s.DB.WithContext(ctx).
			Model(&meta.SystemMaintenanceRun{}).
			Select("MAX(id)").
			Group("kind")

		var ids []uint64
		if err := s.DB.WithContext(ctx).
			Model(&meta.SystemMaintenanceRun{}).
			Where("finished_at IS NOT NULL AND finished_at < ?", cutoff).
			Where("id NOT IN (?)", latestByKind).
			Order("id ASC").
			Limit(systemMaintenanceHistoryBatchSize).
			Pluck("id", &ids).Error; err != nil {
			return err
		}
		if len(ids) == 0 {
			return nil
		}
		if err := s.DB.WithContext(ctx).
			Where("id IN ?", ids).
			Delete(&meta.SystemMaintenanceRun{}).Error; err != nil {
			return err
		}
		if len(ids) < systemMaintenanceHistoryBatchSize {
			return nil
		}
	}
}

func (s *Server) beginSystemMaintenanceRun(
	ctx context.Context,
	kind string,
	totalSteps int,
) uint64 {
	if s == nil || s.DB == nil {
		return 0
	}
	now := time.Now().UTC()
	if err := s.DB.WithContext(ctx).
		Model(&meta.SystemMaintenanceRun{}).
		Where(
			"kind = ? AND status = ?",
			kind,
			meta.SystemMaintenanceStatusRunning,
		).
		Updates(map[string]any{
			"status":      meta.SystemMaintenanceStatusFailed,
			"error":       "interrupted before completion",
			"finished_at": now,
			"updated_at":  now,
		}).Error; err != nil {
		s.logSystemMaintenanceStatusError(
			"reconcile_interrupted",
			kind,
			err,
		)
	}

	run := meta.SystemMaintenanceRun{
		Kind:       kind,
		Status:     meta.SystemMaintenanceStatusRunning,
		Phase:      meta.SystemMaintenancePhaseStarting,
		Trigger:    string(background.TriggerSchedule),
		Initiator:  string(background.InitiatorSystem),
		TotalSteps: totalSteps,
		StartedAt:  now,
	}
	if err := s.DB.WithContext(ctx).Create(&run).Error; err != nil {
		s.logSystemMaintenanceStatusError("start", kind, err)
		return 0
	}
	return run.ID
}

func (s *Server) updateSystemMaintenanceRunPhase(
	ctx context.Context,
	runID uint64,
	phase string,
	completedSteps, totalSteps int,
) {
	if runID == 0 || s == nil || s.DB == nil {
		return
	}
	if err := s.DB.WithContext(ctx).
		Model(&meta.SystemMaintenanceRun{}).
		Where(
			"id = ? AND status = ?",
			runID,
			meta.SystemMaintenanceStatusRunning,
		).
		Updates(map[string]any{
			"phase":           phase,
			"completed_steps": completedSteps,
			"total_steps":     totalSteps,
			"updated_at":      time.Now().UTC(),
		}).Error; err != nil {
		s.logSystemMaintenanceStatusError(
			"phase",
			fmt.Sprintf("%d", runID),
			err,
		)
	}
}

func (s *Server) updateSystemMaintenanceRunProgress(
	ctx context.Context,
	runID uint64,
	progress backgroundTaskProgressDTO,
) {
	if runID == 0 || s == nil || s.DB == nil {
		return
	}
	updates := map[string]any{
		"progress_current": progress.Current,
		"progress_total":   progress.Total,
		"progress_unit":    progress.Unit,
		"progress_bytes":   progress.BytesCurrent,
		"progress_errors":  progress.Errors,
		"progress_message": progress.CurrentItem,
		"updated_at":       time.Now().UTC(),
	}
	if strings.TrimSpace(progress.Phase) != "" {
		updates["phase"] = progress.Phase
	}
	if err := s.DB.WithContext(ctx).
		Model(&meta.SystemMaintenanceRun{}).
		Where(
			"id = ? AND status IN ?",
			runID,
			[]string{
				meta.SystemMaintenanceStatusRunning,
				meta.SystemMaintenanceStatusCancelRequested,
			},
		).
		Updates(updates).Error; err != nil {
		s.logSystemMaintenanceStatusError(
			"progress",
			fmt.Sprintf("%d", runID),
			err,
		)
	}
}

func (s *Server) finishSystemMaintenanceRun(
	ctx context.Context,
	runID uint64,
	result systemMaintenancePassResult,
) {
	if runID == 0 || s == nil || s.DB == nil {
		return
	}
	now := time.Now().UTC()
	if err := s.DB.WithContext(ctx).
		Model(&meta.SystemMaintenanceRun{}).
		Where(
			"id = ? AND status = ?",
			runID,
			meta.SystemMaintenanceStatusRunning,
		).
		Updates(map[string]any{
			"status":          result.status(),
			"phase":           meta.SystemMaintenancePhaseFinished,
			"completed_steps": result.CompletedSteps,
			"total_steps":     result.TotalSteps,
			"error":           result.errorText(),
			"finished_at":     now,
			"updated_at":      now,
		}).Error; err != nil {
		s.logSystemMaintenanceStatusError(
			"finish",
			fmt.Sprintf("%d", runID),
			err,
		)
	}
}

func (s *Server) logSystemMaintenanceStatusError(
	operation, maintenance string,
	err error,
) {
	if s == nil || err == nil {
		return
	}
	s.ensureObservability()
	s.obs.logger.Warn(
		"system_maintenance_status_write_failed",
		"operation", operation,
		"maintenance", maintenance,
		"error", err,
	)
}

func (s *Server) backgroundSystemMaintenanceTasks(
	ctx context.Context,
) ([]backgroundTaskDTO, error) {
	subquery := s.DB.WithContext(ctx).
		Model(&meta.SystemMaintenanceRun{}).
		Select("MAX(id)").
		Group("kind")

	var runs []meta.SystemMaintenanceRun
	if err := s.DB.WithContext(ctx).
		Where("id IN (?)", subquery).
		Order("updated_at DESC, id DESC").
		Find(&runs).Error; err != nil {
		return nil, err
	}

	out := make([]backgroundTaskDTO, 0, len(runs)+1)
	seen := make(map[string]struct{}, len(runs))
	for _, run := range runs {
		seen[run.Kind] = struct{}{}
		priority := uint8(background.PriorityP4)
		state := run.Status
		errorText := run.Error
		switch run.Status {
		case meta.SystemMaintenanceStatusSuccess:
			state = "completed"
		case meta.SystemMaintenanceStatusIssues:
			state = "issues"
		case meta.SystemMaintenanceStatusCancelRequested:
			state = "cancelling"
		case meta.SystemMaintenanceStatusCancelled:
			state = "cancelled"
		case meta.SystemMaintenanceStatusRunning:
			state = "running"
		case meta.SystemMaintenanceStatusQueued:
			state = "queued"
		case meta.SystemMaintenanceStatusPartial:
			state = "partial"
		case meta.SystemMaintenanceStatusFailed:
			state = "failed"
		}
		if run.Status == meta.SystemMaintenanceStatusRunning ||
			run.Status == meta.SystemMaintenanceStatusCancelRequested {
			key := systemMaintenanceLeaderKey(run.Kind)
			if key != "" {
				held, err := sourceaccount.IsHeld(ctx, s.DB, key)
				if err != nil {
					s.ensureObservability()
					s.obs.logger.Warn(
						"system_maintenance_leader_status_failed",
						"maintenance", run.Kind,
						"error", err,
					)
				} else if !held && run.Status == meta.SystemMaintenanceStatusRunning {
					state = "failed"
					if errorText == "" {
						errorText = "interrupted before completion"
					}
				}
			}
		}
		trigger := strings.TrimSpace(run.Trigger)
		if trigger == "" {
			trigger = string(background.TriggerSchedule)
		}
		initiator := strings.TrimSpace(run.Initiator)
		if initiator == "" {
			initiator = string(background.InitiatorSystem)
		}
		var startedAt *time.Time
		if run.Status != meta.SystemMaintenanceStatusQueued {
			value := run.StartedAt
			startedAt = &value
		}
		progress := backgroundTaskProgressDTO{
			Phase:       run.Phase,
			Current:     int64(run.CompletedSteps),
			Total:       int64(run.TotalSteps),
			Unit:        "step",
			CurrentItem: run.Summary,
		}
		if run.Kind == meta.SystemMaintenanceKindStorageSampler &&
			(run.ProgressUnit != "" ||
				run.ProgressCurrent > 0 ||
				run.ProgressTotal > 0 ||
				run.ProgressBytes > 0 ||
				run.ProgressErrors > 0 ||
				run.ProgressMessage != "") {
			progress.Current = run.ProgressCurrent
			progress.Total = run.ProgressTotal
			progress.Unit = run.ProgressUnit
			progress.BytesCurrent = run.ProgressBytes
			progress.Errors = run.ProgressErrors
			progress.CurrentItem = run.ProgressMessage
			if run.Status != meta.SystemMaintenanceStatusRunning &&
				run.Status != meta.SystemMaintenanceStatusCancelRequested &&
				strings.TrimSpace(run.Summary) != "" {
				progress.CurrentItem = run.Summary
			}
		}
		out = append(out, backgroundTaskDTO{
			ID:             systemMaintenanceTaskCenterID(run.Kind),
			Kind:           "system.maintenance." + run.Kind,
			Domain:         "system_maintenance",
			Scope:          string(background.ScopeSystem),
			State:          state,
			Trigger:        trigger,
			Initiator:      initiator,
			Priority:       &priority,
			Resource:       string(background.ResourceMaintenanceIO),
			Progress:       progress,
			ControlActions: systemMaintenanceControlActions(run.Kind, run.Status),
			StartedAt:      startedAt,
			UpdatedAt:      run.UpdatedAt,
			FinishedAt:     run.FinishedAt,
			Error:          errorText,
		})
	}
	for _, kind := range systemMaintenanceInteractiveKinds() {
		if _, ok := seen[kind]; ok {
			continue
		}
		priority := uint8(background.PriorityP4)
		out = append(out, backgroundTaskDTO{
			ID:             systemMaintenanceTaskCenterID(kind),
			Kind:           "system.maintenance." + kind,
			Domain:         "system_maintenance",
			Scope:          string(background.ScopeSystem),
			State:          "idle",
			Priority:       &priority,
			Resource:       string(background.ResourceMaintenanceIO),
			Progress:       backgroundTaskProgressDTO{},
			ControlActions: systemMaintenanceControlActions(kind, ""),
		})
	}
	return out, nil
}
