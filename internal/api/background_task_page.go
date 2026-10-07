package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const (
	backgroundTaskHistoryDomainFileOperation  = "file_operation"
	backgroundTaskHistoryDomainSyncRun        = "sync_run"
	backgroundTaskHistoryDomainArchivePrepare = "archive_prepare"
)

type backgroundTaskPageDTO struct {
	CurrentItems []backgroundTaskDTO `json:"current_items"`
	HistoryItems []backgroundTaskDTO `json:"history_items"`
	NextCursor   string              `json:"next_cursor,omitempty"`
}

type backgroundTaskHistoryCursor struct {
	UpdatedAt time.Time `json:"updated_at"`
	Domain    string    `json:"domain"`
	ID        string    `json:"id"`
}

func (s *Server) listBackgroundTaskPage(c *gin.Context) {
	s.listBackgroundTaskPageForViewer(c, false)
}

func (s *Server) adminListBackgroundTaskPage(c *gin.Context) {
	s.listBackgroundTaskPageForViewer(c, true)
}

func (s *Server) listBackgroundTaskPageForViewer(
	c *gin.Context,
	admin bool,
) {
	limit, ok := backgroundTaskLimit(c)
	if !ok {
		return
	}
	cursor, err := decodeBackgroundTaskHistoryCursor(
		strings.TrimSpace(c.Query("cursor")),
	)
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid background task cursor")
		return
	}
	var ownerID *uint64
	viewerID := userID(c)
	if !admin {
		ownerID = &viewerID
	}
	page, err := s.backgroundTaskPage(
		c.Request.Context(),
		ownerID,
		viewerID,
		admin,
		limit,
		cursor,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "list background task page failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, page)
}

func (s *Server) backgroundTaskPage(
	ctx context.Context,
	ownerID *uint64,
	viewerID uint64,
	admin bool,
	limit int,
	cursor *backgroundTaskHistoryCursor,
) (backgroundTaskPageDTO, error) {
	page := backgroundTaskPageDTO{
		CurrentItems: make([]backgroundTaskDTO, 0),
		HistoryItems: make([]backgroundTaskDTO, 0),
	}

	if cursor == nil {
		current, err := s.backgroundCurrentTasks(
			ctx,
			ownerID,
			viewerID,
			admin,
		)
		if err != nil {
			return page, err
		}
		page.CurrentItems = current
	}

	history, nextCursor, err := s.backgroundTerminalHistoryPage(
		ctx,
		ownerID,
		viewerID,
		admin,
		limit,
		cursor,
	)
	if err != nil {
		return page, err
	}
	page.HistoryItems = history
	page.NextCursor = nextCursor

	if admin {
		if err := s.populateBackgroundTaskOwnerUsernames(
			ctx,
			page.CurrentItems,
		); err != nil {
			return page, err
		}
		if err := s.populateBackgroundTaskOwnerUsernames(
			ctx,
			page.HistoryItems,
		); err != nil {
			return page, err
		}
	}
	return page, nil
}

func (s *Server) backgroundCurrentTasks(
	ctx context.Context,
	ownerID *uint64,
	viewerID uint64,
	admin bool,
) ([]backgroundTaskDTO, error) {
	out := s.backgroundClusterRuntimeTasks(
		ctx,
		ownerID,
		viewerID,
		admin,
	)

	reanalyzeIntents, err := s.backgroundPhotoIntelligenceIntentTasks(
		ctx,
		ownerID,
		viewerID,
		admin,
		backgroundTaskMaxLimit,
	)
	if err != nil {
		return nil, err
	}
	out = mergePhotoIntelligenceIntentTasks(out, reanalyzeIntents)

	cancelTasks, err := s.backgroundOwnerCancellationTasks(
		ctx,
		ownerID,
		backgroundTaskMaxLimit,
	)
	if err != nil {
		return nil, err
	}
	out = mergeBackgroundOwnerCancellationTasks(out, cancelTasks)

	activeRuns, err := s.backgroundActiveSourceRunTasks(
		ctx,
		ownerID,
		viewerID,
		admin,
		backgroundTaskMaxLimit,
	)
	if err != nil {
		return nil, err
	}
	out = append(out, activeRuns...)

	activeArchivePrepares, err := s.backgroundActiveArchivePrepareTasks(
		ctx,
		ownerID,
		viewerID,
		admin,
		backgroundTaskMaxLimit,
	)
	if err != nil {
		return nil, err
	}
	out = append(out, activeArchivePrepares...)

	if admin {
		activeOperations, err := s.backgroundActiveFileOperationTasks(
			ctx,
			ownerID,
			viewerID,
			admin,
			backgroundTaskMaxLimit,
		)
		if err != nil {
			return nil, err
		}
		out = append(out, activeOperations...)

		maintenanceTasks, err := s.backgroundSystemMaintenanceTasks(ctx)
		if err != nil {
			return nil, err
		}
		out = append(out, maintenanceTasks...)
	}

	sortBackgroundTasksActiveFirst(out)
	return out, nil
}

