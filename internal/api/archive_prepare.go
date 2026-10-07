package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourceaccount"
	"gorm.io/gorm"
)

const (
	archivePrepareReconcileInterval = 30 * time.Second
	archivePrepareHeartbeatInterval = 5 * time.Second
	archivePrepareRunTimeout        = 30 * time.Minute
	archivePrepareHistoryRetention  = 30 * 24 * time.Hour

	archivePrepareTaskSelect = "id, owner_id, status, filename, error, started_at, updated_at, finished_at"
)

var (
	errArchivePrepareUnavailable = errors.New("archive prepare is unavailable")
	errArchivePrepareExpired     = errors.New("archive prepare expired")
)

type archivePreparedManifest struct {
	Filename   string                 `json:"filename"`
	TotalBytes int64                  `json:"total_bytes"`
	Entries    []archiveDownloadEntry `json:"entries"`
}

func archivePrepareTaskID(runID string) string {
	return "archive-prepare:" + strings.TrimSpace(runID)
}

func archivePrepareSchedulerIdentity(run meta.ArchivePrepareRun) background.Identity {
	return background.Identity{
		Scope:   background.ScopeUser,
		OwnerID: run.OwnerID,
		Key:     "archive.prepare:" + run.ID,
	}
}

func archivePrepareLeaseKey(runID string) string {
	return "archive-prepare:" + strings.TrimSpace(runID)
}

func archivePrepareIDs(run meta.ArchivePrepareRun) ([]uint64, error) {
	var ids []uint64
	if err := json.Unmarshal([]byte(run.RequestedIDsJSON), &ids); err != nil {
		return nil, err
	}
	normalized, ok := normalizeArchiveDownloadIDs(ids)
	if !ok {
		return nil, fmt.Errorf("stored archive selection is invalid")
	}
	return normalized, nil
}

