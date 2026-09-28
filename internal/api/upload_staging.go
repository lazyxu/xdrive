package api

import (
	"context"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
)

const (
	stagingOrphanGrace             = time.Hour
	stagingSnapshotTTL             = 30 * time.Second
	stagingCleanupHistoryRetention = 90 * 24 * time.Hour
	stagingCleanupFailureTextLimit = 4 << 10
	stagingCleanupHistoryBatchSize = 500
)

type uploadStagingFileDTO struct {
	Key        string    `json:"key"`
	Size       int64     `json:"size"`
	ModifiedAt time.Time `json:"modified_at"`
}

type uploadStagingStatsDTO struct {
	Supported            bool      `json:"supported"`
	ActiveSessions       int64     `json:"active_sessions"`
	ReservedBytes        int64     `json:"reserved_bytes"`
	PartFiles            int64     `json:"part_files"`
	PartBytes            int64     `json:"part_bytes"`
	StagingFiles         int64     `json:"staging_files"`
	StagingBytes         int64     `json:"staging_bytes"`
	OrphanFiles          int64     `json:"orphan_files"`
	OrphanBytes          int64     `json:"orphan_bytes"`
	RecentUntrackedFiles int64     `json:"recent_untracked_files"`
	RecentUntrackedBytes int64     `json:"recent_untracked_bytes"`
	MissingPartFiles     int64     `json:"missing_part_files"`
	MissingPartBytes     int64     `json:"missing_part_bytes"`
	ExpiredSessions      int64     `json:"expired_sessions"`
	ExpiredStagingFiles  int64     `json:"expired_staging_files"`
	ExpiredStagingBytes  int64     `json:"expired_staging_bytes"`
	ReclaimableFiles     int64     `json:"reclaimable_files"`
	ReclaimableBytes     int64     `json:"reclaimable_bytes"`
	OrphanGraceSeconds   int64     `json:"orphan_grace_seconds"`
	GeneratedAt          time.Time `json:"generated_at"`
}

type uploadStagingDetailDTO struct {
	Stats      uploadStagingStatsDTO  `json:"stats"`
	Orphans    []uploadStagingFileDTO `json:"orphans"`
	HasMore    bool                   `json:"has_more"`
	NextCursor string                 `json:"next_cursor,omitempty"`
}

type uploadStagingCleanupDTO struct {
	RunID        uint64                `json:"run_id"`
	DeletedFiles int64                 `json:"deleted_files"`
	DeletedBytes int64                 `json:"deleted_bytes"`
	FailedFiles  int64                 `json:"failed_files"`
	Stats        uploadStagingStatsDTO `json:"stats"`
}

type stagingCleanupRunDTO struct {
	ID           uint64     `json:"id"`
	Trigger      string     `json:"trigger"`
	Status       string     `json:"status"`
	DeletedFiles int64      `json:"deleted_files"`
	DeletedBytes int64      `json:"deleted_bytes"`
	FailedFiles  int64      `json:"failed_files"`
	Error        string     `json:"error,omitempty"`
	StartedAt    time.Time  `json:"started_at"`
	FinishedAt   *time.Time `json:"finished_at,omitempty"`
}

type stagingCleanupFailureDTO struct {
	ID         uint64    `json:"id"`
	StorageKey string    `json:"storage_key"`
	Size       int64     `json:"size"`
	Error      string    `json:"error"`
	FailedAt   time.Time `json:"failed_at"`
}

type uploadStagingPartRow struct {
	StorageKey string
	Size       int64
	SessionID  string
	Status     string
	ExpiresAt  time.Time
}

type uploadStagingInventory struct {
	Stats   uploadStagingStatsDTO
	Orphans []storage.StagingFile
}

func (s *Server) invalidateUploadStagingSnapshot() {
	s.stagingCacheMu.Lock()
	s.stagingCacheAt = time.Time{}
	s.stagingCache = uploadStagingInventory{}
	s.stagingCacheMu.Unlock()
}

func (s *Server) loadUploadStagingInventory(ctx context.Context) (uploadStagingInventory, error) {
	return s.loadUploadStagingInventorySnapshot(ctx, false)
}

func (s *Server) loadUploadStagingInventoryFresh(ctx context.Context) (uploadStagingInventory, error) {
	return s.loadUploadStagingInventorySnapshot(ctx, true)
}

