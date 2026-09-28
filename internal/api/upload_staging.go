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
)

const stagingOrphanGrace = time.Hour

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
	Stats   uploadStagingStatsDTO  `json:"stats"`
	Orphans []uploadStagingFileDTO `json:"orphans"`
	HasMore bool                   `json:"has_more"`
}

type uploadStagingCleanupDTO struct {
	DeletedFiles int64                 `json:"deleted_files"`
	DeletedBytes int64                 `json:"deleted_bytes"`
	FailedFiles  int64                 `json:"failed_files"`
	Stats        uploadStagingStatsDTO `json:"stats"`
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

func (s *Server) loadUploadStagingInventory(ctx context.Context) (uploadStagingInventory, error) {
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
		if orphans[i].ModifiedAt.Equal(orphans[j].ModifiedAt) {
			return orphans[i].Key < orphans[j].Key
		}
		return orphans[i].ModifiedAt.Before(orphans[j].ModifiedAt)
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
	inventory, err := s.loadUploadStagingInventory(ctx)
	if err != nil {
		fail(c, http.StatusInternalServerError, "load upload staging failed")
		return
	}
	start := offset
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
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, uploadStagingDetailDTO{
		Stats: inventory.Stats, Orphans: out, HasMore: end < len(inventory.Orphans),
	})
}

func (s *Server) cleanupUploadStaging(ctx context.Context) (uploadStagingCleanupDTO, error) {
	before, err := s.loadUploadStagingInventory(ctx)
	if err != nil {
		return uploadStagingCleanupDTO{}, err
	}
	if err := s.cleanupExpiredUploads(ctx, 0); err != nil {
		return uploadStagingCleanupDTO{}, err
	}
	inventory, err := s.loadUploadStagingInventory(ctx)
	if err != nil {
		return uploadStagingCleanupDTO{}, err
	}
	inspector, ok := s.Store.(storage.StagingInspector)
	if !ok {
		return uploadStagingCleanupDTO{Stats: inventory.Stats}, nil
	}
	var result uploadStagingCleanupDTO
	for _, file := range inventory.Orphans {
		if err := inspector.DeleteStaging(ctx, file.Key); err != nil {
			result.FailedFiles++
			continue
		}
		result.DeletedFiles++
		result.DeletedBytes += file.Size
	}
	fresh, err := s.loadUploadStagingInventory(ctx)
	if err != nil {
		return uploadStagingCleanupDTO{}, err
	}
	if removed := before.Stats.StagingFiles - fresh.Stats.StagingFiles; removed > result.DeletedFiles {
		result.DeletedFiles = removed
	}
	if removed := before.Stats.StagingBytes - fresh.Stats.StagingBytes; removed > result.DeletedBytes {
		result.DeletedBytes = removed
	}
	result.Stats = fresh.Stats
	return result, nil
}

func (s *Server) adminCleanupUploadStaging(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()

	result, err := s.cleanupUploadStaging(ctx)
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
			"deleted_files": result.DeletedFiles,
			"deleted_bytes": result.DeletedBytes,
			"failed_files":  result.FailedFiles,
		},
	})
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, result)
}