func (s *Server) requestArchivePrepareRun(
	ctx context.Context,
	ownerID uint64,
	ids []uint64,
) (meta.ArchivePrepareRun, error) {
	normalized, ok := normalizeArchiveDownloadIDs(ids)
	if !ok {
		return meta.ArchivePrepareRun{}, fmt.Errorf("invalid archive selection")
	}
	raw, err := json.Marshal(normalized)
	if err != nil {
		return meta.ArchivePrepareRun{}, err
	}
	now := time.Now().UTC()
	run := meta.ArchivePrepareRun{
		ID:               uuid.NewString(),
		OwnerID:          ownerID,
		RequestedIDsJSON: string(raw),
		Status:           meta.ArchivePrepareStatusQueued,
		ExpiresAt:        now.Add(archiveDownloadProgressTTL),
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if err := s.DB.WithContext(ctx).Create(&run).Error; err != nil {
		return meta.ArchivePrepareRun{}, err
	}
	if err := s.submitArchivePrepareRun(run); err != nil &&
		!errors.Is(err, background.ErrQueueFull) {
		slog.Warn("archive_prepare_submit_deferred", "run_id", run.ID, "error", err)
	}
	return run, nil
}

func (s *Server) submitArchivePrepareRun(run meta.ArchivePrepareRun) error {
	if s == nil || s.BackgroundScheduler == nil {
		return nil
	}
	_, err := s.BackgroundScheduler.Submit(background.Task{
		Key:               "archive.prepare:" + run.ID,
		Kind:              "archive.prepare",
		GroupKey:          "archive.prepare",
		Scope:             background.ScopeUser,
		OwnerID:           run.OwnerID,
		Trigger:           background.TriggerUserAction,
		Initiator:         background.InitiatorUser,
		InitiatorID:       run.OwnerID,
		Priority:          background.PriorityP0,
		Resource:          background.ResourceInteractiveIO,
		Lease:             s.archivePrepareLeaseProvider(run.ID),
		HeartbeatInterval: archivePrepareHeartbeatInterval,
		RunTimeout:        archivePrepareRunTimeout,
		Run: func(ctx context.Context) error {
			return s.executeArchivePrepareRun(ctx, run.ID)
		},
	})
	return err
}

func (s *Server) archivePrepareLeaseProvider(runID string) background.LeaseProvider {
	return func(ctx context.Context, _ background.Descriptor) (background.Lease, bool, error) {
		if s == nil || s.DB == nil {
			return background.Lease{}, false, errors.New("archive prepare lease is not configured")
		}
		lease, acquired, err := sourceaccount.TryAcquire(ctx, s.DB, archivePrepareLeaseKey(runID))
		if err != nil || !acquired {
			return background.Lease{}, acquired, err
		}
		cancelled, err := s.archivePrepareCancellationRequested(ctx, runID)
		if err != nil {
			lease.Close()
			return background.Lease{}, false, err
		}
		if cancelled {
			lease.Close()
			return background.Lease{}, false, context.Canceled
		}
		return background.Lease{
			Heartbeat: func(heartbeatCtx context.Context) error {
				if err := lease.Heartbeat(heartbeatCtx); err != nil {
					return err
				}
				cancelled, err := s.archivePrepareCancellationRequested(heartbeatCtx, runID)
				if err != nil {
					return err
				}
				if cancelled {
					return context.Canceled
				}
				return nil
			},
			Release: func(context.Context, error) error {
				lease.Close()
				return nil
			},
		}, true, nil
	}
}

func (s *Server) archivePrepareCancellationRequested(ctx context.Context, runID string) (bool, error) {
	var row struct {
		Status string
	}
	if err := s.DB.WithContext(ctx).
		Model(&meta.ArchivePrepareRun{}).
		Select("status").
		Where("id = ?", runID).
		First(&row).Error; err != nil {
		return false, err
	}
	return row.Status == meta.ArchivePrepareStatusCancelRequested ||
		row.Status == meta.ArchivePrepareStatusCancelled, nil
}

func (s *Server) handleArchivePrepareInterruption(runID string, cause error) error {
	if cause == nil {
		cause = context.Canceled
	}
	checkCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cancelled, err := s.archivePrepareCancellationRequested(checkCtx, runID)
	if err == nil && cancelled {
		s.finishArchivePrepareCancelled(runID)
		return context.Canceled
	}
	if errors.Is(cause, background.ErrRunTimeout) ||
		errors.Is(cause, context.DeadlineExceeded) {
		s.finishArchivePrepareFailed(runID, cause)
	}
	// Server shutdown, scheduler close and lease loss are ownership/liveness
	// interruptions, not user cancellation. Keep the durable running row so the
	// next reconcile pass can fence the stale owner and requeue it.
	return cause
}

func (s *Server) executeArchivePrepareRun(ctx context.Context, runID string) error {
	var run meta.ArchivePrepareRun
	if err := s.DB.WithContext(ctx).Where("id = ?", runID).First(&run).Error; err != nil {
		return err
	}
	switch run.Status {
	case meta.ArchivePrepareStatusCompleted, meta.ArchivePrepareStatusFailed:
		return nil
	case meta.ArchivePrepareStatusCancelled, meta.ArchivePrepareStatusCancelRequested:
		s.finishArchivePrepareCancelled(run.ID)
		return context.Canceled
	case meta.ArchivePrepareStatusQueued:
	default:
		return fmt.Errorf("archive prepare has invalid status %q", run.Status)
	}

	now := time.Now().UTC()
	result := s.DB.WithContext(ctx).
		Model(&meta.ArchivePrepareRun{}).
		Where("id = ? AND status = ?", run.ID, meta.ArchivePrepareStatusQueued).
		Updates(map[string]any{
			"status":     meta.ArchivePrepareStatusRunning,
			"started_at": now,
			"error":      "",
		})
	if result.Error != nil {
		if ctx.Err() != nil {
			return s.handleArchivePrepareInterruption(run.ID, context.Cause(ctx))
		}
		return result.Error
	}
	if result.RowsAffected == 0 {
		return nil
	}
	run.Status = meta.ArchivePrepareStatusRunning
	run.StartedAt = &now

	ids, err := archivePrepareIDs(run)
	if err != nil {
		s.finishArchivePrepareFailed(run.ID, err)
		return err
	}
	manifest, err := s.buildArchiveDownloadManifest(ctx, run.OwnerID, ids)
	if err != nil {
		if ctx.Err() != nil {
			return s.handleArchivePrepareInterruption(run.ID, context.Cause(ctx))
		}
		s.finishArchivePrepareFailed(run.ID, err)
		return err
	}
	if ctx.Err() != nil {
		return s.handleArchivePrepareInterruption(run.ID, context.Cause(ctx))
	}
	if cancelled, cancelErr := s.archivePrepareCancellationRequested(ctx, run.ID); cancelErr != nil {
		s.finishArchivePrepareFailed(run.ID, cancelErr)
		return cancelErr
	} else if cancelled {
		s.finishArchivePrepareCancelled(run.ID)
		return context.Canceled
	}

	filename := archiveDownloadFilename(manifest.Roots)
	prepared := archivePreparedManifest{
		Filename:   filename,
		TotalBytes: manifest.TotalBytes,
		Entries:    manifest.Entries,
	}
	rawManifest, err := json.Marshal(prepared)
	if err != nil {
		s.finishArchivePrepareFailed(run.ID, err)
		return err
	}
	finished := time.Now().UTC()
	result = s.DB.WithContext(ctx).
		Model(&meta.ArchivePrepareRun{}).
		Where("id = ? AND status = ?", run.ID, meta.ArchivePrepareStatusRunning).
		Updates(map[string]any{
			"status":        meta.ArchivePrepareStatusCompleted,
			"filename":      filename,
			"total_bytes":   manifest.TotalBytes,
			"manifest_json": string(rawManifest),
			"finished_at":   finished,
			"expires_at":    finished.Add(archiveDownloadProgressTTL),
			"error":         "",
		})
	if result.Error != nil {
		if ctx.Err() != nil {
			return s.handleArchivePrepareInterruption(run.ID, context.Cause(ctx))
		}
		return result.Error
	}
	if result.RowsAffected == 0 {
		return s.handleArchivePrepareInterruption(run.ID, context.Canceled)
	}
	_ = s.seedArchiveDownloadProgress(run.OwnerID, run.ID, ids, filename, manifest)
	return nil
}

func (s *Server) finishArchivePrepareFailed(runID string, runErr error) {
	if s == nil || s.DB == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	finished := time.Now().UTC()
	_ = s.DB.WithContext(ctx).
		Model(&meta.ArchivePrepareRun{}).
		Where("id = ? AND status IN ?", runID, []string{
			meta.ArchivePrepareStatusQueued,
			meta.ArchivePrepareStatusRunning,
		}).
		Updates(map[string]any{
			"status":      meta.ArchivePrepareStatusFailed,
			"error":       runErr.Error(),
			"finished_at": finished,
		}).Error
}

func (s *Server) finishArchivePrepareCancelled(runID string) {
	if s == nil || s.DB == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	now := time.Now().UTC()
	_ = s.DB.WithContext(ctx).
		Model(&meta.ArchivePrepareRun{}).
		Where("id = ? AND status IN ?", runID, []string{
			meta.ArchivePrepareStatusQueued,
			meta.ArchivePrepareStatusRunning,
			meta.ArchivePrepareStatusCancelRequested,
		}).
		Updates(map[string]any{
			"status":              meta.ArchivePrepareStatusCancelled,
			"cancel_requested_at": now,
			"finished_at":         now,
		}).Error
}

func (s *Server) requestArchivePrepareCancel(
	ctx context.Context,
	run meta.ArchivePrepareRun,
) error {
	now := time.Now().UTC()
	switch run.Status {
	case meta.ArchivePrepareStatusQueued:
		result := s.DB.WithContext(ctx).
			Model(&meta.ArchivePrepareRun{}).
			Where("id = ? AND status = ?", run.ID, meta.ArchivePrepareStatusQueued).
			Updates(map[string]any{
				"status":              meta.ArchivePrepareStatusCancelled,
				"cancel_requested_at": now,
				"finished_at":         now,
			})
		if result.Error != nil {
			return result.Error
		}
	case meta.ArchivePrepareStatusRunning:
		result := s.DB.WithContext(ctx).
			Model(&meta.ArchivePrepareRun{}).
			Where("id = ? AND status = ?", run.ID, meta.ArchivePrepareStatusRunning).
			Updates(map[string]any{
				"status":              meta.ArchivePrepareStatusCancelRequested,
				"cancel_requested_at": now,
			})
		if result.Error != nil {
			return result.Error
		}
	case meta.ArchivePrepareStatusCancelRequested:
		return nil
	default:
		return errBackgroundTaskControlUnavailable
	}
	if s.BackgroundScheduler != nil {
		_ = s.BackgroundScheduler.Cancel(archivePrepareSchedulerIdentity(run))
	}
	return nil
}

func (s *Server) StartArchivePrepareTasks(ctx context.Context) {
	if s == nil || s.DB == nil || s.BackgroundScheduler == nil {
		return
	}
	go func() {
		s.reconcileArchivePrepareTasks(ctx)
		ticker := time.NewTicker(archivePrepareReconcileInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.reconcileArchivePrepareTasks(ctx)
			}
		}
	}()
}

