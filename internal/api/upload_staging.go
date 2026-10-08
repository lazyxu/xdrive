package api

import (
	"context"
	"errors"
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
	stagingCleanupFailureBatchSize = 200
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
	ExpiresAt  time.Time
}

type uploadStagingInventory struct {
	Stats        uploadStagingStatsDTO
	Known        map[string]uploadStagingPartRow
	OrphanCutoff time.Time
}

var errStopStagingWalk = errors.New("stop staging walk")

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

func (s *Server) loadUploadStagingInventoryFreshWithProgress(
	ctx context.Context,
	report storageSampleProgressReporter,
) (uploadStagingInventory, error) {
	return s.loadUploadStagingInventorySnapshotWithProgress(ctx, true, report)
}

func (s *Server) loadUploadStagingInventorySnapshot(ctx context.Context, force bool) (uploadStagingInventory, error) {
	return s.loadUploadStagingInventorySnapshotWithProgress(ctx, force, nil)
}

func (s *Server) loadUploadStagingInventorySnapshotWithProgress(
	ctx context.Context,
	force bool,
	report storageSampleProgressReporter,
) (uploadStagingInventory, error) {
	s.stagingCacheMu.Lock()
	defer s.stagingCacheMu.Unlock()
	if !force && !s.stagingCacheAt.IsZero() && time.Since(s.stagingCacheAt) < stagingSnapshotTTL {
		if s.obs != nil {
			s.obs.noteStagingSnapshotCache(true)
		}
		return s.stagingCache, nil
	}
	if s.obs != nil {
		s.obs.noteStagingSnapshotCache(false)
	}
	started := time.Now()
	inventory, err := s.scanUploadStagingInventoryWithProgress(ctx, report)
	if s.obs != nil {
		s.obs.observeInternalOperation("staging_inventory_scan", time.Since(started))
	}
	if err != nil {
		return uploadStagingInventory{}, err
	}
	s.stagingCache = inventory
	s.stagingCacheAt = time.Now()
	return inventory, nil
}

func (s *Server) scanUploadStagingInventory(ctx context.Context) (uploadStagingInventory, error) {
	return s.scanUploadStagingInventoryWithProgress(ctx, nil)
}

func (s *Server) scanUploadStagingInventoryWithProgress(
	ctx context.Context,
	report storageSampleProgressReporter,
) (uploadStagingInventory, error) {
	emit := func(value storageSampleProgress) {
		if report != nil {
			report(value)
		}
	}
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
		SELECT p.storage_key, p.size, s.expires_at
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

	if _, ok := s.Store.(storage.StagingInspector); !ok {
		if _, ok := s.Store.(storage.StagingWalker); !ok {
			return uploadStagingInventory{Stats: stats, Known: known}, nil
		}
	}
	stats.Supported = true
	seenKnown := make(map[string]struct{}, len(known))
	cutoff := now.Add(-stagingOrphanGrace)
	emit(storageSampleProgress{
		Phase:       meta.SystemMaintenancePhaseStorageSampleStaging,
		Unit:        "item",
		CurrentItem: "上传暂存区",
		Force:       true,
	})
	if err := s.walkStagingFiles(ctx, func(file storage.StagingFile) error {
		stats.StagingFiles++
		stats.StagingBytes += file.Size
		emit(storageSampleProgress{
			Phase:       meta.SystemMaintenancePhaseStorageSampleStaging,
			Current:     stats.StagingFiles,
			Unit:        "item",
			Bytes:       stats.StagingBytes,
			CurrentItem: "上传暂存区",
		})
		if part, exists := known[file.Key]; exists {
			seenKnown[file.Key] = struct{}{}
			if !part.ExpiresAt.After(now) {
				stats.ExpiredStagingFiles++
				stats.ExpiredStagingBytes += file.Size
			}
			return nil
		}
		if !file.ModifiedAt.After(cutoff) {
			stats.OrphanFiles++
			stats.OrphanBytes += file.Size
		} else {
			stats.RecentUntrackedFiles++
			stats.RecentUntrackedBytes += file.Size
		}
		return nil
	}); err != nil {
		return uploadStagingInventory{}, err
	}
	for key, part := range known {
		if _, exists := seenKnown[key]; exists {
			continue
		}
		stats.MissingPartFiles++
		stats.MissingPartBytes += part.Size
	}
	stats.ReclaimableFiles = stats.OrphanFiles + stats.ExpiredStagingFiles
	stats.ReclaimableBytes = stats.OrphanBytes + stats.ExpiredStagingBytes
	emit(storageSampleProgress{
		Phase:       meta.SystemMaintenancePhaseStorageSampleStaging,
		Current:     stats.StagingFiles,
		Unit:        "item",
		Bytes:       stats.StagingBytes,
		CurrentItem: "上传暂存区",
		Force:       true,
	})
	return uploadStagingInventory{Stats: stats, Known: known, OrphanCutoff: cutoff}, nil
}