func sortBackgroundTasksActiveFirst(tasks []backgroundTaskDTO) {
	sort.SliceStable(tasks, func(i, j int) bool {
		activeI := backgroundTaskActiveState(tasks[i].State)
		activeJ := backgroundTaskActiveState(tasks[j].State)
		if activeI != activeJ {
			return activeI
		}
		if !tasks[i].UpdatedAt.Equal(tasks[j].UpdatedAt) {
			return tasks[i].UpdatedAt.After(tasks[j].UpdatedAt)
		}
		return tasks[i].ID < tasks[j].ID
	})
}

func backgroundTaskActiveState(state string) bool {
	switch state {
	case "queued", "running", "cancelling", "cancel_requested":
		return true
	default:
		return false
	}
}

func (s *Server) backgroundActiveFileOperationTasks(
	ctx context.Context,
	ownerID *uint64,
	viewerID uint64,
	admin bool,
	limit int,
) ([]backgroundTaskDTO, error) {
	query := s.DB.WithContext(ctx).
		Where("status IN ?", []string{
			meta.FileOperationStatusQueued,
			meta.FileOperationStatusRunning,
			meta.FileOperationStatusCancelRequested,
		}).
		Order("updated_at DESC, id ASC").
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
		out = append(out, backgroundTaskFromFileOperation(
			operation,
			viewerID,
			admin,
		))
	}
	return out, nil
}

func (s *Server) backgroundActiveSourceRunTasks(
	ctx context.Context,
	ownerID *uint64,
	viewerID uint64,
	admin bool,
	limit int,
) ([]backgroundTaskDTO, error) {
	sourceIDs, sourceByID, err := s.backgroundTaskSources(
		ctx,
		ownerID,
	)
	if err != nil || len(sourceIDs) == 0 {
		return nil, err
	}
	var runs []meta.SyncRun
	if err := s.DB.WithContext(ctx).
		Where("source_id IN ?", sourceIDs).
		Where("status = ?", meta.SyncRunStatusRunning).
		Order("updated_at DESC, id ASC").
		Limit(limit).
		Find(&runs).Error; err != nil {
		return nil, err
	}
	out := make([]backgroundTaskDTO, 0, len(runs))
	for _, run := range runs {
		source, ok := sourceByID[run.SourceID]
		if !ok {
			continue
		}
		out = append(out, backgroundTaskFromSourceRun(
			run,
			source,
			viewerID,
			admin,
		))
	}
	return out, nil
}

func (s *Server) backgroundTerminalHistoryPage(
	ctx context.Context,
	ownerID *uint64,
	viewerID uint64,
	admin bool,
	limit int,
	cursor *backgroundTaskHistoryCursor,
) ([]backgroundTaskDTO, string, error) {
	if limit <= 0 {
		limit = backgroundTaskDefaultLimit
	}
	if limit > backgroundTaskMaxLimit {
		limit = backgroundTaskMaxLimit
	}

	candidates := make([]backgroundTaskDTO, 0, limit*3+3)
	if admin {
		operations, err := s.backgroundTerminalFileOperationTasks(
			ctx,
			ownerID,
			viewerID,
			admin,
			limit+1,
			cursor,
		)
		if err != nil {
			return nil, "", err
		}
		candidates = append(candidates, operations...)
	}

	runs, err := s.backgroundTerminalSourceRunTasks(
		ctx,
		ownerID,
		viewerID,
		admin,
		limit+1,
		cursor,
	)
	if err != nil {
		return nil, "", err
	}
	candidates = append(candidates, runs...)

	archivePrepares, err := s.backgroundTerminalArchivePrepareTasks(
		ctx,
		ownerID,
		viewerID,
		admin,
		limit+1,
		cursor,
	)
	if err != nil {
		return nil, "", err
	}
	candidates = append(candidates, archivePrepares...)

	sortBackgroundTaskHistory(candidates)
	if len(candidates) <= limit {
		return candidates, "", nil
	}
	page := candidates[:limit]
	next, err := encodeBackgroundTaskHistoryCursor(page[len(page)-1])
	if err != nil {
		return nil, "", err
	}
	return page, next, nil
}