func (s *Server) reconcileArchivePrepareTasks(ctx context.Context) {
	if s == nil || s.DB == nil || s.BackgroundScheduler == nil {
		return
	}
	now := time.Now().UTC()
	_ = s.DB.WithContext(ctx).
		Model(&meta.ArchivePrepareRun{}).
		Where(
			"status = ? AND expires_at <= ? AND manifest_json <> ''",
			meta.ArchivePrepareStatusCompleted,
			now,
		).
		UpdateColumn("manifest_json", "").Error

	cutoff := now.Add(-archivePrepareHistoryRetention)
	_ = s.DB.WithContext(ctx).
		Where("status IN ? AND finished_at < ?", []string{
			meta.ArchivePrepareStatusCompleted,
			meta.ArchivePrepareStatusFailed,
			meta.ArchivePrepareStatusCancelled,
		}, cutoff).
		Delete(&meta.ArchivePrepareRun{}).Error

	var runs []meta.ArchivePrepareRun
	if err := s.DB.WithContext(ctx).
		Where("status IN ?", []string{
			meta.ArchivePrepareStatusQueued,
			meta.ArchivePrepareStatusRunning,
			meta.ArchivePrepareStatusCancelRequested,
		}).
		Order("created_at ASC").
		Limit(backgroundTaskMaxLimit).
		Find(&runs).Error; err != nil {
		slog.Warn("archive_prepare_reconcile_failed", "error", err)
		return
	}
	for _, run := range runs {
		if run.Status == meta.ArchivePrepareStatusCancelRequested {
			held, err := sourceaccount.IsHeld(ctx, s.DB, archivePrepareLeaseKey(run.ID))
			if err == nil && !held {
				s.finishArchivePrepareCancelled(run.ID)
			}
			continue
		}
		if run.Status == meta.ArchivePrepareStatusRunning {
			held, err := sourceaccount.IsHeld(ctx, s.DB, archivePrepareLeaseKey(run.ID))
			if err != nil || held {
				continue
			}
			result := s.DB.WithContext(ctx).
				Model(&meta.ArchivePrepareRun{}).
				Where("id = ? AND status = ?", run.ID, meta.ArchivePrepareStatusRunning).
				Updates(map[string]any{
					"status":     meta.ArchivePrepareStatusQueued,
					"started_at": nil,
				})
			if result.Error != nil || result.RowsAffected == 0 {
				continue
			}
			run.Status = meta.ArchivePrepareStatusQueued
			run.StartedAt = nil
		}
		if err := s.submitArchivePrepareRun(run); err != nil &&
			!errors.Is(err, background.ErrQueueFull) {
			slog.Warn("archive_prepare_reconcile_submit_failed", "run_id", run.ID, "error", err)
		}
	}
}