func (s *Server) loadUploadStagingInventorySnapshot(ctx context.Context, force bool) (uploadStagingInventory, error) {
	s.stagingCacheMu.Lock()
	defer s.stagingCacheMu.Unlock()
	if !force && !s.stagingCacheAt.IsZero() && time.Since(s.stagingCacheAt) < stagingSnapshotTTL {
		return s.stagingCache, nil
	}
	inventory, err := s.scanUploadStagingInventory(ctx)
	if err != nil {
		return uploadStagingInventory{}, err
	}
	s.stagingCache = inventory
	s.stagingCacheAt = time.Now()
	return inventory, nil
}

func (s *Server) scanUploadStagingInventory(ctx context.Context) (uploadStagingInventory, error) {
	now := time.Now()
	stats := uploadStagingStatsDTO{
		OrphanGraceSeconds: int64(stagingOrphanGrace.Seconds()),
		GeneratedAt:        now.UTC(),
	}
	if err := s.DB.WithContext(ctx).Model(&meta.UploadSession{}).
		Where("status = ? AND expires_at > ?", meta.UploadStatusActive, now).
		Count(&stats.ActiveSessions).Error; err != nil {
		return uploadStagingInventory{}, err
	}
	if err := s.DB.WithContext(ctx).Model(&meta.UploadSession{}).
		Select("COALESCE(SUM(reserved_bytes), 0)").
		Where("status = ? AND expires_at > ?", meta.UploadStatusActive, now).
		Scan(&stats.ReservedBytes).Error; err != nil {
		return uploadStagingInventory{}, err
	}
	if err := s.DB.WithContext(ctx).Model(&meta.UploadSession{}).
		Where("status IN ? AND expires_at <= ?", []string{meta.UploadStatusActive, meta.UploadStatusFinalized}, now).
		Count(&stats.ExpiredSessions).Error; err != nil {
		return uploadStagingInventory{}, err
	}

	var parts []uploadStagingPartRow
	if err := s.DB.WithContext(ctx).Raw(`
		SELECT p.storage_key, p.size, p.session_id, s.status, s.expires_at
		FROM xd_upload_parts p
		JOIN xd_upload_sessions s ON s.id = p.session_id
		WHERE p.reused = FALSE AND p.storage_key <> ''
	`).Scan(&parts).Error; err != nil {
		return uploadStagingInventory{}, err
	}
	stats.PartFiles = int64(len(parts))
	known := make(map[string]uploadStagingPartRow, len(parts))
	for _, part := range parts {
		known[part.StorageKey] = part
		stats.PartBytes += part.Size
	}

	inspector, ok := s.Store.(storage.StagingInspector)
	if !ok {
		return uploadStagingInventory{Stats: stats}, nil
	}
	stats.Supported = true
	files, err := inspector.ListStaging(ctx)
	if err != nil {
		return uploadStagingInventory{}, err
	}
	seen := make(map[string]struct{}, len(files))
	orphans := make([]storage.StagingFile, 0)
	cutoff := now.Add(-stagingOrphanGrace)
	for _, file := range files {
		stats.StagingFiles++
		stats.StagingBytes += file.Size
		seen[file.Key] = struct{}{}
		if part, exists := known[file.Key]; exists {
			if !part.ExpiresAt.After(now) {
				stats.ExpiredStagingFiles++
				stats.ExpiredStagingBytes += file.Size
			}
			continue
		}
		if !file.ModifiedAt.After(cutoff) {
			stats.OrphanFiles++
			stats.OrphanBytes += file.Size
			orphans = append(orphans, file)
		} else {
			stats.RecentUntrackedFiles++
			stats.RecentUntrackedBytes += file.Size
		}
	}
	for key, part := range known {
		if _, exists := seen[key]; exists {
			continue
		}
		stats.MissingPartFiles++
		stats.MissingPartBytes += part.Size
	}
	stats.ReclaimableFiles = stats.OrphanFiles + stats.ExpiredStagingFiles
	stats.ReclaimableBytes = stats.OrphanBytes + stats.ExpiredStagingBytes
	sort.Slice(orphans, func(i, j int) bool {
		return orphans[i].Key < orphans[j].Key
	})
	return uploadStagingInventory{Stats: stats, Orphans: orphans}, nil
}

