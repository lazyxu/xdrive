package api

import (
	"context"
	"math"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
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

type storageStatsDTO struct {
	Scope                     string                 `json:"scope"`
	CASBlobCount              int64                  `json:"cas_blob_count"`
	CASPhysicalBytes          int64                  `json:"cas_physical_bytes"`
	CASLogicalReferencedBytes int64                  `json:"cas_logical_referenced_bytes"`
	CASDedupSavedBytes        int64                  `json:"cas_dedup_saved_bytes"`
	CASDedupRatio             float64                `json:"cas_dedup_ratio"`
	CASSavingsRatio           float64                `json:"cas_savings_ratio"`
	AverageBlobSizeBytes      float64                `json:"average_blob_size_bytes"`
	P50BlobSizeBytes          int64                  `json:"p50_blob_size_bytes"`
	P90BlobSizeBytes          int64                  `json:"p90_blob_size_bytes"`
	P99BlobSizeBytes          int64                  `json:"p99_blob_size_bytes"`
	LegacyBlobCount           int64                  `json:"legacy_blob_count"`
	LegacyPhysicalBytes       int64                  `json:"legacy_physical_bytes"`
	Buckets                   []storageSizeBucketDTO `json:"buckets"`
	GeneratedAt               time.Time              `json:"generated_at"`
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
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
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
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	stats, err := s.loadGlobalStorageStats(ctx)
	if err != nil {
		fail(c, http.StatusInternalServerError, "load storage statistics failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, stats)
}

func (s *Server) loadUserStorageStats(ctx context.Context, uid uint64) (storageStatsDTO, error) {
	const query = `WITH refs AS (
  SELECT f.storage_key, f.size
  FROM xd_files f
  JOIN xd_nodes n ON n.id = f.node_id
  WHERE n.owner_id = ?
  UNION ALL
  SELECT v.storage_key, v.size
  FROM xd_file_versions v
  JOIN xd_nodes n ON n.id = v.node_id
  WHERE n.owner_id = ?
),
cas_unique AS (
  SELECT storage_key, MAX(size) AS size
  FROM refs
  WHERE storage_key LIKE ?
  GROUP BY storage_key
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

	row := s.DB.WithContext(ctx).Raw(query, uid, uid, casStorageLikePattern, casStorageLikePattern, casStorageLikePattern).Row()
	statsRow, err := scanStorageStatsRow(row.Scan)
	if err != nil {
		return storageStatsDTO{}, err
	}
	return storageStatsFromRow("self", statsRow), nil
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
