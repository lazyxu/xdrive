package api

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/meta"
)

const (
	backgroundTaskDefaultLimit = 50
	backgroundTaskMaxLimit     = 200
)

type backgroundTaskProgressDTO struct {
	Phase        string   `json:"phase,omitempty"`
	Current      int64    `json:"current,omitempty"`
	Total        int64    `json:"total,omitempty"`
	Unit         string   `json:"unit,omitempty"`
	Percent      *float64 `json:"percent,omitempty"`
	BytesCurrent int64    `json:"bytes_current,omitempty"`
	Errors       int64    `json:"errors,omitempty"`
	CurrentItem  string   `json:"current_item,omitempty"`
}

type backgroundTaskDTO struct {
	ID             string                    `json:"id"`
	Kind           string                    `json:"kind"`
	Domain         string                    `json:"domain"`
	Scope          string                    `json:"scope"`
	OwnerID        uint64                    `json:"owner_id,omitempty"`
	OwnerUsername  string                    `json:"owner_username,omitempty"`
	State          string                    `json:"state"`
	Trigger        string                    `json:"trigger,omitempty"`
	Initiator      string                    `json:"initiator,omitempty"`
	Priority       *uint8                    `json:"priority,omitempty"`
	Resource       string                    `json:"resource,omitempty"`
	SourceID       uint64                    `json:"source_id,omitempty"`
	SourceName     string                    `json:"source_name,omitempty"`
	SourceKind     string                    `json:"source_kind,omitempty"`
	Progress       backgroundTaskProgressDTO `json:"progress"`
	ActiveCount    int                       `json:"active_count,omitempty"`
	QueuedCount    int                       `json:"queued_count,omitempty"`
	RunningCount   int                       `json:"running_count,omitempty"`
	InstanceCount  int                       `json:"instance_count,omitempty"`
	Attempt        int                       `json:"attempt,omitempty"`
	RetryAt        *time.Time                `json:"retry_at,omitempty"`
	TraceID        string                    `json:"trace_id,omitempty"`
	ParentKey      string                    `json:"parent_key,omitempty"`
	ControlActions []string                  `json:"control_actions,omitempty"`
	StartedAt      *time.Time                `json:"started_at,omitempty"`
	UpdatedAt      time.Time                 `json:"updated_at"`
	FinishedAt     *time.Time                `json:"finished_at,omitempty"`
	Error          string                    `json:"error,omitempty"`
}