func (s *Server) adminUploadStaging(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	limit := 50
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 200 {
			fail(c, http.StatusBadRequest, "limit must be between 1 and 200")
			return
		}
		limit = value
	}
	offset := 0
	if raw := strings.TrimSpace(c.Query("offset")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			fail(c, http.StatusBadRequest, "offset must be zero or greater")
			return
		}
		offset = value
	}
	cursor := strings.TrimSpace(c.Query("cursor"))
	inventory, err := s.loadUploadStagingInventory(ctx)
	if err != nil {
		fail(c, http.StatusInternalServerError, "load upload staging failed")
		return
	}

	start := 0
	if cursor != "" {
		start = sort.Search(len(inventory.Orphans), func(i int) bool {
			return inventory.Orphans[i].Key > cursor
		})
	} else if offset > 0 {
		start = offset
	}
	if start > len(inventory.Orphans) {
		start = len(inventory.Orphans)
	}
	end := start + limit
	if end > len(inventory.Orphans) {
		end = len(inventory.Orphans)
	}
	out := make([]uploadStagingFileDTO, 0, end-start)
	for _, file := range inventory.Orphans[start:end] {
		out = append(out, uploadStagingFileDTO{Key: file.Key, Size: file.Size, ModifiedAt: file.ModifiedAt})
	}
	hasMore := end < len(inventory.Orphans)
	nextCursor := ""
	if hasMore && len(out) != 0 {
		nextCursor = out[len(out)-1].Key
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, uploadStagingDetailDTO{
		Stats: inventory.Stats, Orphans: out, HasMore: hasMore, NextCursor: nextCursor,
	})
}

func stagingCleanupError(err error) string {
	if err == nil {
		return ""
	}
	value := strings.TrimSpace(err.Error())
	if len(value) > stagingCleanupFailureTextLimit {
		value = value[:stagingCleanupFailureTextLimit]
	}
	return value
}

func (s *Server) finishStagingCleanupRun(ctx context.Context, runID uint64, result uploadStagingCleanupDTO, status, errorText string) error {
	finished := time.Now().UTC()
	return s.DB.WithContext(ctx).Model(&meta.StagingCleanupRun{}).Where("id = ?", runID).Updates(map[string]any{
		"status": status, "deleted_files": result.DeletedFiles, "deleted_bytes": result.DeletedBytes,
		"failed_files": result.FailedFiles, "error": errorText, "finished_at": &finished, "updated_at": finished,
	}).Error
}

func (s *Server) cleanupUploadStaging(ctx context.Context, trigger string) (uploadStagingCleanupDTO, error) {
	if trigger != meta.StagingCleanupTriggerManual && trigger != meta.StagingCleanupTriggerJanitor {
		trigger = meta.StagingCleanupTriggerJanitor
	}
	started := time.Now().UTC()
	run := meta.StagingCleanupRun{
		Trigger: trigger, Status: meta.StagingCleanupStatusFailed, StartedAt: started,
	}
	if err := s.DB.WithContext(ctx).Create(&run).Error; err != nil {
		return uploadStagingCleanupDTO{}, err
	}
	result := uploadStagingCleanupDTO{RunID: run.ID}
	failRun := func(err error) (uploadStagingCleanupDTO, error) {
		_ = s.finishStagingCleanupRun(context.Background(), run.ID, result, meta.StagingCleanupStatusFailed, stagingCleanupError(err))
		return result, err
	}

	before, err := s.loadUploadStagingInventoryFresh(ctx)
	if err != nil {
		return failRun(err)
	}
	if err := s.cleanupExpiredUploads(ctx, 0); err != nil {
		return failRun(err)
	}
	s.invalidateUploadStagingSnapshot()
	inventory, err := s.loadUploadStagingInventoryFresh(ctx)
	if err != nil {
		return failRun(err)
	}
	inspector, ok := s.Store.(storage.StagingInspector)
	if ok {
		failures := make([]meta.StagingCleanupFailure, 0)
		for _, file := range inventory.Orphans {
			if err := inspector.DeleteStaging(ctx, file.Key); err != nil {
				result.FailedFiles++
				failures = append(failures, meta.StagingCleanupFailure{
					RunID: run.ID, StorageKey: file.Key, Size: file.Size,
					Error: stagingCleanupError(err), FailedAt: time.Now().UTC(),
				})
				continue
			}
			result.DeletedFiles++
			result.DeletedBytes += file.Size
		}
		if len(failures) != 0 {
			if err := s.DB.WithContext(ctx).Create(&failures).Error; err != nil {
				return failRun(err)
			}
		}
	}
	s.invalidateUploadStagingSnapshot()
	fresh, err := s.loadUploadStagingInventoryFresh(ctx)
	if err != nil {
		return failRun(err)
	}
	if removed := before.Stats.StagingFiles - fresh.Stats.StagingFiles; removed > result.DeletedFiles {
		result.DeletedFiles = removed
	}
	if removed := before.Stats.StagingBytes - fresh.Stats.StagingBytes; removed > result.DeletedBytes {
		result.DeletedBytes = removed
	}
	result.Stats = fresh.Stats
	status := meta.StagingCleanupStatusSuccess
	if result.FailedFiles > 0 {
		status = meta.StagingCleanupStatusPartial
	}
	if err := s.finishStagingCleanupRun(ctx, run.ID, result, status, ""); err != nil {
		return result, err
	}
	return result, nil
}