func archivePrepareResponseFromRun(run meta.ArchivePrepareRun) (archiveDownloadPrepareResponse, error) {
	response := archiveDownloadPrepareResponse{
		TransferID: run.ID,
		State:      run.Status,
		Filename:   run.Filename,
		TotalBytes: run.TotalBytes,
		Error:      run.Error,
	}
	if run.ManifestJSON == "" {
		return response, nil
	}
	var prepared archivePreparedManifest
	if err := json.Unmarshal([]byte(run.ManifestJSON), &prepared); err != nil {
		return archiveDownloadPrepareResponse{}, err
	}
	response.Filename = prepared.Filename
	response.TotalBytes = prepared.TotalBytes
	response.Files = archiveDownloadManifestFiles(archiveDownloadManifest{
		Entries:    prepared.Entries,
		TotalBytes: prepared.TotalBytes,
	})
	return response, nil
}

func (s *Server) prepareArchiveDownload(c *gin.Context) {
	var req archiveDownloadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	ids, ok := normalizeArchiveDownloadIDs(req.IDs)
	if !ok {
		fail(c, http.StatusBadRequest, "ids must contain between 1 and 1000 valid node ids")
		return
	}
	run, err := s.requestArchivePrepareRun(c.Request.Context(), userID(c), ids)
	if err != nil {
		fail(c, http.StatusInternalServerError, "queue archive prepare failed")
		return
	}
	response, err := archivePrepareResponseFromRun(run)
	if err != nil {
		fail(c, http.StatusInternalServerError, "encode archive prepare failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusAccepted, response)
}

func (s *Server) getArchiveDownloadPrepare(c *gin.Context) {
	runID := strings.TrimSpace(c.Param("id"))
	if runID == "" {
		fail(c, http.StatusBadRequest, "invalid archive prepare id")
		return
	}
	var run meta.ArchivePrepareRun
	if err := s.DB.WithContext(c.Request.Context()).
		Where("id = ? AND owner_id = ?", runID, userID(c)).
		First(&run).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "archive prepare not found")
			return
		}
		fail(c, http.StatusInternalServerError, "load archive prepare failed")
		return
	}
	if run.Status == meta.ArchivePrepareStatusCompleted &&
		time.Now().UTC().After(run.ExpiresAt) {
		fail(c, http.StatusGone, errArchivePrepareExpired.Error())
		return
	}
	response, err := archivePrepareResponseFromRun(run)
	if err != nil {
		fail(c, http.StatusInternalServerError, "decode archive prepare failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, response)
}

func (s *Server) loadArchivePreparedManifest(
	ctx context.Context,
	ownerID uint64,
	transferID string,
	ids []uint64,
) (archiveDownloadManifest, string, bool, error) {
	var run meta.ArchivePrepareRun
	err := s.DB.WithContext(ctx).
		Where("id = ? AND owner_id = ?", transferID, ownerID).
		First(&run).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return archiveDownloadManifest{}, "", false, nil
	}
	if err != nil {
		return archiveDownloadManifest{}, "", false, err
	}
	if time.Now().UTC().After(run.ExpiresAt) {
		return archiveDownloadManifest{}, "", true, errArchivePrepareExpired
	}
	if run.Status != meta.ArchivePrepareStatusCompleted {
		return archiveDownloadManifest{}, "", true, fmt.Errorf("%w: status=%s", errArchivePrepareUnavailable, run.Status)
	}
	storedIDs, err := archivePrepareIDs(run)
	if err != nil {
		return archiveDownloadManifest{}, "", true, err
	}
	if !sameArchiveProgressIDs(storedIDs, normalizedArchiveProgressIDs(ids)) {
		return archiveDownloadManifest{}, "", true, errArchiveProgressMismatch
	}
	var prepared archivePreparedManifest
	if err := json.Unmarshal([]byte(run.ManifestJSON), &prepared); err != nil {
		return archiveDownloadManifest{}, "", true, err
	}
	if strings.TrimSpace(prepared.Filename) == "" {
		return archiveDownloadManifest{}, "", true, errors.New("stored archive filename is missing")
	}
	return archiveDownloadManifest{
		Entries:    prepared.Entries,
		TotalBytes: prepared.TotalBytes,
	}, prepared.Filename, true, nil
}

