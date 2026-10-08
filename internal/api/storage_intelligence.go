package api

import (
	"context"
	"errors"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/maintenance"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

const casStorageLikePattern = storage.ContentBlobDir + "/sha256/%"

type storageSizeBucketDTO struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Count int64  `json:"count"`
	Bytes int64  `json:"bytes"`
}

type storageLegacyObjectDTO struct {
	StorageKey         string    `json:"storage_key"`
	Size               int64     `json:"size"`
	CurrentFileRefs    int64     `json:"current_file_refs"`
	HistoryVersionRefs int64     `json:"history_version_refs"`
	LastReferencedAt   time.Time `json:"last_referenced_at"`
}

type storageLegacyObjectPageDTO struct {
	Items      []storageLegacyObjectDTO `json:"items"`
	HasMore    bool                     `json:"has_more"`
	NextCursor string                   `json:"next_cursor,omitempty"`
}

type storageUnreferencedBlobDTO struct {
	SHA256            string    `json:"sha256"`
	StorageKey        string    `json:"storage_key"`
	MetadataSize      int64     `json:"metadata_size"`
	PhysicalSize      int64     `json:"physical_size"`
	PhysicalExists    bool      `json:"physical_exists"`
	State             string    `json:"state"`
	ReusedUploadParts int64     `json:"reused_upload_parts"`
	GCStatus          string    `json:"gc_status"`
	UpdatedAt         time.Time `json:"updated_at"`
}

type storageUnreferencedBlobPageDTO struct {
	Items      []storageUnreferencedBlobDTO `json:"items"`
	HasMore    bool                         `json:"has_more"`
	NextCursor string                       `json:"next_cursor,omitempty"`
}

type storagePendingGCSnapshotDTO struct {
	AwaitingGCBlobCount           int64 `json:"awaiting_gc_blob_count"`
	AwaitingGCBlobBytes           int64 `json:"awaiting_gc_blob_bytes"`
	BlockedByUploadBlobCount      int64 `json:"blocked_by_upload_blob_count"`
	BlockedByUploadBlobBytes      int64 `json:"blocked_by_upload_blob_bytes"`
	PhysicalMissingBlobCount      int64 `json:"physical_missing_blob_count"`
	PhysicalMissingMetadataBytes  int64 `json:"physical_missing_metadata_bytes"`
	MetadataInconsistentBlobCount int64 `json:"metadata_inconsistent_blob_count"`
	MetadataInconsistentBlobBytes int64 `json:"metadata_inconsistent_blob_bytes"`
	DeletingBlobCount             int64 `json:"deleting_blob_count"`
	DeletingBlobMetadataBytes     int64 `json:"deleting_blob_metadata_bytes"`
}

type storageStatsDTO struct {
	Scope                     string                       `json:"scope"`
	DiskTotalBytes            *int64                       `json:"disk_total_bytes,omitempty"`
	DiskUsedBytes             *int64                       `json:"disk_used_bytes,omitempty"`
	DiskAvailableBytes        *int64                       `json:"disk_available_bytes,omitempty"`
	XDrivePhysicalBytes       *int64                       `json:"xdrive_physical_bytes,omitempty"`
	UploadStaging             *uploadStagingStatsDTO       `json:"upload_staging,omitempty"`
	Inventory                 *storageInventoryDTO         `json:"inventory,omitempty"`
	FileCount                 int64                        `json:"file_count,omitempty"`
	LogicalFileBytes          int64                        `json:"logical_file_bytes,omitempty"`
	AverageFileSizeBytes      float64                      `json:"average_file_size_bytes,omitempty"`
	P50FileSizeBytes          int64                        `json:"p50_file_size_bytes,omitempty"`
	P90FileSizeBytes          int64                        `json:"p90_file_size_bytes,omitempty"`
	P99FileSizeBytes          int64                        `json:"p99_file_size_bytes,omitempty"`
	FileBuckets               []storageSizeBucketDTO       `json:"file_buckets,omitempty"`
	CASBlobCount              int64                        `json:"cas_blob_count,omitempty"`
	CASPhysicalBytes          int64                        `json:"cas_physical_bytes,omitempty"`
	UnreferencedBlobCount     int64                        `json:"unreferenced_blob_count,omitempty"`
	UnreferencedBlobBytes     int64                        `json:"unreferenced_blob_bytes,omitempty"`
	PendingGC                 *storagePendingGCSnapshotDTO `json:"pending_gc,omitempty"`
	CASHealth                 *maintenance.CASHealthReport `json:"cas_health,omitempty"`
	CASLogicalReferencedBytes int64                        `json:"cas_logical_referenced_bytes,omitempty"`
	CASDedupSavedBytes        int64                        `json:"cas_dedup_saved_bytes,omitempty"`
	CASDedupRatio             float64                      `json:"cas_dedup_ratio,omitempty"`
	CASSavingsRatio           float64                      `json:"cas_savings_ratio,omitempty"`
	AverageBlobSizeBytes      float64                      `json:"average_blob_size_bytes,omitempty"`
	P50BlobSizeBytes          int64                        `json:"p50_blob_size_bytes,omitempty"`
	P90BlobSizeBytes          int64                        `json:"p90_blob_size_bytes,omitempty"`
	P99BlobSizeBytes          int64                        `json:"p99_blob_size_bytes,omitempty"`
	LegacyBlobCount           int64                        `json:"legacy_blob_count,omitempty"`
	LegacyPhysicalBytes       int64                        `json:"legacy_physical_bytes,omitempty"`
	Buckets                   []storageSizeBucketDTO       `json:"buckets,omitempty"`
	PhysicalSnapshotAt        *time.Time                   `json:"physical_snapshot_at,omitempty"`
	GeneratedAt               time.Time                    `json:"generated_at"`
}