func (s *Server) adminCleanupUploadStaging(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	result, err := s.cleanupUploadStaging(ctx, meta.StagingCleanupTriggerManual)
	if err != nil {
		fail(c, http.StatusInternalServerError, "cleanup upload staging failed")
		return
	}
	s.recordAuditBestEffort(c, auditpkg.Event{
		Action:      auditpkg.ActionAdminStorageCleanup,
		TargetType:  "storage",
		TargetLabel: "upload-staging",
		Result:      auditpkg.ResultSuccess,
		Metadata: map[string]any{
			"run_id": result.RunID, "deleted_files": result.DeletedFiles,
			"deleted_bytes": result.DeletedBytes, "failed_files": result.FailedFiles,
		},
	})
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, result)
}

func stagingHistoryWindow(c *gin.Context, defaultLimit, maxLimit int) (int, int, bool) {
	limit := defaultLimit
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > maxLimit {
			fail(c, http.StatusBadRequest, "invalid limit")
			return 0, 0, false
		}
		limit = value
	}
	offset := 0
	if raw := strings.TrimSpace(c.Query("offset")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			fail(c, http.StatusBadRequest, "invalid offset")
			return 0, 0, false
		}
		offset = value
	}
	return limit, offset, true
}

func (s *Server) adminStagingCleanupRuns(c *gin.Context) {
	limit, offset, ok := stagingHistoryWindow(c, 20, 100)
	if !ok {
		return
	}
	var runs []meta.StagingCleanupRun
	if err := s.DB.Where("finished_at IS NOT NULL").
		Order("started_at DESC, id DESC").Limit(limit).Offset(offset).Find(&runs).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list staging cleanup runs failed")
		return
	}
	out := make([]stagingCleanupRunDTO, 0, len(runs))
	for _, run := range runs {
		out = append(out, stagingCleanupRunDTO{
			ID: run.ID, Trigger: run.Trigger, Status: run.Status,
			DeletedFiles: run.DeletedFiles, DeletedBytes: run.DeletedBytes,
			FailedFiles: run.FailedFiles, Error: run.Error,
			StartedAt: run.StartedAt, FinishedAt: run.FinishedAt,
		})
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, out)
}

func (s *Server) adminStagingCleanupFailures(c *gin.Context) {
	runID, ok := parseID(c.Param("runID"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid cleanup run id")
		return
	}
	var run meta.StagingCleanupRun
	if err := s.DB.First(&run, runID).Error; err != nil {
		fail(c, http.StatusNotFound, "cleanup run not found")
		return
	}
	limit, offset, ok := stagingHistoryWindow(c, 20, 200)
	if !ok {
		return
	}
	var failures []meta.StagingCleanupFailure
	if err := s.DB.Where("run_id = ?", runID).Order("failed_at ASC, id ASC").
		Limit(limit).Offset(offset).Find(&failures).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list staging cleanup failures failed")
		return
	}
	out := make([]stagingCleanupFailureDTO, 0, len(failures))
	for _, failure := range failures {
		out = append(out, stagingCleanupFailureDTO{
			ID: failure.ID, StorageKey: failure.StorageKey, Size: failure.Size,
			Error: failure.Error, FailedAt: failure.FailedAt,
		})
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, out)
}

func (s *Server) cleanupStagingCleanupHistory(ctx context.Context) error {
	cutoff := time.Now().UTC().Add(-stagingCleanupHistoryRetention)
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		var ids []uint64
		if err := s.DB.WithContext(ctx).Model(&meta.StagingCleanupRun{}).
			Where("finished_at IS NOT NULL AND finished_at < ?", cutoff).
			Order("id ASC").Limit(stagingCleanupHistoryBatchSize).Pluck("id", &ids).Error; err != nil {
			return err
		}
		if len(ids) == 0 {
			return nil
		}
		if err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if err := tx.Where("run_id IN ?", ids).Delete(&meta.StagingCleanupFailure{}).Error; err != nil {
				return err
			}
			return tx.Where("id IN ?", ids).Delete(&meta.StagingCleanupRun{}).Error
		}); err != nil {
			return err
		}
		if len(ids) < stagingCleanupHistoryBatchSize {
			return nil
		}
	}
}
