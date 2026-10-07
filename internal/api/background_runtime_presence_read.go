package api

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/meta"
)

func (s *Server) backgroundClusterRuntimeTasks(
	ctx context.Context,
	ownerID *uint64,
	viewerID uint64,
	admin bool,
) []backgroundTaskDTO {
	local := make([]backgroundTaskDTO, 0)
	if s != nil && s.BackgroundScheduler != nil {
		local = aggregateRuntimeBackgroundTasks(
			s.BackgroundScheduler.TaskSnapshots(ownerID),
			viewerID,
			admin,
		)
	}
	if s == nil ||
		s.DB == nil ||
		strings.TrimSpace(s.BackgroundRuntimeInstanceID) == "" {
		return local
	}

	now := time.Now().UTC()
	query := s.DB.WithContext(ctx).
		Where("expires_at > ?", now).
		Where("instance_id <> ?", s.BackgroundRuntimeInstanceID)
	if ownerID != nil {
		query = query.Where(
			"scope = ? AND owner_id = ?",
			string(background.ScopeUser),
			*ownerID,
		)
	}
	var rows []meta.BackgroundRuntimePresence
	if err := query.Find(&rows).Error; err != nil {
		slog.Warn(
			"background_runtime_presence_read_failed",
			"instance_id", s.BackgroundRuntimeInstanceID,
			"error", err,
		)
		return local
	}

	remote := make([]backgroundTaskDTO, 0, len(rows))
	for _, row := range rows {
		priority := row.Priority
		progress := backgroundTaskProgressDTO{
			Phase:       row.ProgressPhase,
			Current:     row.ProgressCurrent,
			Total:       row.ProgressTotal,
			Unit:        row.ProgressUnit,
			CurrentItem: row.ProgressMessage,
		}
		if progress.Total > 0 {
			value := float64(progress.Current) * 100 / float64(progress.Total)
			if value < 0 {
				value = 0
			}
			if value > 100 {
				value = 100
			}
			progress.Percent = &value
		}
		scope := background.Scope(row.Scope)
		task := backgroundTaskDTO{
			ID:            row.TaskID,
			Kind:          row.Kind,
			Domain:        "scheduler",
			Scope:         row.Scope,
			OwnerID:       row.OwnerID,
			State:         row.State,
			Trigger:       row.Trigger,
			Initiator:     row.Initiator,
			Priority:      &priority,
			Resource:      row.Resource,
			Progress:      progress,
			ActiveCount:   row.ActiveCount,
			QueuedCount:   row.QueuedCount,
			RunningCount:  row.RunningCount,
			InstanceCount: 1,
			Attempt:       row.Attempt,
			RetryAt:       row.RetryAt,
			TraceID:       row.TraceID,
			ParentKey:     row.ParentKey,
			StartedAt:     row.StartedAt,
			UpdatedAt:     row.TaskUpdatedAt,
		}
		task.ControlActions = backgroundRuntimeControlActions(
			row.Kind,
			scope,
			row.OwnerID,
			viewerID,
			admin,
		)
		remote = append(remote, task)
	}
	return mergeClusterRuntimeTasks(local, remote)
}

func mergeClusterRuntimeTasks(
	local []backgroundTaskDTO,
	remote []backgroundTaskDTO,
) []backgroundTaskDTO {
	out := append([]backgroundTaskDTO(nil), local...)
	indexByID := make(map[string]int, len(out)+len(remote))
	for index := range out {
		indexByID[out[index].ID] = index
	}
	for _, incoming := range remote {
		index, exists := indexByID[incoming.ID]
		if !exists {
			indexByID[incoming.ID] = len(out)
			out = append(out, incoming)
			continue
		}
		mergeClusterRuntimeTask(&out[index], incoming)
	}
	return out
}

func mergeClusterRuntimeTask(
	task *backgroundTaskDTO,
	incoming backgroundTaskDTO,
) {
	if task == nil {
		return
	}
	task.ActiveCount += incoming.ActiveCount
	task.QueuedCount += incoming.QueuedCount
	task.RunningCount += incoming.RunningCount
	task.InstanceCount += incoming.InstanceCount
	if incoming.Attempt > task.Attempt {
		task.Attempt = incoming.Attempt
	}
	if incoming.RetryAt != nil &&
		(task.RetryAt == nil || incoming.RetryAt.Before(*task.RetryAt)) {
		value := incoming.RetryAt.UTC()
		task.RetryAt = &value
	}
	if task.TraceID != incoming.TraceID {
		task.TraceID = ""
	}
	if task.ParentKey != incoming.ParentKey {
		task.ParentKey = ""
	}

	if runtimeStateRank(incoming.State) > runtimeStateRank(task.State) {
		task.State = incoming.State
	}
	if task.StartedAt == nil ||
		(incoming.StartedAt != nil &&
			incoming.StartedAt.Before(*task.StartedAt)) {
		task.StartedAt = incoming.StartedAt
	}
	if task.Priority == nil ||
		(incoming.Priority != nil && *incoming.Priority < *task.Priority) {
		if incoming.Priority != nil {
			value := *incoming.Priority
			task.Priority = &value
		}
	}
	if task.Trigger != incoming.Trigger {
		task.Trigger = "mixed"
	}
	if task.Initiator != incoming.Initiator {
		task.Initiator = "mixed"
	}
	if incoming.UpdatedAt.After(task.UpdatedAt) {
		task.UpdatedAt = incoming.UpdatedAt
		task.Progress = incoming.Progress
	}
	if task.ActiveCount > 1 {
		task.Progress = backgroundTaskProgressDTO{
			Phase:   "active",
			Current: int64(task.RunningCount),
			Total:   int64(task.ActiveCount),
			Unit:    "task",
		}
	}
}

func runtimeStateRank(state string) int {
	switch state {
	case "cancelling":
		return 3
	case "running":
		return 2
	case "queued":
		return 1
	default:
		return 0
	}
}