type storageStatsRow struct {
	CASLogicalReferencedBytes int64
	LegacyBlobCount           int64
	LegacyPhysicalBytes       int64
	CASBlobCount              int64
	CASPhysicalBytes          int64
	AverageBlobSizeBytes      float64
	P50BlobSizeBytes          float64
	P90BlobSizeBytes          float64
	P99BlobSizeBytes          float64
	LT16KiBCount              int64
	LT16KiBBytes              int64
	B16To64KiBCount           int64
	B16To64KiBBytes           int64
	B64To256KiBCount          int64
	B64To256KiBBytes          int64
	B256KiBTo1MiBCount        int64
	B256KiBTo1MiBBytes        int64
	B1To4MiBCount             int64
	B1To4MiBBytes             int64
	B4To16MiBCount            int64
	B4To16MiBBytes            int64
	B16To64MiBCount           int64
	B16To64MiBBytes           int64
	GE64MiBCount              int64
	GE64MiBBytes              int64
}

func (s *Server) storageStats(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), time.Minute)
	defer cancel()

	stats, err := s.loadUserStorageStats(ctx, userID(c))
	if err != nil {
		fail(c, http.StatusInternalServerError, "load storage statistics failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, stats)
}

func (s *Server) adminStorageStats(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), time.Minute)
	defer cancel()

	stats, snapshotAvailable, err := s.loadLatestStorageSnapshot(ctx)
	if err != nil {
		fail(c, http.StatusInternalServerError, "load storage snapshot failed")
		return
	}
	if !snapshotAvailable {
		stats, err = s.loadGlobalStorageStats(ctx)
		if err != nil {
			fail(c, http.StatusInternalServerError, "load storage statistics failed")
			return
		}
	}

	capacity, err := s.storageCapacity(ctx)
	if err != nil {
		fail(c, http.StatusInternalServerError, "load storage capacity failed")
		return
	}
	diskTotal := capacity.TotalBytes
	diskAvailable := capacity.AvailableBytes
	diskUsed := diskTotal - diskAvailable
	if diskUsed < 0 {
		diskUsed = 0
	}
	stats.DiskTotalBytes = &diskTotal
	stats.DiskUsedBytes = &diskUsed
	stats.DiskAvailableBytes = &diskAvailable
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, stats)
}

func storageDiagnosticPageParams(c *gin.Context) (int, string, bool) {
	limit := 20
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 100 {
			fail(c, http.StatusBadRequest, "limit must be between 1 and 100")
			return 0, "", false
		}
		limit = value
	}
	return limit, strings.TrimSpace(c.Query("cursor")), true
}