func archivePrepareControlActions(
	run meta.ArchivePrepareRun,
	viewerID uint64,
	admin bool,
) []string {
	if run.OwnerID != viewerID && !admin {
		return nil
	}
	switch run.Status {
	case meta.ArchivePrepareStatusQueued, meta.ArchivePrepareStatusRunning:
		return []string{backgroundTaskActionCancel}
	default:
		return nil
	}
}

func backgroundTaskFromArchivePrepare(
	run meta.ArchivePrepareRun,
	viewerID uint64,
	admin bool,
) backgroundTaskDTO {
	priority := uint8(background.PriorityP0)
	task := backgroundTaskDTO{
		ID:         archivePrepareTaskID(run.ID),
		Kind:       "archive.prepare",
		Domain:     backgroundTaskHistoryDomainArchivePrepare,
		Scope:      string(background.ScopeUser),
		OwnerID:    run.OwnerID,
		State:      run.Status,
		Trigger:    string(background.TriggerUserAction),
		Initiator:  string(background.InitiatorUser),
		Priority:   &priority,
		Resource:   string(background.ResourceInteractiveIO),
		StartedAt:  run.StartedAt,
		UpdatedAt:  run.UpdatedAt,
		FinishedAt: run.FinishedAt,
		Error:      run.Error,
	}
	task.Progress = backgroundTaskProgressDTO{
		Phase:       "archive_prepare",
		CurrentItem: run.Filename,
	}
	if run.Status == meta.ArchivePrepareStatusCompleted {
		task.Progress.Current = 1
		task.Progress.Total = 1
		task.Progress.Unit = "task"
		value := 100.0
		task.Progress.Percent = &value
	}
	task.ControlActions = archivePrepareControlActions(run, viewerID, admin)
	return task
}