func (s *Server) backgroundTerminalFileOperationTasks(
	ctx context.Context,
	ownerID *uint64,
	viewerID uint64,
	admin bool,
	limit int,
	cursor *backgroundTaskHistoryCursor,
) ([]backgroundTaskDTO, error) {
	query := s.DB.WithContext(ctx).
		Where("status IN ?", []string{
			meta.FileOperationStatusCancelled,
			meta.FileOperationStatusCompleted,
			meta.FileOperationStatusFailed,
		})
	if ownerID != nil {
		query = query.Where("owner_id = ?", *ownerID)
	}
	query = applyBackgroundHistoryCursor(
		query,
		backgroundTaskHistoryDomainFileOperation,
		cursor,
	)
	var operations []meta.FileOperation
	if err := query.
		Order("updated_at DESC, id ASC").
		Limit(limit).
		Find(&operations).Error; err != nil {
		return nil, err
	}
	out := make([]backgroundTaskDTO, 0, len(operations))
	for _, operation := range operations {
		out = append(out, backgroundTaskFromFileOperation(
			operation,
			viewerID,
			admin,
		))
	}
	return out, nil
}

func (s *Server) backgroundTerminalSourceRunTasks(
	ctx context.Context,
	ownerID *uint64,
	viewerID uint64,
	admin bool,
	limit int,
	cursor *backgroundTaskHistoryCursor,
) ([]backgroundTaskDTO, error) {
	sourceIDs, sourceByID, err := s.backgroundTaskSources(
		ctx,
		ownerID,
	)
	if err != nil || len(sourceIDs) == 0 {
		return nil, err
	}
	query := s.DB.WithContext(ctx).
		Where("source_id IN ?", sourceIDs).
		Where("status IN ?", []string{
			meta.SyncRunStatusCompleted,
			meta.SyncRunStatusPartial,
			meta.SyncRunStatusFailed,
			meta.SyncRunStatusCancelled,
		})
	query = applyBackgroundHistoryCursor(
		query,
		backgroundTaskHistoryDomainSyncRun,
		cursor,
	)
	var runs []meta.SyncRun
	if err := query.
		Order("updated_at DESC, id ASC").
		Limit(limit).
		Find(&runs).Error; err != nil {
		return nil, err
	}
	out := make([]backgroundTaskDTO, 0, len(runs))
	for _, run := range runs {
		source, ok := sourceByID[run.SourceID]
		if !ok {
			continue
		}
		out = append(out, backgroundTaskFromSourceRun(
			run,
			source,
			viewerID,
			admin,
		))
	}
	return out, nil
}

func (s *Server) backgroundTaskSources(
	ctx context.Context,
	ownerID *uint64,
) ([]uint64, map[uint64]meta.Source, error) {
	query := s.DB.WithContext(ctx).
		Model(&meta.Source{}).
		Select("id, owner_id, name, kind")
	if ownerID != nil {
		query = query.Where("owner_id = ?", *ownerID)
	}
	var sources []meta.Source
	if err := query.Find(&sources).Error; err != nil {
		return nil, nil, err
	}
	ids := make([]uint64, 0, len(sources))
	byID := make(map[uint64]meta.Source, len(sources))
	for _, source := range sources {
		ids = append(ids, source.ID)
		byID[source.ID] = source
	}
	return ids, byID, nil
}