func (s *Server) walkStagingFiles(ctx context.Context, visit func(storage.StagingFile) error) error {
	if walker, ok := s.Store.(storage.StagingWalker); ok {
		return walker.WalkStaging(ctx, visit)
	}
	inspector, ok := s.Store.(storage.StagingInspector)
	if !ok {
		return nil
	}
	files, err := inspector.ListStaging(ctx)
	if err != nil {
		return err
	}
	sort.Slice(files, func(i, j int) bool {
		return files[i].Key < files[j].Key
	})
	for _, file := range files {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := visit(file); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) listStagingOrphanPage(
	ctx context.Context,
	inventory uploadStagingInventory,
	cursor string,
	offset int,
	limit int,
) ([]storage.StagingFile, bool, error) {
	if !inventory.Stats.Supported || limit <= 0 {
		return nil, false, nil
	}
	items := make([]storage.StagingFile, 0, limit+1)
	skipped := 0
	err := s.walkStagingFiles(ctx, func(file storage.StagingFile) error {
		if _, exists := inventory.Known[file.Key]; exists {
			return nil
		}
		if file.ModifiedAt.After(inventory.OrphanCutoff) {
			return nil
		}
		if cursor != "" {
			if file.Key <= cursor {
				return nil
			}
		} else if skipped < offset {
			skipped++
			return nil
		}
		items = append(items, file)
		if len(items) > limit {
			return errStopStagingWalk
		}
		return nil
	})
	if err != nil && !errors.Is(err, errStopStagingWalk) {
		return nil, false, err
	}
	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	return items, hasMore, nil
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
	forceFresh := strings.EqualFold(strings.TrimSpace(c.Query("fresh")), "true") || strings.TrimSpace(c.Query("fresh")) == "1"
	var inventory uploadStagingInventory
	var err error
	if forceFresh {
		inventory, err = s.loadUploadStagingInventoryFresh(ctx)
	} else {
		inventory, err = s.loadUploadStagingInventory(ctx)
	}
	if err != nil {
		fail(c, http.StatusInternalServerError, "load upload staging failed")
		return
	}

	pageStarted := time.Now()
	page, hasMore, err := s.listStagingOrphanPage(ctx, inventory, cursor, offset, limit)
	if s.obs != nil {
		s.obs.observeInternalOperation("staging_orphan_page", time.Since(pageStarted))
	}
	if err != nil {
		fail(c, http.StatusInternalServerError, "list upload staging orphans failed")
		return
	}
	out := make([]uploadStagingFileDTO, 0, len(page))
	for _, file := range page {
		out = append(out, uploadStagingFileDTO{Key: file.Key, Size: file.Size, ModifiedAt: file.ModifiedAt})
	}
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
		failures := make([]meta.StagingCleanupFailure, 0, stagingCleanupFailureBatchSize)
		flushFailures := func() error {
			if len(failures) == 0 {
				return nil
			}
			if err := s.DB.WithContext(ctx).Create(&failures).Error; err != nil {
				return err
			}
			failures = failures[:0]
			return nil
		}
		orphans := make([]storage.StagingFile, 0)
		if err := s.walkStagingFiles(ctx, func(file storage.StagingFile) error {
			if _, exists := inventory.Known[file.Key]; exists || file.ModifiedAt.After(inventory.OrphanCutoff) {
				return nil
			}
			orphans = append(orphans, file)
			return nil
		}); err != nil {
			return failRun(err)
		}
		for _, file := range orphans {
			if err := inspector.DeleteStaging(ctx, file.Key); err != nil {
				result.FailedFiles++
				failures = append(failures, meta.StagingCleanupFailure{
					RunID: run.ID, StorageKey: file.Key, Size: file.Size,
					Error: stagingCleanupError(err), FailedAt: time.Now().UTC(),
				})
				if len(failures) >= stagingCleanupFailureBatchSize {
					if err := flushFailures(); err != nil {
						return failRun(err)
					}
				}
				continue
			}
			result.DeletedFiles++
			result.DeletedBytes += file.Size
		}
		if err := flushFailures(); err != nil {
			return failRun(err)
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