func (s *Server) backgroundArchivePrepareTasks(
	ctx context.Context,
	ownerID *uint64,
	viewerID uint64,
	admin bool,
	limit int,
) ([]backgroundTaskDTO, error) {
	query := s.DB.WithContext(ctx).
		Select(archivePrepareTaskSelect).
		Order("updated_at DESC, id ASC").
		Limit(limit)
	if ownerID != nil {
		query = query.Where("owner_id = ?", *ownerID)
	}
	var runs []meta.ArchivePrepareRun
	if err := query.Find(&runs).Error; err != nil {
		return nil, err
	}
	out := make([]backgroundTaskDTO, 0, len(runs))
	for _, run := range runs {
		out = append(out, backgroundTaskFromArchivePrepare(run, viewerID, admin))
	}
	return out, nil
}

func (s *Server) backgroundActiveArchivePrepareTasks(
	ctx context.Context,
	ownerID *uint64,
	viewerID uint64,
	admin bool,
	limit int,
) ([]backgroundTaskDTO, error) {
	query := s.DB.WithContext(ctx).
		Select(archivePrepareTaskSelect).
		Where("status IN ?", []string{
			meta.ArchivePrepareStatusQueued,
			meta.ArchivePrepareStatusRunning,
			meta.ArchivePrepareStatusCancelRequested,
		}).
		Order("updated_at DESC, id ASC").
		Limit(limit)
	if ownerID != nil {
		query = query.Where("owner_id = ?", *ownerID)
	}
	var runs []meta.ArchivePrepareRun
	if err := query.Find(&runs).Error; err != nil {
		return nil, err
	}
	out := make([]backgroundTaskDTO, 0, len(runs))
	for _, run := range runs {
		out = append(out, backgroundTaskFromArchivePrepare(run, viewerID, admin))
	}
	return out, nil
}

func (s *Server) backgroundTerminalArchivePrepareTasks(
	ctx context.Context,
	ownerID *uint64,
	viewerID uint64,
	admin bool,
	limit int,
	cursor *backgroundTaskHistoryCursor,
) ([]backgroundTaskDTO, error) {
	query := s.DB.WithContext(ctx).
		Select(archivePrepareTaskSelect).
		Where("status IN ?", []string{
			meta.ArchivePrepareStatusCompleted,
			meta.ArchivePrepareStatusFailed,
			meta.ArchivePrepareStatusCancelled,
		})
	if ownerID != nil {
		query = query.Where("owner_id = ?", *ownerID)
	}
	query = applyBackgroundHistoryCursor(query, backgroundTaskHistoryDomainArchivePrepare, cursor)
	var runs []meta.ArchivePrepareRun
	if err := query.Order("updated_at DESC, id ASC").Limit(limit).Find(&runs).Error; err != nil {
		return nil, err
	}
	out := make([]backgroundTaskDTO, 0, len(runs))
	for _, run := range runs {
		out = append(out, backgroundTaskFromArchivePrepare(run, viewerID, admin))
	}
	return out, nil
}
