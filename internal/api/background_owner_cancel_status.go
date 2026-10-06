package api

import (
	"context"
	"fmt"

	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/meta"
)

func backgroundOwnerCancellationTaskShape(
	kind string,
) (background.Priority, background.ResourceClass, bool) {
	switch kind {
	case "media.index":
		return background.PriorityP1, background.ResourceMediaCPU, true
	case "photo.face":
		return background.PriorityP2, background.ResourceMLCPU, true
	case "photo.place", "photo.person_cluster":
		return background.PriorityP3, background.ResourceBackgroundCPU, true
	default:
		return 0, "", false
	}
}

func backgroundOwnerCancellationTrigger(initiator string) background.Trigger {
	if initiator == string(background.InitiatorAdmin) {
		return background.TriggerAdminAction
	}
	return background.TriggerUserAction
}

func (s *Server) backgroundOwnerCancellationTasks(
	ctx context.Context,
	ownerID *uint64,
	limit int,
) ([]backgroundTaskDTO, error) {
	if s == nil || s.DB == nil {
		return nil, nil
	}
	if limit <= 0 {
		limit = backgroundTaskDefaultLimit
	}
	query := s.DB.WithContext(ctx).
		Order("updated_at DESC, owner_id ASC, kind ASC").
		Limit(limit)
	if ownerID != nil {
		query = query.Where("owner_id = ?", *ownerID)
	}
	var rows []meta.BackgroundOwnerCancellation
	if err := query.Find(&rows).Error; err != nil {
		return nil, err
	}

	out := make([]backgroundTaskDTO, 0, len(rows))
	for _, row := range rows {
		if row.RequestedEpoch == 0 {
			continue
		}
		priority, resource, ok := backgroundOwnerCancellationTaskShape(row.Kind)
		if !ok {
			continue
		}
		state := "cancelled"
		finishedAt := row.AppliedAt
		progress := backgroundTaskProgressDTO{}
		if row.RequestedEpoch > row.AppliedEpoch {
			state = "cancel_requested"
			finishedAt = nil
			progress.Phase = "cancel_requested"
		}
		priorityValue := uint8(priority)
		out = append(out, backgroundTaskDTO{
			ID: "runtime:" + string(background.ScopeUser) + ":" +
				fmt.Sprintf("%d", row.OwnerID) + ":" + row.Kind,
			Kind:       row.Kind,
			Domain:     "scheduler",
			Scope:      string(background.ScopeUser),
			OwnerID:    row.OwnerID,
			State:      state,
			Trigger:    string(backgroundOwnerCancellationTrigger(row.Initiator)),
			Initiator:  row.Initiator,
			Priority:   &priorityValue,
			Resource:   string(resource),
			Progress:   progress,
			UpdatedAt:  row.UpdatedAt,
			FinishedAt: finishedAt,
		})
	}
	return out, nil
}

func mergeBackgroundOwnerCancellationTasks(
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
			task.State = cancelTask.State
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