func (s *Server) adminStorageLegacyObjects(c *gin.Context) {
	limit, cursor, ok := storageDiagnosticPageParams(c)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	const query = `WITH refs AS (
  SELECT storage_key, size,
         1::bigint AS current_file_refs,
         0::bigint AS history_version_refs,
         updated_at AS referenced_at
  FROM xd_files
  WHERE storage_key NOT LIKE ?
  UNION ALL
  SELECT storage_key, size,
         0::bigint AS current_file_refs,
         1::bigint AS history_version_refs,
         created_at AS referenced_at
  FROM xd_file_versions
  WHERE storage_key NOT LIKE ?
)
SELECT storage_key,
       MAX(size) AS size,
       SUM(current_file_refs) AS current_file_refs,
       SUM(history_version_refs) AS history_version_refs,
       MAX(referenced_at) AS last_referenced_at
FROM refs
WHERE (? = '' OR storage_key > ?)
GROUP BY storage_key
ORDER BY storage_key ASC
LIMIT ?`

	var items []storageLegacyObjectDTO
	if err := s.DB.WithContext(ctx).Raw(
		query,
		casStorageLikePattern,
		casStorageLikePattern,
		cursor,
		cursor,
		limit+1,
	).Scan(&items).Error; err != nil {
		fail(c, http.StatusInternalServerError, "load legacy storage objects failed")
		return
	}

	page := storageLegacyObjectPageDTO{Items: items}
	if len(page.Items) > limit {
		page.HasMore = true
		page.Items = page.Items[:limit]
		page.NextCursor = page.Items[len(page.Items)-1].StorageKey
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, page)
}

func (s *Server) adminStorageUnreferencedBlobs(c *gin.Context) {
	limit, cursor, ok := storageDiagnosticPageParams(c)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()

	query := s.DB.WithContext(ctx).
		Where("ref_count = 0").
		Order("storage_key ASC").
		Limit(limit + 1)
	if cursor != "" {
		query = query.Where("storage_key > ?", cursor)
	}
	var blobs []meta.ContentBlob
	if err := query.Find(&blobs).Error; err != nil {
		fail(c, http.StatusInternalServerError, "load unreferenced content blobs failed")
		return
	}

	hasMore := len(blobs) > limit
	if hasMore {
		blobs = blobs[:limit]
	}

	keys := make([]string, 0, len(blobs))
	for _, blob := range blobs {
		keys = append(keys, blob.StorageKey)
	}
	reusedCounts := make(map[string]int64, len(keys))
	if len(keys) > 0 {
		var rows []struct {
			SourceStorageKey string `gorm:"column:source_storage_key"`
			Count            int64  `gorm:"column:count"`
		}
		if err := s.DB.WithContext(ctx).
			Model(&meta.UploadPart{}).
			Select("source_storage_key, COUNT(*) AS count").
			Where("reused = ? AND source_storage_key IN ?", true, keys).
			Group("source_storage_key").
			Scan(&rows).Error; err != nil {
			fail(c, http.StatusInternalServerError, "load content blob reuse guards failed")
			return
		}
		for _, row := range rows {
			reusedCounts[row.SourceStorageKey] = row.Count
		}
	}

	items := make([]storageUnreferencedBlobDTO, 0, len(blobs))
	for _, blob := range blobs {
		item := storageUnreferencedBlobDTO{
			SHA256:            blob.SHA256,
			StorageKey:        blob.StorageKey,
			MetadataSize:      blob.Size,
			State:             blob.State,
			ReusedUploadParts: reusedCounts[blob.StorageKey],
			UpdatedAt:         blob.UpdatedAt,
		}
		file, err := s.Store.Open(ctx, blob.StorageKey)
		if err != nil {
			if !errors.Is(err, os.ErrNotExist) {
				fail(c, http.StatusInternalServerError, "inspect unreferenced content blob failed")
				return
			}
		} else {
			info, statErr := file.Stat()
			closeErr := file.Close()
			if statErr != nil {
				fail(c, http.StatusInternalServerError, "inspect unreferenced content blob failed")
				return
			}
			if closeErr != nil {
				fail(c, http.StatusInternalServerError, "close unreferenced content blob failed")
				return
			}
			item.PhysicalExists = true
			item.PhysicalSize = info.Size()
		}

		item.GCStatus = storageUnreferencedGCStatus(
			item.PhysicalExists,
			blob.State,
			item.ReusedUploadParts,
		)
		items = append(items, item)
	}

	page := storageUnreferencedBlobPageDTO{
		Items:   items,
		HasMore: hasMore,
	}
	if hasMore && len(items) > 0 {
		page.NextCursor = items[len(items)-1].StorageKey
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, page)
}