func (s *Server) listBackgroundTasks(c *gin.Context) {
	limit, ok := backgroundTaskLimit(c)
	if !ok {
		return
	}
	uid := userID(c)
	tasks, err := s.backgroundTasks(
		c.Request.Context(),
		&uid,
		uid,
		false,
		limit,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "list background tasks failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, tasks)
}

func (s *Server) adminListBackgroundTasks(c *gin.Context) {
	limit, ok := backgroundTaskLimit(c)
	if !ok {
		return
	}
	tasks, err := s.backgroundTasks(
		c.Request.Context(),
		nil,
		userID(c),
		true,
		limit,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "list background tasks failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, tasks)
}

func backgroundTaskLimit(c *gin.Context) (int, bool) {
	raw := strings.TrimSpace(c.Query("limit"))
	if raw == "" {
		return backgroundTaskDefaultLimit, true
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 1 || value > backgroundTaskMaxLimit {
		fail(
			c,
			http.StatusBadRequest,
			fmt.Sprintf("limit must be between 1 and %d", backgroundTaskMaxLimit),
		)
		return 0, false
	}
	return value, true
}

func (s *Server) backgroundTasks(
	ctx context.Context,
	ownerID *uint64,
	viewerID uint64,
	admin bool,
	limit int,
) ([]backgroundTaskDTO, error) {
	out := make([]backgroundTaskDTO, 0)
	runtimeTasks := s.backgroundClusterRuntimeTasks(
		ctx,
		ownerID,
		viewerID,
		admin,
	)
	out = append(out, runtimeTasks...)

	reanalyzeIntents, err := s.backgroundPhotoIntelligenceIntentTasks(
		ctx,
		ownerID,
		viewerID,
		admin,
		limit,
	)
	if err != nil {
		return nil, err
	}
	out = mergePhotoIntelligenceIntentTasks(out, reanalyzeIntents)

	cancelTasks, err := s.backgroundOwnerCancellationTasks(
		ctx,
		ownerID,
		limit,
	)
	if err != nil {
		return nil, err
	}
	out = mergeBackgroundOwnerCancellationTasks(out, cancelTasks)

	fileOperations, err := s.backgroundFileOperationTasks(
		ctx,
		ownerID,
		viewerID,
		admin,
		limit,
	)
	if err != nil {
		return nil, err
	}
	out = append(out, fileOperations...)

	sourceRuns, err := s.backgroundSourceRunTasks(
		ctx,
		ownerID,
		viewerID,
		admin,
		limit,
	)
	if err != nil {
		return nil, err
	}
	out = append(out, sourceRuns...)

	archivePrepares, err := s.backgroundArchivePrepareTasks(
		ctx,
		ownerID,
		viewerID,
		admin,
		limit,
	)
	if err != nil {
		return nil, err
	}
	out = append(out, archivePrepares...)

	if admin {
		maintenanceTasks, err := s.backgroundSystemMaintenanceTasks(ctx)
		if err != nil {
			return nil, err
		}
		out = append(out, maintenanceTasks...)
		if err := s.populateBackgroundTaskOwnerUsernames(ctx, out); err != nil {
			return nil, err
		}
	}

	sortBackgroundTasksActiveFirst(out)
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (s *Server) populateBackgroundTaskOwnerUsernames(ctx context.Context, tasks []backgroundTaskDTO) error {
	ownerIDs := make([]uint64, 0)
	seen := make(map[uint64]struct{})
	for _, task := range tasks {
		if task.OwnerID == 0 {
			continue
		}
		if _, exists := seen[task.OwnerID]; exists {
			continue
		}
		seen[task.OwnerID] = struct{}{}
		ownerIDs = append(ownerIDs, task.OwnerID)
	}
	if len(ownerIDs) == 0 {
		return nil
	}
	var users []struct {
		ID       uint64
		Username string
	}
	if err := s.DB.WithContext(ctx).Model(&meta.User{}).Select("id, username").Where("id IN ?", ownerIDs).Find(&users).Error; err != nil {
		return err
	}
	usernameByID := make(map[uint64]string, len(users))
	for _, user := range users {
		usernameByID[user.ID] = user.Username
	}
	for index := range tasks {
		tasks[index].OwnerUsername = usernameByID[tasks[index].OwnerID]
	}
	return nil
}

type runtimeTaskGroup struct {
	task backgroundTaskDTO
}

func aggregateRuntimeBackgroundTasks(
	snapshots []background.RuntimeTaskSnapshot,
	viewerID uint64,
	admin bool,
) []backgroundTaskDTO {
	groups := make(map[string]*runtimeTaskGroup)
	for _, snapshot := range snapshots {
		kind := strings.TrimSpace(snapshot.Kind)
		if (snapshot.Identity.Scope == background.ScopeSystem &&
			strings.HasPrefix(kind, "system.maintenance.")) ||
			kind == "archive.prepare" {
			continue
		}
		if kind == "" {
			kind = "runtime"
		}
		groupKey := fmt.Sprintf(
			"%s:%d:%s",
			snapshot.Identity.Scope,
			snapshot.Identity.OwnerID,
			kind,
		)
		group := groups[groupKey]
		if group == nil {
			priority := uint8(snapshot.Priority)
			group = &runtimeTaskGroup{task: backgroundTaskDTO{
				ID:            "runtime:" + groupKey,
				Kind:          kind,
				Domain:        "scheduler",
				Scope:         string(snapshot.Identity.Scope),
				OwnerID:       snapshot.Identity.OwnerID,
				State:         snapshot.State,
				Trigger:       string(snapshot.Trigger),
				Initiator:     string(snapshot.Initiator),
				Priority:      &priority,
				Resource:      string(snapshot.Resource),
				StartedAt:     snapshot.StartedAt,
				UpdatedAt:     snapshot.UpdatedAt,
				ActiveCount:   1,
				InstanceCount: 1,
				Attempt:       snapshot.Attempt,
				TraceID:       snapshot.TraceID,
				ParentKey:     snapshot.ParentKey,
			}}
			group.task.Progress = toBackgroundTaskProgress(snapshot.Progress)
			groups[groupKey] = group
		} else {
			group.task.ActiveCount++
			if snapshot.UpdatedAt.After(group.task.UpdatedAt) {
				group.task.UpdatedAt = snapshot.UpdatedAt
			}
			if group.task.StartedAt == nil ||
				(snapshot.StartedAt != nil &&
					snapshot.StartedAt.Before(*group.task.StartedAt)) {
				group.task.StartedAt = snapshot.StartedAt
			}
			if uint8(snapshot.Priority) < *group.task.Priority {
				value := uint8(snapshot.Priority)
				group.task.Priority = &value
			}
			if group.task.Trigger != string(snapshot.Trigger) {
				group.task.Trigger = "mixed"
			}
			if group.task.Initiator != string(snapshot.Initiator) {
				group.task.Initiator = "mixed"
			}
			if snapshot.Attempt > group.task.Attempt {
				group.task.Attempt = snapshot.Attempt
			}
			if group.task.TraceID != snapshot.TraceID {
				group.task.TraceID = ""
			}
			if group.task.ParentKey != snapshot.ParentKey {
				group.task.ParentKey = ""
			}
		}
		if snapshot.State == "queued" && snapshot.ReadyAt != nil &&
			(group.task.RetryAt == nil || snapshot.ReadyAt.Before(*group.task.RetryAt)) {
			value := snapshot.ReadyAt.UTC()
			group.task.RetryAt = &value
		}

		group.task.ControlActions = backgroundRuntimeControlActions(
			kind,
			snapshot.Identity.Scope,
			snapshot.Identity.OwnerID,
			viewerID,
			admin,
		)
		if snapshot.LeaseDeferred && snapshot.State == "queued" {
			group.task.Progress = backgroundTaskProgressDTO{
				Phase: "waiting_for_cluster_lease",
			}
		}

		switch snapshot.State {
		case "cancelling":
			group.task.State = "cancelling"
			group.task.RunningCount++
		case "running":
			if group.task.State != "cancelling" {
				group.task.State = "running"
			}
			group.task.RunningCount++
		default:
			group.task.QueuedCount++
		}
		if group.task.ActiveCount > 1 {
			group.task.Progress = backgroundTaskProgressDTO{
				Phase:   "active",
				Current: int64(group.task.RunningCount),
				Total:   int64(group.task.ActiveCount),
				Unit:    "task",
			}
		}
	}

	out := make([]backgroundTaskDTO, 0, len(groups))
	for _, group := range groups {
		out = append(out, group.task)
	}
	return out
}

func toBackgroundTaskProgress(
	progress background.TaskProgress,
) backgroundTaskProgressDTO {
	out := backgroundTaskProgressDTO{
		Phase:       progress.Phase,
		Current:     progress.Current,
		Total:       progress.Total,
		Unit:        progress.Unit,
		CurrentItem: progress.Message,
	}
	if progress.Total > 0 {
		value := float64(progress.Current) * 100 / float64(progress.Total)
		if value < 0 {
			value = 0
		}
		if value > 100 {
			value = 100
		}
		out.Percent = &value
	}
	return out
}

func (s *Server) backgroundFileOperationTasks(
	ctx context.Context,
	ownerID *uint64,
	viewerID uint64,
	admin bool,
	limit int,
) ([]backgroundTaskDTO, error) {
	query := s.DB.WithContext(ctx).
		Model(&meta.FileOperation{}).
		Order("updated_at DESC, created_at DESC").
		Limit(limit)
	if ownerID != nil {
		query = query.Where("owner_id = ?", *ownerID)
	}
	var operations []meta.FileOperation
	if err := query.Find(&operations).Error; err != nil {
		return nil, err
	}

	out := make([]backgroundTaskDTO, 0, len(operations))
	for _, operation := range operations {
		task := backgroundTaskDTO{
			ID:         "file-operation:" + operation.ID,
			Kind:       "file_operation." + operation.Type,
			Domain:     "file_operation",
			Scope:      string(background.ScopeUser),
			OwnerID:    operation.OwnerID,
			State:      operation.Status,
			Trigger:    string(background.TriggerUserAction),
			Initiator:  string(background.InitiatorUser),
			StartedAt:  operation.StartedAt,
			UpdatedAt:  operation.UpdatedAt,
			FinishedAt: operation.FinishedAt,
			Error:      operation.Error,
		}
		task.Progress = fileOperationBackgroundProgress(operation)
		task.ControlActions = backgroundFileOperationControlActions(
			operation,
			viewerID,
			admin,
		)
		out = append(out, task)
	}
	return out, nil
}

func fileOperationBackgroundProgress(
	operation meta.FileOperation,
) backgroundTaskProgressDTO {
	out := backgroundTaskProgressDTO{
		Phase:       operation.Status,
		CurrentItem: operation.CurrentItem,
	}
	switch {
	case operation.TotalBytes > 0:
		out.Current = operation.ProcessedBytes
		out.Total = operation.TotalBytes
		out.Unit = "byte"
	case operation.TotalItems > 0:
		out.Current = operation.ProcessedItems
		out.Total = operation.TotalItems
		out.Unit = "item"
	default:
		out.Unit = "item"
	}
	if out.Total > 0 {
		value := float64(out.Current) * 100 / float64(out.Total)
		if operation.Status == meta.FileOperationStatusCompleted {
			value = 100
		}
		if value < 0 {
			value = 0
		}
		if value > 100 {
			value = 100
		}
		out.Percent = &value
	}
	return out
}

func (s *Server) backgroundSourceRunTasks(
	ctx context.Context,
	ownerID *uint64,
	viewerID uint64,
	admin bool,
	limit int,
) ([]backgroundTaskDTO, error) {
	sourceQuery := s.DB.WithContext(ctx).
		Model(&meta.Source{}).
		Select("id, owner_id, name, kind")
	if ownerID != nil {
		sourceQuery = sourceQuery.Where("owner_id = ?", *ownerID)
	}
	var sources []meta.Source
	if err := sourceQuery.Find(&sources).Error; err != nil {
		return nil, err
	}
	if len(sources) == 0 {
		return nil, nil
	}

	sourceIDs := make([]uint64, 0, len(sources))
	sourceByID := make(map[uint64]meta.Source, len(sources))
	for _, source := range sources {
		sourceIDs = append(sourceIDs, source.ID)
		sourceByID[source.ID] = source
	}

	var runs []meta.SyncRun
	if err := s.DB.WithContext(ctx).
		Where("source_id IN ?", sourceIDs).
		Order("updated_at DESC, started_at DESC").
		Limit(limit).
		Find(&runs).Error; err != nil {
		return nil, err
	}

	out := make([]backgroundTaskDTO, 0, len(runs))
	for _, run := range runs {
		source, exists := sourceByID[run.SourceID]
		if !exists {
			continue
		}
		state := run.Status
		if run.Status == meta.SyncRunStatusRunning &&
			run.CancelRequestedAt != nil {
			state = "cancelling"
		}
		priority := uint8(backgroundSyncRunPriority(run.Trigger))
		task := backgroundTaskDTO{
			ID:         "sync-run:" + run.ID,
			Kind:       "source.sync",
			Domain:     "sync_run",
			Scope:      string(background.ScopeUser),
			OwnerID:    source.OwnerID,
			State:      state,
			Trigger:    backgroundSyncRunTrigger(run.Trigger),
			Initiator:  backgroundSyncRunInitiator(run.Trigger),
			Priority:   &priority,
			Resource:   string(background.ResourceNetwork),
			SourceID:   source.ID,
			SourceName: source.Name,
			SourceKind: source.Kind,
			StartedAt:  &run.StartedAt,
			UpdatedAt:  run.UpdatedAt,
			FinishedAt: run.FinishedAt,
			Error:      run.Error,
		}
		task.Progress = sourceRunBackgroundProgress(run)
		task.ControlActions = backgroundSourceRunControlActions(
			source.OwnerID,
			run,
			viewerID,
			admin,
		)
		out = append(out, task)
	}
	return out, nil
}

func backgroundSyncRunTrigger(trigger string) string {
	switch trigger {
	case meta.SyncRunTriggerManual:
		return string(background.TriggerUserAction)
	case meta.SyncRunTriggerScheduled:
		return string(background.TriggerSchedule)
	case meta.SyncRunTriggerEvent:
		return string(background.TriggerSystemEvent)
	case meta.SyncRunTriggerReconcile:
		return string(background.TriggerReconcile)
	default:
		return trigger
	}
}

func backgroundSyncRunInitiator(trigger string) string {
	if trigger == meta.SyncRunTriggerManual {
		return string(background.InitiatorUser)
	}
	return string(background.InitiatorSystem)
}

func backgroundSyncRunPriority(trigger string) background.Priority {
	if trigger == meta.SyncRunTriggerManual {
		return background.PriorityP0
	}
	return background.PriorityP2
}

func sourceRunBackgroundProgress(
	run meta.SyncRun,
) backgroundTaskProgressDTO {
	out := backgroundTaskProgressDTO{
		Phase:       run.Status,
		CurrentItem: run.ActiveTransferPath,
	}
	switch {
	case run.PlannedTransferBytes > 0:
		out.Current = run.ProcessedTransferBytes
		out.Total = run.PlannedTransferBytes
		out.Unit = "byte"
	case run.PlannedTransferItems > 0:
		out.Current = run.ProcessedTransferItems
		out.Total = run.PlannedTransferItems
		out.Unit = "item"
	default:
		out.Current = run.ScannedItems
		out.Unit = "item"
	}
	if out.Total > 0 {
		value := float64(out.Current) * 100 / float64(out.Total)
		if value < 0 {
			value = 0
		}
		if value > 100 {
			value = 100
		}
		out.Percent = &value
	}
	return out
}
