package api

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
)

type backgroundTaskActiveSummaryDTO struct {
	ActiveTotal    int `json:"active_total"`
	FileOperation  int `json:"file_operation"`
	SyncRun        int `json:"sync_run"`
	ArchivePrepare int `json:"archive_prepare"`
	Scheduler      int `json:"scheduler"`
}

func (s *Server) backgroundTaskActiveSummary(c *gin.Context) {
	uid := userID(c)
	summary, err := s.backgroundTaskActiveSummaryForOwner(
		c.Request.Context(),
		uid,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "summarize background tasks failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, summary)
}

func (s *Server) backgroundTaskActiveSummaryForOwner(
	ctx context.Context,
	ownerID uint64,
) (backgroundTaskActiveSummaryDTO, error) {
	out := backgroundTaskActiveSummaryDTO{}
	if s == nil || s.DB == nil || ownerID == 0 {
		return out, nil
	}

	runtimeTasks := s.backgroundClusterRuntimeTasks(
		ctx,
		&ownerID,
		ownerID,
		false,
	)
	intents, err := s.backgroundPhotoIntelligenceIntentTasks(
		ctx,
		&ownerID,
		ownerID,
		false,
		backgroundTaskMaxLimit,
	)
	if err != nil {
		return out, err
	}
	runtimeTasks = mergePhotoIntelligenceIntentTasks(runtimeTasks, intents)

	cancellations, err := s.backgroundOwnerCancellationTasks(
		ctx,
		&ownerID,
		backgroundTaskMaxLimit,
	)
	if err != nil {
		return out, err
	}
	runtimeTasks = mergeBackgroundOwnerCancellationTasks(
		runtimeTasks,
		cancellations,
	)
	for _, task := range runtimeTasks {
		if backgroundTaskStateActive(task.State) {
			out.Scheduler++
		}
	}

	var fileOperations int64
	if err := s.DB.WithContext(ctx).
		Model(&meta.FileOperation{}).
		Where("owner_id = ?", ownerID).
		Where("status IN ?", []string{
			meta.FileOperationStatusQueued,
			meta.FileOperationStatusRunning,
			meta.FileOperationStatusCancelRequested,
		}).
		Count(&fileOperations).Error; err != nil {
		return out, err
	}
	out.FileOperation = int(fileOperations)

	var syncRuns int64
	if err := s.DB.WithContext(ctx).
		Table("xd_sync_runs AS runs").
		Joins("JOIN xd_sources AS sources ON sources.id = runs.source_id").
		Where("sources.owner_id = ?", ownerID).
		Where("runs.status = ?", meta.SyncRunStatusRunning).
		Count(&syncRuns).Error; err != nil {
		return out, err
	}
	out.SyncRun = int(syncRuns)

	var archivePrepares int64
	if err := s.DB.WithContext(ctx).
		Model(&meta.ArchivePrepareRun{}).
		Where("owner_id = ?", ownerID).
		Where("status IN ?", []string{
			meta.ArchivePrepareStatusQueued,
			meta.ArchivePrepareStatusRunning,
			meta.ArchivePrepareStatusCancelRequested,
		}).
		Count(&archivePrepares).Error; err != nil {
		return out, err
	}
	out.ArchivePrepare = int(archivePrepares)
	out.ActiveTotal = out.FileOperation + out.SyncRun + out.ArchivePrepare + out.Scheduler
	return out, nil
}

func backgroundTaskStateActive(state string) bool {
	switch state {
	case "queued", "running", "cancelling", "cancel_requested":
		return true
	default:
		return false
	}
}