func (s *Server) adminStorageHealth(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	health, err := maintenance.CASHealth(s.DB.WithContext(ctx), maintenance.CASDeletingStaleAfter)
	if err != nil {
		fail(c, http.StatusInternalServerError, "load storage health failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, health)
}

type userFileStorageStatsRow struct {
	FileCount            int64
	LogicalFileBytes     int64
	AverageFileSizeBytes float64
	P50FileSizeBytes     float64
	P90FileSizeBytes     float64
	P99FileSizeBytes     float64
	LT16KiBCount         int64
	LT16KiBBytes         int64
	B16To64KiBCount      int64
	B16To64KiBBytes      int64
	B64To256KiBCount     int64
	B64To256KiBBytes     int64
	B256KiBTo1MiBCount   int64
	B256KiBTo1MiBBytes   int64
	B1To4MiBCount        int64
	B1To4MiBBytes        int64
	B4To16MiBCount       int64
	B4To16MiBBytes       int64
	B16To64MiBCount      int64
	B16To64MiBBytes      int64
	GE64MiBCount         int64
	GE64MiBBytes         int64
}

func (s *Server) loadUserStorageStats(ctx context.Context, uid uint64) (storageStatsDTO, error) {
	const query = `SELECT
  COUNT(*),
  COALESCE(SUM(f.size), 0),
  COALESCE(AVG(f.size), 0),
  COALESCE(percentile_cont(0.50) WITHIN GROUP (ORDER BY f.size), 0),
  COALESCE(percentile_cont(0.90) WITHIN GROUP (ORDER BY f.size), 0),
  COALESCE(percentile_cont(0.99) WITHIN GROUP (ORDER BY f.size), 0),
  COUNT(*) FILTER (WHERE f.size < 16384),
  COALESCE(SUM(f.size) FILTER (WHERE f.size < 16384), 0),
  COUNT(*) FILTER (WHERE f.size >= 16384 AND f.size < 65536),
  COALESCE(SUM(f.size) FILTER (WHERE f.size >= 16384 AND f.size < 65536), 0),
  COUNT(*) FILTER (WHERE f.size >= 65536 AND f.size < 262144),
  COALESCE(SUM(f.size) FILTER (WHERE f.size >= 65536 AND f.size < 262144), 0),
  COUNT(*) FILTER (WHERE f.size >= 262144 AND f.size < 1048576),
  COALESCE(SUM(f.size) FILTER (WHERE f.size >= 262144 AND f.size < 1048576), 0),
  COUNT(*) FILTER (WHERE f.size >= 1048576 AND f.size < 4194304),
  COALESCE(SUM(f.size) FILTER (WHERE f.size >= 1048576 AND f.size < 4194304), 0),
  COUNT(*) FILTER (WHERE f.size >= 4194304 AND f.size < 16777216),
  COALESCE(SUM(f.size) FILTER (WHERE f.size >= 4194304 AND f.size < 16777216), 0),
  COUNT(*) FILTER (WHERE f.size >= 16777216 AND f.size < 67108864),
  COALESCE(SUM(f.size) FILTER (WHERE f.size >= 16777216 AND f.size < 67108864), 0),
  COUNT(*) FILTER (WHERE f.size >= 67108864),
  COALESCE(SUM(f.size) FILTER (WHERE f.size >= 67108864), 0)
FROM xd_files f
JOIN xd_nodes n ON n.id = f.node_id
WHERE n.owner_id = ? AND n.deleted_at IS NULL`

	var row userFileStorageStatsRow
	err := s.DB.WithContext(ctx).Raw(query, uid).Row().Scan(
		&row.FileCount,
		&row.LogicalFileBytes,
		&row.AverageFileSizeBytes,
		&row.P50FileSizeBytes,
		&row.P90FileSizeBytes,
		&row.P99FileSizeBytes,
		&row.LT16KiBCount, &row.LT16KiBBytes,
		&row.B16To64KiBCount, &row.B16To64KiBBytes,
		&row.B64To256KiBCount, &row.B64To256KiBBytes,
		&row.B256KiBTo1MiBCount, &row.B256KiBTo1MiBBytes,
		&row.B1To4MiBCount, &row.B1To4MiBBytes,
		&row.B4To16MiBCount, &row.B4To16MiBBytes,
		&row.B16To64MiBCount, &row.B16To64MiBBytes,
		&row.GE64MiBCount, &row.GE64MiBBytes,
	)
	if err != nil {
		return storageStatsDTO{}, err
	}
	return userFileStorageStatsFromRow(row), nil
}

func userFileStorageStatsFromRow(row userFileStorageStatsRow) storageStatsDTO {
	return storageStatsDTO{
		Scope:                "self",
		FileCount:            row.FileCount,
		LogicalFileBytes:     row.LogicalFileBytes,
		AverageFileSizeBytes: row.AverageFileSizeBytes,
		P50FileSizeBytes:     int64(math.Round(row.P50FileSizeBytes)),
		P90FileSizeBytes:     int64(math.Round(row.P90FileSizeBytes)),
		P99FileSizeBytes:     int64(math.Round(row.P99FileSizeBytes)),
		FileBuckets: []storageSizeBucketDTO{
			{Key: "lt_16_kib", Label: "< 16 KiB", Count: row.LT16KiBCount, Bytes: row.LT16KiBBytes},
			{Key: "16_64_kib", Label: "16–64 KiB", Count: row.B16To64KiBCount, Bytes: row.B16To64KiBBytes},
			{Key: "64_256_kib", Label: "64–256 KiB", Count: row.B64To256KiBCount, Bytes: row.B64To256KiBBytes},
			{Key: "256_kib_1_mib", Label: "256 KiB–1 MiB", Count: row.B256KiBTo1MiBCount, Bytes: row.B256KiBTo1MiBBytes},
			{Key: "1_4_mib", Label: "1–4 MiB", Count: row.B1To4MiBCount, Bytes: row.B1To4MiBBytes},
			{Key: "4_16_mib", Label: "4–16 MiB", Count: row.B4To16MiBCount, Bytes: row.B4To16MiBBytes},
			{Key: "16_64_mib", Label: "16–64 MiB", Count: row.B16To64MiBCount, Bytes: row.B16To64MiBBytes},
			{Key: "ge_64_mib", Label: "≥ 64 MiB", Count: row.GE64MiBCount, Bytes: row.GE64MiBBytes},
		},
		GeneratedAt: time.Now().UTC(),
	}
}

func (s *Server) loadGlobalStorageStats(ctx context.Context) (storageStatsDTO, error) {
	const query = `WITH refs AS (
  SELECT storage_key, size FROM xd_files
  UNION ALL
  SELECT storage_key, size FROM xd_file_versions
),
cas_unique AS (
  SELECT size
  FROM xd_content_blobs
  WHERE state = ? AND ref_count > 0
),
legacy_unique AS (
  SELECT storage_key, MAX(size) AS size
  FROM refs
  WHERE storage_key NOT LIKE ?
  GROUP BY storage_key
)
SELECT
  COALESCE((SELECT SUM(size) FROM refs WHERE storage_key LIKE ?), 0),
  COALESCE((SELECT COUNT(*) FROM legacy_unique), 0),
  COALESCE((SELECT SUM(size) FROM legacy_unique), 0),
  COUNT(*),
  COALESCE(SUM(size), 0),
  COALESCE(AVG(size), 0),
  COALESCE(percentile_cont(0.50) WITHIN GROUP (ORDER BY size), 0),
  COALESCE(percentile_cont(0.90) WITHIN GROUP (ORDER BY size), 0),
  COALESCE(percentile_cont(0.99) WITHIN GROUP (ORDER BY size), 0),
  COUNT(*) FILTER (WHERE size < 16384),
  COALESCE(SUM(size) FILTER (WHERE size < 16384), 0),
  COUNT(*) FILTER (WHERE size >= 16384 AND size < 65536),
  COALESCE(SUM(size) FILTER (WHERE size >= 16384 AND size < 65536), 0),
  COUNT(*) FILTER (WHERE size >= 65536 AND size < 262144),
  COALESCE(SUM(size) FILTER (WHERE size >= 65536 AND size < 262144), 0),
  COUNT(*) FILTER (WHERE size >= 262144 AND size < 1048576),
  COALESCE(SUM(size) FILTER (WHERE size >= 262144 AND size < 1048576), 0),
  COUNT(*) FILTER (WHERE size >= 1048576 AND size < 4194304),
  COALESCE(SUM(size) FILTER (WHERE size >= 1048576 AND size < 4194304), 0),
  COUNT(*) FILTER (WHERE size >= 4194304 AND size < 16777216),
  COALESCE(SUM(size) FILTER (WHERE size >= 4194304 AND size < 16777216), 0),
  COUNT(*) FILTER (WHERE size >= 16777216 AND size < 67108864),
  COALESCE(SUM(size) FILTER (WHERE size >= 16777216 AND size < 67108864), 0),
  COUNT(*) FILTER (WHERE size >= 67108864),
  COALESCE(SUM(size) FILTER (WHERE size >= 67108864), 0)
FROM cas_unique`

	row := s.DB.WithContext(ctx).Raw(query, meta.ContentBlobStateReady, casStorageLikePattern, casStorageLikePattern).Row()
	statsRow, err := scanStorageStatsRow(row.Scan)
	if err != nil {
		return storageStatsDTO{}, err
	}
	return storageStatsFromRow("global", statsRow), nil
}

func storageUnreferencedGCStatus(
	physicalExists bool,
	state string,
	reusedUploadParts int64,
) string {
	switch {
	case !physicalExists:
		return "physical_missing"
	case state != meta.ContentBlobStateDeleting:
		return "metadata_inconsistent"
	case reusedUploadParts > 0:
		return "blocked_by_upload"
	default:
		return "awaiting_gc"
	}
}

func (s *Server) loadUnreferencedContentBlobSnapshot(
	ctx context.Context,
) (storagePendingGCSnapshotDTO, int64, int64, error) {
	var snapshot storagePendingGCSnapshotDTO
	var blobs []meta.ContentBlob
	if err := s.DB.WithContext(ctx).
		Where("ref_count = 0").
		Order("storage_key ASC").
		Find(&blobs).Error; err != nil {
		return snapshot, 0, 0, err
	}

	reusedCounts := make(map[string]int64)
	if len(blobs) > 0 {
		var rows []struct {
			SourceStorageKey string `gorm:"column:source_storage_key"`
			Count            int64  `gorm:"column:count"`
		}
		const query = `SELECT p.source_storage_key, COUNT(*) AS count
FROM xd_upload_parts AS p
JOIN xd_content_blobs AS b ON b.storage_key = p.source_storage_key
WHERE p.reused = TRUE AND b.ref_count = 0
GROUP BY p.source_storage_key`
		if err := s.DB.WithContext(ctx).Raw(query).Scan(&rows).Error; err != nil {
			return snapshot, 0, 0, err
		}
		for _, row := range rows {
			reusedCounts[row.SourceStorageKey] = row.Count
		}
	}

	var physicalCount, physicalBytes int64
	for _, blob := range blobs {
		if err := ctx.Err(); err != nil {
			return snapshot, 0, 0, err
		}
		if blob.State == meta.ContentBlobStateDeleting {
			snapshot.DeletingBlobCount++
			snapshot.DeletingBlobMetadataBytes += blob.Size
		}

		var physicalExists bool
		var physicalSize int64
		file, err := s.Store.Open(ctx, blob.StorageKey)
		if err != nil {
			if !errors.Is(err, os.ErrNotExist) {
				return snapshot, 0, 0, err
			}
		} else {
			info, statErr := file.Stat()
			closeErr := file.Close()
			if statErr != nil {
				return snapshot, 0, 0, statErr
			}
			if closeErr != nil {
				return snapshot, 0, 0, closeErr
			}
			physicalExists = true
			physicalSize = info.Size()
			physicalCount++
			physicalBytes += physicalSize
		}

		switch storageUnreferencedGCStatus(
			physicalExists,
			blob.State,
			reusedCounts[blob.StorageKey],
		) {
		case "awaiting_gc":
			snapshot.AwaitingGCBlobCount++
			snapshot.AwaitingGCBlobBytes += physicalSize
		case "blocked_by_upload":
			snapshot.BlockedByUploadBlobCount++
			snapshot.BlockedByUploadBlobBytes += physicalSize
		case "physical_missing":
			snapshot.PhysicalMissingBlobCount++
			snapshot.PhysicalMissingMetadataBytes += blob.Size
		case "metadata_inconsistent":
			snapshot.MetadataInconsistentBlobCount++
			snapshot.MetadataInconsistentBlobBytes += physicalSize
		}
	}
	return snapshot, physicalCount, physicalBytes, nil
}

type rowScanner func(dest ...any) error

func scanStorageStatsRow(scan rowScanner) (storageStatsRow, error) {
	var row storageStatsRow
	err := scan(
		&row.CASLogicalReferencedBytes,
		&row.LegacyBlobCount,
		&row.LegacyPhysicalBytes,
		&row.CASBlobCount,
		&row.CASPhysicalBytes,
		&row.AverageBlobSizeBytes,
		&row.P50BlobSizeBytes,
		&row.P90BlobSizeBytes,
		&row.P99BlobSizeBytes,
		&row.LT16KiBCount, &row.LT16KiBBytes,
		&row.B16To64KiBCount, &row.B16To64KiBBytes,
		&row.B64To256KiBCount, &row.B64To256KiBBytes,
		&row.B256KiBTo1MiBCount, &row.B256KiBTo1MiBBytes,
		&row.B1To4MiBCount, &row.B1To4MiBBytes,
		&row.B4To16MiBCount, &row.B4To16MiBBytes,
		&row.B16To64MiBCount, &row.B16To64MiBBytes,
		&row.GE64MiBCount, &row.GE64MiBBytes,
	)
	return row, err
}

func storageStatsFromRow(scope string, row storageStatsRow) storageStatsDTO {
	saved := row.CASLogicalReferencedBytes - row.CASPhysicalBytes
	if saved < 0 {
		saved = 0
	}
	var dedupRatio, savingsRatio float64
	if row.CASPhysicalBytes > 0 {
		dedupRatio = float64(row.CASLogicalReferencedBytes) / float64(row.CASPhysicalBytes)
	}
	if row.CASLogicalReferencedBytes > 0 {
		savingsRatio = float64(saved) / float64(row.CASLogicalReferencedBytes)
	}
	return storageStatsDTO{
		Scope:                     scope,
		CASBlobCount:              row.CASBlobCount,
		CASPhysicalBytes:          row.CASPhysicalBytes,
		CASLogicalReferencedBytes: row.CASLogicalReferencedBytes,
		CASDedupSavedBytes:        saved,
		CASDedupRatio:             dedupRatio,
		CASSavingsRatio:           savingsRatio,
		AverageBlobSizeBytes:      row.AverageBlobSizeBytes,
		P50BlobSizeBytes:          int64(math.Round(row.P50BlobSizeBytes)),
		P90BlobSizeBytes:          int64(math.Round(row.P90BlobSizeBytes)),
		P99BlobSizeBytes:          int64(math.Round(row.P99BlobSizeBytes)),
		LegacyBlobCount:           row.LegacyBlobCount,
		LegacyPhysicalBytes:       row.LegacyPhysicalBytes,
		Buckets: []storageSizeBucketDTO{
			{Key: "lt_16_kib", Label: "< 16 KiB", Count: row.LT16KiBCount, Bytes: row.LT16KiBBytes},
			{Key: "16_64_kib", Label: "16–64 KiB", Count: row.B16To64KiBCount, Bytes: row.B16To64KiBBytes},
			{Key: "64_256_kib", Label: "64–256 KiB", Count: row.B64To256KiBCount, Bytes: row.B64To256KiBBytes},
			{Key: "256_kib_1_mib", Label: "256 KiB–1 MiB", Count: row.B256KiBTo1MiBCount, Bytes: row.B256KiBTo1MiBBytes},
			{Key: "1_4_mib", Label: "1–4 MiB", Count: row.B1To4MiBCount, Bytes: row.B1To4MiBBytes},
			{Key: "4_16_mib", Label: "4–16 MiB", Count: row.B4To16MiBCount, Bytes: row.B4To16MiBBytes},
			{Key: "16_64_mib", Label: "16–64 MiB", Count: row.B16To64MiBCount, Bytes: row.B16To64MiBBytes},
			{Key: "ge_64_mib", Label: "≥ 64 MiB", Count: row.GE64MiBCount, Bytes: row.GE64MiBBytes},
		},
		GeneratedAt: time.Now().UTC(),
	}
}