func backgroundTaskFromFileOperation(
	operation meta.FileOperation,
	viewerID uint64,
	admin bool,
) backgroundTaskDTO {
	task := backgroundTaskDTO{
		ID:         "file-operation:" + operation.ID,
		Kind:       "file_operation." + operation.Type,
		Domain:     backgroundTaskHistoryDomainFileOperation,
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
	return task
}

func backgroundTaskFromSourceRun(
	run meta.SyncRun,
	source meta.Source,
	viewerID uint64,
	admin bool,
) backgroundTaskDTO {
	state := run.Status
	if run.Status == meta.SyncRunStatusRunning &&
		run.CancelRequestedAt != nil {
		state = "cancelling"
	}
	priority := uint8(backgroundSyncRunPriority(run.Trigger))
	task := backgroundTaskDTO{
		ID:         "sync-run:" + run.ID,
		Kind:       "source.sync",
		Domain:     backgroundTaskHistoryDomainSyncRun,
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
	return task
}

func backgroundTaskHistoryRawID(domain, id string) (string, bool) {
	switch domain {
	case backgroundTaskHistoryDomainFileOperation:
		raw := strings.TrimPrefix(id, "file-operation:")
		return raw, raw != id && raw != ""
	case backgroundTaskHistoryDomainSyncRun:
		raw := strings.TrimPrefix(id, "sync-run:")
		return raw, raw != id && raw != ""
	case backgroundTaskHistoryDomainArchivePrepare:
		raw := strings.TrimPrefix(id, "archive-prepare:")
		return raw, raw != id && raw != ""
	default:
		return "", false
	}
}

func applyBackgroundHistoryCursor(
	query *gorm.DB,
	domain string,
	cursor *backgroundTaskHistoryCursor,
) *gorm.DB {
	if cursor == nil {
		return query
	}
	domainRank := backgroundTaskHistoryDomainRank(domain)
	cursorRank := backgroundTaskHistoryDomainRank(cursor.Domain)
	if domainRank == cursorRank {
		rawID, ok := backgroundTaskHistoryRawID(domain, cursor.ID)
		if !ok {
			return query.Where("1 = 0")
		}
		return query.Where(
			"(updated_at < ?) OR (updated_at = ? AND id > ?)",
			cursor.UpdatedAt,
			cursor.UpdatedAt,
			rawID,
		)
	}
	if domainRank < cursorRank {
		return query.Where("updated_at < ?", cursor.UpdatedAt)
	}
	return query.Where("updated_at <= ?", cursor.UpdatedAt)
}

func sortBackgroundTaskHistory(tasks []backgroundTaskDTO) {
	sort.SliceStable(tasks, func(i, j int) bool {
		if !tasks[i].UpdatedAt.Equal(tasks[j].UpdatedAt) {
			return tasks[i].UpdatedAt.After(tasks[j].UpdatedAt)
		}
		rankI := backgroundTaskHistoryDomainRank(tasks[i].Domain)
		rankJ := backgroundTaskHistoryDomainRank(tasks[j].Domain)
		if rankI != rankJ {
			return rankI < rankJ
		}
		return tasks[i].ID < tasks[j].ID
	})
}

func backgroundTaskHistoryDomainRank(domain string) int {
	switch domain {
	case backgroundTaskHistoryDomainFileOperation:
		return 0
	case backgroundTaskHistoryDomainSyncRun:
		return 1
	case backgroundTaskHistoryDomainArchivePrepare:
		return 2
	default:
		return 3
	}
}

func encodeBackgroundTaskHistoryCursor(
	task backgroundTaskDTO,
) (string, error) {
	switch task.Domain {
	case backgroundTaskHistoryDomainFileOperation,
		backgroundTaskHistoryDomainSyncRun,
		backgroundTaskHistoryDomainArchivePrepare:
	default:
		return "", fmt.Errorf("unsupported background task history domain %q", task.Domain)
	}
	cursor := backgroundTaskHistoryCursor{
		UpdatedAt: task.UpdatedAt.UTC(),
		Domain:    task.Domain,
		ID:        task.ID,
	}
	raw, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func decodeBackgroundTaskHistoryCursor(
	raw string,
) (*backgroundTaskHistoryCursor, error) {
	if raw == "" {
		return nil, nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return nil, err
	}
	var cursor backgroundTaskHistoryCursor
	if err := json.Unmarshal(payload, &cursor); err != nil {
		return nil, err
	}
	if cursor.UpdatedAt.IsZero() || cursor.ID == "" {
		return nil, fmt.Errorf("incomplete background task cursor")
	}
	switch cursor.Domain {
	case backgroundTaskHistoryDomainFileOperation:
		if !strings.HasPrefix(cursor.ID, "file-operation:") {
			return nil, fmt.Errorf("invalid file-operation cursor")
		}
	case backgroundTaskHistoryDomainSyncRun:
		if !strings.HasPrefix(cursor.ID, "sync-run:") {
			return nil, fmt.Errorf("invalid sync-run cursor")
		}
	case backgroundTaskHistoryDomainArchivePrepare:
		if !strings.HasPrefix(cursor.ID, "archive-prepare:") {
			return nil, fmt.Errorf("invalid archive-prepare cursor")
		}
	default:
		return nil, fmt.Errorf("unknown background task cursor domain")
	}
	return &cursor, nil
}
