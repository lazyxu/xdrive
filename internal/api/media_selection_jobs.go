package api

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	mediaSelectionJobChunk   = 100
	mediaSelectionJobPoll    = 2 * time.Second
	mediaSelectionJobPageMax = 200

	mediaSelectionJobQueued          = "queued"
	mediaSelectionJobRunning         = "running"
	mediaSelectionJobCancelRequested = "cancel_requested"
	mediaSelectionJobCompleted       = "completed"
	mediaSelectionJobPartial         = "partial"
	mediaSelectionJobCancelled       = "cancelled"
	mediaSelectionItemSucceeded      = "succeeded"
	mediaSelectionItemFailed         = "failed"
	mediaSelectionItemCancelled      = "cancelled"
)

// createMediaSelectionJob moves the frozen node revisions into durable SQL.
// The only enabled action is reversible PhotoMetadata.favorite; file mutation
// and destructive actions require their own audited phase.
func (s *Server) createMediaSelectionJob(c *gin.Context) {
	var input struct {
		Version  uint64 `json:"version"`
		Action   string `json:"action"`
		Favorite *bool  `json:"favorite"`
		Confirm  bool   `json:"confirm"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || !input.Confirm ||
		input.Version == 0 || input.Action != "favorite" || input.Favorite == nil {
		fail(c, http.StatusBadRequest, "confirm, version and a favorite action are required")
		return
	}
	token := c.Param("token")
	s.mediaSelectionMu.Lock()
	session, ok := s.mediaSelectionByTokenLocked(c, token)
	if !ok {
		s.mediaSelectionMu.Unlock()
		fail(c, http.StatusNotFound, "selection expired or not found")
		return
	}
	if session.submitting || input.Version != session.version {
		s.mediaSelectionMu.Unlock()
		fail(c, http.StatusConflict, "selection changed or is already being submitted")
		return
	}
	nodes := session.page(0, session.selectedCount())
	if len(nodes) == 0 {
		s.mediaSelectionMu.Unlock()
		fail(c, http.StatusBadRequest, "selection is empty")
		return
	}
	session.submitting = true
	s.mediaSelectionMu.Unlock()

	job := meta.MediaSelectionJob{
		ID: uuid.NewString(), OwnerID: userID(c), Action: "favorite",
		Favorite: *input.Favorite, Status: mediaSelectionJobQueued,
		TotalItems: int64(len(nodes)),
	}
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&job).Error; err != nil {
			return err
		}
		for start := 0; start < len(nodes); start += mediaSelectionJobChunk {
			end := min(start+mediaSelectionJobChunk, len(nodes))
			items := make([]meta.MediaSelectionJobItem, 0, end-start)
			for _, node := range nodes[start:end] {
				items = append(items, meta.MediaSelectionJobItem{
					JobID: job.ID, OwnerID: job.OwnerID,
					NodeID: node.ID, Revision: node.Revision,
					Status: mediaSelectionJobQueued,
				})
			}
			if err := tx.Create(&items).Error; err != nil {
				return err
			}
		}
		return nil
	})
	s.mediaSelectionMu.Lock()
	if err == nil {
		if s.mediaSelections[token] == session {
			delete(s.mediaSelections, token)
		}
	} else {
		session.submitting = false
	}
	s.mediaSelectionMu.Unlock()
	if err != nil {
		if c.Request.Context().Err() != nil {
			return
		}
		slog.Error("media_selection_job_enqueue_failed", "error", err)
		fail(c, http.StatusInternalServerError, "queue media selection job failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusAccepted, job)
}

func (s *Server) ownedMediaSelectionJob(ctx context.Context, owner uint64, id string) (meta.MediaSelectionJob, error) {
	if _, err := uuid.Parse(id); err != nil {
		return meta.MediaSelectionJob{}, gorm.ErrRecordNotFound
	}
	var job meta.MediaSelectionJob
	err := s.DB.WithContext(ctx).Where("id = ? AND owner_id = ?", id, owner).Take(&job).Error
	return job, err
}

func (s *Server) getMediaSelectionJob(c *gin.Context) {
	job, err := s.ownedMediaSelectionJob(c.Request.Context(), userID(c), c.Param("id"))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "job not found")
		} else {
			fail(c, http.StatusInternalServerError, "load job failed")
		}
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, job)
}

func (s *Server) listMediaSelectionJobs(c *gin.Context) {
	limit := 40
	if raw := c.Query("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > 100 {
			fail(c, http.StatusBadRequest, "limit must be 1..100")
			return
		}
		limit = n
	}
	var jobs []meta.MediaSelectionJob
	if err := s.DB.WithContext(c.Request.Context()).Where("owner_id = ?", userID(c)).
		Order("created_at DESC, id DESC").Limit(limit).Find(&jobs).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list jobs failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, jobs)
}

func (s *Server) listMediaSelectionJobFailures(c *gin.Context) {
	job, err := s.ownedMediaSelectionJob(c.Request.Context(), userID(c), c.Param("id"))
	if err != nil {
		fail(c, http.StatusNotFound, "job not found")
		return
	}
	offset, limit := 0, 100
	if raw := c.Query("offset"); raw != "" {
		n, e := strconv.Atoi(raw)
		if e != nil || n < 0 {
			fail(c, http.StatusBadRequest, "offset must be nonnegative")
			return
		}
		offset = n
	}
	if raw := c.Query("limit"); raw != "" {
		n, e := strconv.Atoi(raw)
		if e != nil || n < 1 || n > mediaSelectionJobPageMax {
			fail(c, http.StatusBadRequest, "limit must be 1..200")
			return
		}
		limit = n
	}
	var rows []meta.MediaSelectionJobItem
	if err := s.DB.WithContext(c.Request.Context()).
		Where("job_id = ? AND owner_id = ? AND status = ?", job.ID, job.OwnerID, mediaSelectionItemFailed).
		Order("id ASC").Offset(offset).Limit(limit).Find(&rows).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list failed items failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{
		"items": rows, "total": job.FailedItems,
		"offset": offset, "limit": limit,
		"has_more": int64(offset+len(rows)) < job.FailedItems,
	})
}

func (s *Server) cancelMediaSelectionJob(c *gin.Context) {
	job, err := s.ownedMediaSelectionJob(c.Request.Context(), userID(c), c.Param("id"))
	if err != nil {
		fail(c, http.StatusNotFound, "job not found")
		return
	}
	now := time.Now().UTC()
	result := s.DB.WithContext(c.Request.Context()).Model(&meta.MediaSelectionJob{}).
		Where("id = ? AND owner_id = ? AND status IN ?", job.ID, job.OwnerID,
			[]string{mediaSelectionJobQueued, mediaSelectionJobRunning}).
		Updates(map[string]any{"status": mediaSelectionJobCancelRequested, "cancel_requested_at": now, "updated_at": now})
	if result.Error != nil {
		fail(c, http.StatusInternalServerError, "request cancellation failed")
		return
	}
	if result.RowsAffected == 0 {
		fail(c, http.StatusConflict, "job is already finishing or cancelled")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusAccepted, gin.H{"id": job.ID, "status": mediaSelectionJobCancelRequested})
}

// Retry preserves the original frozen revisions and only retries items that
// never succeeded. A stale_revision is NOT silently changed to a new revision.
func (s *Server) retryMediaSelectionJob(c *gin.Context) {
	var newJob meta.MediaSelectionJob
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var prior meta.MediaSelectionJob
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", c.Param("id"), userID(c)).Take(&prior).Error; err != nil {
			return err
		}
		if prior.Status != mediaSelectionJobPartial && prior.Status != mediaSelectionJobCancelled {
			return errMediaSelectionJobNotRetryable
		}
		var count int64
		if err := tx.Model(&meta.MediaSelectionJobItem{}).
			Where("job_id = ? AND owner_id = ? AND status IN ?", prior.ID, prior.OwnerID,
				[]string{mediaSelectionItemFailed, mediaSelectionItemCancelled}).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 || count > mediaSelectionMaxItems {
			return errMediaSelectionJobNotRetryable
		}
		newJob = meta.MediaSelectionJob{
			ID: uuid.NewString(), OwnerID: prior.OwnerID, Action: prior.Action, Favorite: prior.Favorite,
			Status: mediaSelectionJobQueued, RetryOfID: prior.ID, TotalItems: count,
		}
		if err := tx.Create(&newJob).Error; err != nil {
			return err
		}
		// One bounded INSERT ... SELECT, no rehydration of 100k MediaItems
		// and no automatic revision rebasing.
		result := tx.Exec(`INSERT INTO xd_media_selection_job_items
			(job_id, owner_id, node_id, revision, status, created_at, updated_at)
			SELECT ?, owner_id, node_id, revision, ?, NOW(), NOW()
			FROM xd_media_selection_job_items
			WHERE job_id = ? AND owner_id = ? AND status IN ?`,
			newJob.ID, mediaSelectionJobQueued, prior.ID, prior.OwnerID,
			[]string{mediaSelectionItemFailed, mediaSelectionItemCancelled})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != count {
			return errors.New("retry selection changed")
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "job not found")
		} else if errors.Is(err, errMediaSelectionJobNotRetryable) {
			fail(c, http.StatusConflict, "job has no failed or cancelled items to retry")
		} else {
			fail(c, http.StatusInternalServerError, "retry job failed")
		}
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusAccepted, newJob)
}

var errMediaSelectionJobNotRetryable = errors.New("job cannot be retried")

// Each chunk holds the job and source Node locks until the metadata mutation,
// item outcome and aggregate counters commit atomically. A crash rolls the
// chunk back; the next server instance resumes the remaining queued items.
func (s *Server) processNextMediaSelectionJob(ctx context.Context) (bool, error) {
	progressed := false
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var job meta.MediaSelectionJob
		result := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
			Where("status IN ?", []string{mediaSelectionJobQueued, mediaSelectionJobRunning, mediaSelectionJobCancelRequested}).
			Order("created_at ASC, id ASC").Limit(1).Find(&job)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}
		progressed = true
		now := time.Now().UTC()
		if job.Status == mediaSelectionJobCancelRequested {
			update := tx.Model(&meta.MediaSelectionJobItem{}).Where("job_id = ? AND status = ?", job.ID, mediaSelectionJobQueued).
				Update("status", mediaSelectionItemCancelled)
			if update.Error != nil {
				return update.Error
			}
			return tx.Model(&meta.MediaSelectionJob{}).Where("id = ?", job.ID).Updates(map[string]any{
				"status":          mediaSelectionJobCancelled,
				"cancelled_items": update.RowsAffected,
				"finished_at":     now, "updated_at": now,
			}).Error
		}
		if job.Status == mediaSelectionJobQueued {
			if err := tx.Model(&meta.MediaSelectionJob{}).Where("id = ?", job.ID).
				Updates(map[string]any{"status": mediaSelectionJobRunning, "started_at": now}).Error; err != nil {
				return err
			}
		}
		var items []meta.MediaSelectionJobItem
		if err := tx.Where("job_id = ? AND owner_id = ? AND status = ?", job.ID, job.OwnerID, mediaSelectionJobQueued).
			Order("id ASC").Limit(mediaSelectionJobChunk).Find(&items).Error; err != nil {
			return err
		}
		if len(items) == 0 {
			return finishMediaSelectionJobTx(tx, job, now)
		}
		ids := make([]uint64, 0, len(items))
		for _, item := range items {
			ids = append(ids, item.NodeID)
		}
		var nodes []meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id IN ? AND owner_id = ? AND deleted_at IS NULL", ids, job.OwnerID).
			Order("id ASC").Find(&nodes).Error; err != nil {
			return err
		}
		nodeByID := make(map[uint64]meta.Node, len(nodes))
		for _, node := range nodes {
			nodeByID[node.ID] = node
		}
		var assets []meta.PhotoAsset
		if err := tx.Where("owner_id = ? AND primary_node_id IN ?", job.OwnerID, ids).
			Find(&assets).Error; err != nil {
			return err
		}
		assetByNode := make(map[uint64]uint64, len(assets))
		assetIDs := make([]uint64, 0, len(assets))
		for _, asset := range assets {
			assetByNode[asset.PrimaryNodeID] = asset.ID
			assetIDs = append(assetIDs, asset.ID)
		}
		var metadata []meta.PhotoMetadata
		if len(assetIDs) > 0 {
			if err := tx.Where("asset_id IN ?", assetIDs).Find(&metadata).Error; err != nil {
				return err
			}
		}
		hasMetadata := make(map[uint64]struct{}, len(metadata))
		for _, row := range metadata {
			hasMetadata[row.AssetID] = struct{}{}
		}
		succeeded := make([]uint64, 0, len(items))
		failed := map[string][]uint64{}
		matchedAssetIDs := make([]uint64, 0, len(items))
		for _, item := range items {
			node, exists := nodeByID[item.NodeID]
			code := ""
			if !exists || node.Type != meta.NodeTypeFile {
				code = "node_unavailable"
			} else if node.Revision != item.Revision {
				code = "stale_revision"
			} else if assetByNode[item.NodeID] == 0 {
				code = "asset_unavailable"
			} else if _, ok := hasMetadata[assetByNode[item.NodeID]]; !ok {
				code = "metadata_unavailable"
			}
			if code != "" {
				failed[code] = append(failed[code], item.ID)
			} else {
				succeeded = append(succeeded, item.ID)
				matchedAssetIDs = append(matchedAssetIDs, assetByNode[item.NodeID])
			}
		}
		if len(succeeded) > 0 {
			updated := tx.Model(&meta.PhotoMetadata{}).
				Where("asset_id IN ?", matchedAssetIDs).
				Update("favorite", job.Favorite)
			if updated.Error != nil {
				return updated.Error
			}
			if updated.RowsAffected != int64(len(succeeded)) {
				return errors.New("media selection metadata changed during transaction")
			}
			if err := tx.Model(&meta.MediaSelectionJobItem{}).
				Where("id IN ? AND job_id = ?", succeeded, job.ID).
				Update("status", mediaSelectionItemSucceeded).Error; err != nil {
				return err
			}
		}
		for code, itemIDs := range failed {
			if err := tx.Model(&meta.MediaSelectionJobItem{}).
				Where("id IN ? AND job_id = ?", itemIDs, job.ID).
				Updates(map[string]any{"status": mediaSelectionItemFailed, "failure_code": code}).Error; err != nil {
				return err
			}
		}
		job.ProcessedItems += int64(len(items))
		job.SucceededItems += int64(len(succeeded))
		job.FailedItems += int64(len(items) - len(succeeded))
		updates := map[string]any{
			"processed_items": job.ProcessedItems,
			"succeeded_items": job.SucceededItems,
			"failed_items":    job.FailedItems,
			"updated_at":      now,
		}
		if job.ProcessedItems >= job.TotalItems {
			updates["finished_at"] = now
			updates["status"] = mediaSelectionJobCompleted
			if job.FailedItems > 0 {
				updates["status"] = mediaSelectionJobPartial
			}
		}
		return tx.Model(&meta.MediaSelectionJob{}).Where("id = ?", job.ID).Updates(updates).Error
	})
	return progressed, err
}

func finishMediaSelectionJobTx(tx *gorm.DB, job meta.MediaSelectionJob, now time.Time) error {
	status := mediaSelectionJobCompleted
	if job.FailedItems > 0 || job.ProcessedItems != job.TotalItems {
		status = mediaSelectionJobPartial
	}
	return tx.Model(&meta.MediaSelectionJob{}).Where("id = ?", job.ID).
		Updates(map[string]any{"status": status, "finished_at": now, "updated_at": now}).Error
}

func (s *Server) StartMediaSelectionJobWorker(ctx context.Context) {
	if s == nil || s.DB == nil {
		return
	}
	go func() {
		ticker := time.NewTicker(mediaSelectionJobPoll)
		defer ticker.Stop()
		for {
			if ctx.Err() != nil {
				return
			}
			progressed, err := s.processNextMediaSelectionJob(ctx)
			if err != nil && !errors.Is(err, context.Canceled) {
				slog.Error("media_selection_job_worker_failed", "error", err)
			}
			if progressed && err == nil {
				continue
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}
