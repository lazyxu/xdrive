package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/maintenance"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm/clause"
)

const (
	storageSampleInterval          = 24 * time.Hour
	storageSampleCheckInterval     = time.Hour
	storageSampleRetention         = 180 * 24 * time.Hour
	storageDecisionWindow          = 7 * 24 * time.Hour
	storageDecisionMinSpan         = 24 * time.Hour
	storageDecisionMinSamples      = 4
	storageSnapshotStaleAfter      = 36 * time.Hour
	storageGrowthWindowSamples     = 3
	storageUnreferencedGrowthFloor = int64(64 << 20)
	storageCacheGrowthFloor        = int64(10 << 30)
)

type storageSampleProgress struct {
	Phase       string
	Current     int64
	Total       int64
	Unit        string
	Bytes       int64
	Errors      int64
	CurrentItem string
	Force       bool
}

type storageSampleProgressReporter func(storageSampleProgress)

type storageHistoryPointDTO struct {
	SlotAt                            time.Time              `json:"slot_at"`
	CapturedAt                        time.Time              `json:"captured_at"`
	CASBlobCount                      int64                  `json:"cas_blob_count"`
	CASPhysicalBytes                  int64                  `json:"cas_physical_bytes"`
	CASLogicalReferencedBytes         int64                  `json:"cas_logical_referenced_bytes"`
	CASDedupRatio                     float64                `json:"cas_dedup_ratio"`
	CASSavingsRatio                   float64                `json:"cas_savings_ratio"`
	P50BlobSizeBytes                  int64                  `json:"p50_blob_size_bytes"`
	P90BlobSizeBytes                  int64                  `json:"p90_blob_size_bytes"`
	P99BlobSizeBytes                  int64                  `json:"p99_blob_size_bytes"`
	SmallLT64KiBCountShare            float64                `json:"small_lt64_kib_count_share"`
	SmallLT256KiBCountShare           float64                `json:"small_lt256_kib_count_share"`
	LargeGE16MiBByteShare             float64                `json:"large_ge16_mib_byte_share"`
	Buckets                           []storageSizeBucketDTO `json:"buckets"`
	UnreferencedBlobCount             int64                  `json:"unreferenced_blob_count"`
	UnreferencedBlobBytes             int64                  `json:"unreferenced_blob_bytes"`
	LegacyBlobCount                   int64                  `json:"legacy_blob_count"`
	LegacyPhysicalBytes               int64                  `json:"legacy_physical_bytes"`
	AnomalySnapshotAvailable          bool                   `json:"anomaly_snapshot_available"`
	GCClassificationSnapshotAvailable bool                   `json:"gc_classification_snapshot_available"`
	AwaitingGCBlobCount               int64                  `json:"awaiting_gc_blob_count"`
	AwaitingGCBlobBytes               int64                  `json:"awaiting_gc_blob_bytes"`
	BlockedByUploadBlobCount          int64                  `json:"blocked_by_upload_blob_count"`
	BlockedByUploadBlobBytes          int64                  `json:"blocked_by_upload_blob_bytes"`
	PhysicalMissingBlobCount          int64                  `json:"physical_missing_blob_count"`
	PhysicalMissingMetadataBytes      int64                  `json:"physical_missing_metadata_bytes"`
	MetadataInconsistentBlobCount     int64                  `json:"metadata_inconsistent_blob_count"`
	MetadataInconsistentBlobBytes     int64                  `json:"metadata_inconsistent_blob_bytes"`
	DeletingBlobMetadataBytes         int64                  `json:"deleting_blob_metadata_bytes"`
	CASHealthSnapshotAvailable        bool                   `json:"cas_health_snapshot_available"`
	DeletingBlobCount                 int64                  `json:"deleting_blob_count"`
	StaleDeletingBlobCount            int64                  `json:"stale_deleting_blob_count"`
	MissingMetadataCount              int64                  `json:"missing_metadata_count"`
	RefCountMismatchCount             int64                  `json:"refcount_mismatch_count"`
	StateMismatchCount                int64                  `json:"state_mismatch_count"`
	SizeMismatchCount                 int64                  `json:"size_mismatch_count"`
	KeyHashMismatchCount              int64                  `json:"key_hash_mismatch_count"`
	InvalidStateCount                 int64                  `json:"invalid_state_count"`
	StagingOrphanBytes                int64                  `json:"staging_orphan_bytes"`
	StagingReclaimableBytes           int64                  `json:"staging_reclaimable_bytes"`
	MediaThumbnailBytes               int64                  `json:"media_thumbnail_bytes"`
	VideoPosterBytes                  int64                  `json:"video_poster_bytes"`
	AnalysisPreviewBytes              int64                  `json:"analysis_preview_bytes"`
	MediaOtherBytes                   int64                  `json:"media_other_bytes"`
	PreviewCacheBytes                 int64                  `json:"preview_cache_bytes"`
	VideoTranscodeBytes               int64                  `json:"video_transcode_bytes"`
	StorageTempBytes                  int64                  `json:"storage_temp_bytes"`
	UnclassifiedBytes                 int64                  `json:"unclassified_bytes"`
}

type storageDecisionDTO struct {
	Priority                    string   `json:"priority"`
	Confidence                  string   `json:"confidence"`
	SampleCount                 int      `json:"sample_count"`
	SpanHours                   float64  `json:"span_hours"`
	WindowHours                 int      `json:"window_hours"`
	AverageSmallLT64CountShare  float64  `json:"average_small_lt64_kib_count_share"`
	AverageSmallLT256CountShare float64  `json:"average_small_lt256_kib_count_share"`
	AverageLargeGE16ByteShare   float64  `json:"average_large_ge16_mib_byte_share"`
	AverageDedupRatio           float64  `json:"average_dedup_ratio"`
	ReasonCodes                 []string `json:"reason_codes"`
}

type storageHistoryAnomalyDTO struct {
	Key          string    `json:"key"`
	Severity     string    `json:"severity"`
	Title        string    `json:"title"`
	Message      string    `json:"message"`
	ObservedAt   time.Time `json:"observed_at"`
	CurrentCount int64     `json:"current_count,omitempty"`
	CurrentBytes int64     `json:"current_bytes,omitempty"`
	DeltaBytes   int64     `json:"delta_bytes,omitempty"`
	AgeHours     float64   `json:"age_hours,omitempty"`
}

type storageHistoryDTO struct {
	Samples               []storageHistoryPointDTO   `json:"samples"`
	Anomalies             []storageHistoryAnomalyDTO `json:"anomalies"`
	Decision              storageDecisionDTO         `json:"decision"`
	SamplingIntervalHours int                        `json:"sampling_interval_hours"`
	RetentionDays         int                        `json:"retention_days"`
}

func (s *Server) StartStorageSampler(ctx context.Context) {
	if s == nil || s.DB == nil || s.BackgroundScheduler == nil {
		return
	}
	go func() {
		s.ensureStorageSamplerRunDue(ctx, time.Now().UTC())
		ticker := time.NewTicker(storageSampleCheckInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-ticker.C:
				s.ensureStorageSamplerRunDue(ctx, now.UTC())
			}
		}
	}()
}

func (s *Server) ensureStorageSamplerRunDue(ctx context.Context, now time.Time) {
	if ctx.Err() != nil {
		return
	}
	slot := now.UTC().Truncate(storageSampleInterval)
	var existing int64
	if err := s.DB.WithContext(ctx).Model(&meta.StorageSample{}).
		Where("slot_at = ? AND snapshot_json <> '' AND snapshot_json <> '{}'", slot).
		Count(&existing).Error; err != nil {
		s.ensureObservability()
		s.obs.logger.Warn("storage_sampling_due_check_failed", "error", err)
		return
	}
	if existing > 0 {
		return
	}
	if _, err := s.requestScheduledSystemMaintenanceRun(
		ctx,
		meta.SystemMaintenanceKindStorageSampler,
	); err != nil {
		s.ensureObservability()
		s.obs.logger.Warn("storage_sampling_schedule_failed", "error", err)
	}
}

func (s *Server) runStorageSamplingPass(ctx context.Context, now time.Time) {
	_ = s.captureStorageSample(ctx, now, false)
}

func (s *Server) captureStorageSampleIfDue(ctx context.Context, now time.Time) error {
	return s.captureStorageSample(ctx, now, false)
}

func (s *Server) captureStorageSample(ctx context.Context, now time.Time, force bool) error {
	return s.captureStorageSampleWithProgress(ctx, now, force, nil)
}

func (s *Server) captureStorageSampleWithProgress(
	ctx context.Context,
	now time.Time,
	force bool,
	report storageSampleProgressReporter,
) error {
	emit := func(value storageSampleProgress) {
		if report != nil {
			report(value)
		}
	}
	now = now.UTC()
	if err := s.DB.WithContext(ctx).
		Where("slot_at < ?", now.Add(-storageSampleRetention)).
		Delete(&meta.StorageSample{}).Error; err != nil {
		return err
	}

	slot := now.Truncate(storageSampleInterval)
	if !force {
		var existing int64
		if err := s.DB.WithContext(ctx).Model(&meta.StorageSample{}).
			Where("slot_at = ? AND snapshot_json <> '' AND snapshot_json <> '{}'", slot).
			Count(&existing).Error; err != nil {
			return err
		}
		if existing > 0 {
			emit(storageSampleProgress{
				Phase:       meta.SystemMaintenancePhaseStorageSamplePersist,
				Unit:        "item",
				CurrentItem: "今日存储快照已存在",
				Force:       true,
			})
			return nil
		}
	}

	emit(storageSampleProgress{
		Phase:       meta.SystemMaintenancePhaseStorageSampleStats,
		Unit:        "item",
		CurrentItem: "CAS 元数据",
		Force:       true,
	})
	stats, err := s.loadGlobalStorageStats(ctx)
	if err != nil {
		return err
	}
	emit(storageSampleProgress{
		Phase:       meta.SystemMaintenancePhaseStorageSampleStats,
		Current:     stats.CASBlobCount,
		Unit:        "item",
		Bytes:       stats.CASPhysicalBytes,
		CurrentItem: "CAS 元数据",
		Force:       true,
	})
	pendingGC, unreferencedCount, unreferencedBytes, err := s.loadUnreferencedContentBlobSnapshotWithProgress(
		ctx,
		report,
	)
	if err != nil {
		return err
	}
	stats.UnreferencedBlobCount = unreferencedCount
	stats.UnreferencedBlobBytes = unreferencedBytes
	stats.PendingGC = &pendingGC

	emit(storageSampleProgress{
		Phase:       meta.SystemMaintenancePhaseStorageSampleHealth,
		Unit:        "item",
		CurrentItem: "CAS 元数据一致性",
		Force:       true,
	})
	health, err := maintenance.CASHealth(
		s.DB.WithContext(ctx),
		maintenance.CASDeletingStaleAfter,
	)
	if err != nil {
		return err
	}
	stats.CASHealth = &health
	emit(storageSampleProgress{
		Phase:       meta.SystemMaintenancePhaseStorageSampleHealth,
		Current:     health.ReadyBlobs + health.DeletingBlobs,
		Unit:        "item",
		CurrentItem: "CAS 元数据一致性",
		Force:       true,
	})

	staging, err := s.loadUploadStagingInventoryFreshWithProgress(ctx, report)
	if err != nil {
		return err
	}
	inventory, err := s.scanStorageInventoryWithProgress(ctx, report)
	if err != nil {
		return err
	}
	stats.UploadStaging = &staging.Stats
	stats.Inventory = &inventory
	xdrivePhysical := inventory.StorageRootBytes
	stats.XDrivePhysicalBytes = &xdrivePhysical
	stats.PhysicalSnapshotAt = &now
	stats.GeneratedAt = now

	emit(storageSampleProgress{
		Phase:       meta.SystemMaintenancePhaseStorageSamplePersist,
		Unit:        "item",
		CurrentItem: "写入每日快照",
		Force:       true,
	})
	rawBuckets, err := json.Marshal(stats.Buckets)
	if err != nil {
		return err
	}
	rawSnapshot, err := json.Marshal(stats)
	if err != nil {
		return err
	}

	sample := meta.StorageSample{
		SlotAt:                    slot,
		CapturedAt:                now,
		CASBlobCount:              stats.CASBlobCount,
		CASPhysicalBytes:          stats.CASPhysicalBytes,
		CASLogicalReferencedBytes: stats.CASLogicalReferencedBytes,
		CASDedupRatio:             stats.CASDedupRatio,
		CASSavingsRatio:           stats.CASSavingsRatio,
		P50BlobSizeBytes:          stats.P50BlobSizeBytes,
		P90BlobSizeBytes:          stats.P90BlobSizeBytes,
		P99BlobSizeBytes:          stats.P99BlobSizeBytes,
		UnreferencedBlobCount:     stats.UnreferencedBlobCount,
		UnreferencedBlobBytes:     stats.UnreferencedBlobBytes,
		LegacyBlobCount:           stats.LegacyBlobCount,
		LegacyPhysicalBytes:       stats.LegacyPhysicalBytes,
		BucketsJSON:               string(rawBuckets),
		SnapshotJSON:              string(rawSnapshot),
	}
	err = s.DB.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "slot_at"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"captured_at",
			"cas_blob_count",
			"cas_physical_bytes",
			"cas_logical_referenced_bytes",
			"cas_dedup_ratio",
			"cas_savings_ratio",
			"p50_blob_size_bytes",
			"p90_blob_size_bytes",
			"p99_blob_size_bytes",
			"unreferenced_blob_count",
			"unreferenced_blob_bytes",
			"legacy_blob_count",
			"legacy_physical_bytes",
			"buckets_json",
			"snapshot_json",
		}),
	}).Create(&sample).Error
	if err != nil {
		return err
	}
	emit(storageSampleProgress{
		Phase:       meta.SystemMaintenancePhaseStorageSamplePersist,
		Current:     1,
		Total:       1,
		Unit:        "item",
		Bytes:       inventory.StorageRootBytes,
		CurrentItem: "每日快照已持久化",
		Force:       true,
	})
	return nil
}

func (s *Server) loadLatestStorageSnapshot(ctx context.Context) (storageStatsDTO, bool, error) {
	var rows []meta.StorageSample
	if err := s.DB.WithContext(ctx).
		Order("slot_at DESC").
		Limit(1).
		Find(&rows).Error; err != nil {
		return storageStatsDTO{}, false, err
	}
	if len(rows) == 0 || strings.TrimSpace(rows[0].SnapshotJSON) == "" ||
		strings.TrimSpace(rows[0].SnapshotJSON) == "{}" {
		return storageStatsDTO{}, false, nil
	}
	var stats storageStatsDTO
	if err := json.Unmarshal([]byte(rows[0].SnapshotJSON), &stats); err != nil {
		return storageStatsDTO{}, false, err
	}
	capturedAt := rows[0].CapturedAt.UTC()
	stats.PhysicalSnapshotAt = &capturedAt
	return stats, true, nil
}

func (s *Server) adminStorageHistory(c *gin.Context) {
	days := 30
	if raw := c.Query("days"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > int(storageSampleRetention/(24*time.Hour)) {
			fail(c, http.StatusBadRequest, "days must be between 1 and 180")
			return
		}
		days = value
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	history, err := s.loadStorageHistory(ctx, time.Now().UTC(), days)
	if err != nil {
		fail(c, http.StatusInternalServerError, "load storage history failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, history)
}

func storageHistoryInventoryBytes(inventory *storageInventoryDTO, key string) int64 {
	if inventory == nil {
		return 0
	}
	for _, item := range inventory.Items {
		if item.Key == key {
			return item.Bytes
		}
	}
	return 0
}

func storageHistorySnapshot(raw string) (storageStatsDTO, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "{}" {
		return storageStatsDTO{}, false
	}
	var stats storageStatsDTO
	if err := json.Unmarshal([]byte(raw), &stats); err != nil {
		return storageStatsDTO{}, false
	}
	return stats, stats.Inventory != nil && stats.UploadStaging != nil
}

func (s *Server) loadStorageHistory(ctx context.Context, now time.Time, days int) (storageHistoryDTO, error) {
	var rows []meta.StorageSample
	if err := s.DB.WithContext(ctx).
		Where("slot_at >= ?", now.UTC().Add(-time.Duration(days)*24*time.Hour)).
		Order("slot_at ASC").
		Find(&rows).Error; err != nil {
		return storageHistoryDTO{}, err
	}

	points := make([]storageHistoryPointDTO, 0, len(rows))
	for _, row := range rows {
		var buckets []storageSizeBucketDTO
		if err := json.Unmarshal([]byte(row.BucketsJSON), &buckets); err != nil {
			return storageHistoryDTO{}, err
		}
		small64, small256, large16 := storageWorkloadShares(buckets, row.CASBlobCount, row.CASPhysicalBytes)
		snapshot, anomalySnapshotAvailable := storageHistorySnapshot(row.SnapshotJSON)
		point := storageHistoryPointDTO{
			SlotAt: row.SlotAt, CapturedAt: row.CapturedAt,
			CASBlobCount:              row.CASBlobCount,
			CASPhysicalBytes:          row.CASPhysicalBytes,
			CASLogicalReferencedBytes: row.CASLogicalReferencedBytes,
			CASDedupRatio:             row.CASDedupRatio,
			CASSavingsRatio:           row.CASSavingsRatio,
			P50BlobSizeBytes:          row.P50BlobSizeBytes,
			P90BlobSizeBytes:          row.P90BlobSizeBytes,
			P99BlobSizeBytes:          row.P99BlobSizeBytes,
			SmallLT64KiBCountShare:    small64,
			SmallLT256KiBCountShare:   small256,
			LargeGE16MiBByteShare:     large16,
			Buckets:                   buckets,
			UnreferencedBlobCount:     row.UnreferencedBlobCount,
			UnreferencedBlobBytes:     row.UnreferencedBlobBytes,
			LegacyBlobCount:           row.LegacyBlobCount,
			LegacyPhysicalBytes:       row.LegacyPhysicalBytes,
			AnomalySnapshotAvailable:  anomalySnapshotAvailable,
		}
		if snapshot.PendingGC != nil {
			point.GCClassificationSnapshotAvailable = true
			point.AwaitingGCBlobCount = snapshot.PendingGC.AwaitingGCBlobCount
			point.AwaitingGCBlobBytes = snapshot.PendingGC.AwaitingGCBlobBytes
			point.BlockedByUploadBlobCount = snapshot.PendingGC.BlockedByUploadBlobCount
			point.BlockedByUploadBlobBytes = snapshot.PendingGC.BlockedByUploadBlobBytes
			point.PhysicalMissingBlobCount = snapshot.PendingGC.PhysicalMissingBlobCount
			point.PhysicalMissingMetadataBytes = snapshot.PendingGC.PhysicalMissingMetadataBytes
			point.MetadataInconsistentBlobCount = snapshot.PendingGC.MetadataInconsistentBlobCount
			point.MetadataInconsistentBlobBytes = snapshot.PendingGC.MetadataInconsistentBlobBytes
			point.DeletingBlobMetadataBytes = snapshot.PendingGC.DeletingBlobMetadataBytes
		}
		if snapshot.CASHealth != nil {
			point.CASHealthSnapshotAvailable = true
			point.DeletingBlobCount = snapshot.CASHealth.DeletingBlobs
			point.StaleDeletingBlobCount = snapshot.CASHealth.StaleDeletingBlobs
			point.MissingMetadataCount = snapshot.CASHealth.MissingMetadata
			point.RefCountMismatchCount = snapshot.CASHealth.RefCountMismatches
			point.StateMismatchCount = snapshot.CASHealth.StateMismatches
			point.SizeMismatchCount = snapshot.CASHealth.SizeMismatches
			point.KeyHashMismatchCount = snapshot.CASHealth.KeyHashMismatches
			point.InvalidStateCount = snapshot.CASHealth.InvalidStates
		}
		if snapshot.UploadStaging != nil {
			point.StagingOrphanBytes = snapshot.UploadStaging.OrphanBytes
			point.StagingReclaimableBytes = snapshot.UploadStaging.ReclaimableBytes
		}
		if snapshot.Inventory != nil {
			point.MediaThumbnailBytes = storageHistoryInventoryBytes(snapshot.Inventory, "media_thumbnail")
			point.VideoPosterBytes = storageHistoryInventoryBytes(snapshot.Inventory, "video_poster")
			point.AnalysisPreviewBytes = storageHistoryInventoryBytes(snapshot.Inventory, "analysis_preview")
			point.MediaOtherBytes = storageHistoryInventoryBytes(snapshot.Inventory, "media_other")
			point.PreviewCacheBytes = storageHistoryInventoryBytes(snapshot.Inventory, "preview_cache")
			point.VideoTranscodeBytes = storageHistoryInventoryBytes(snapshot.Inventory, "video_transcode")
			point.StorageTempBytes = storageHistoryInventoryBytes(snapshot.Inventory, "write_temp") +
				storageHistoryInventoryBytes(snapshot.Inventory, "readiness_temp")
			point.UnclassifiedBytes = snapshot.Inventory.UnclassifiedBytes
		}
		points = append(points, point)
	}
	return storageHistoryDTO{
		Samples:               points,
		Anomalies:             storageHistoryAnomalies(points, now.UTC()),
		Decision:              storageDecision(points),
		SamplingIntervalHours: int(storageSampleInterval / time.Hour),
		RetentionDays:         int(storageSampleRetention / (24 * time.Hour)),
	}, nil
}

func storageHistoryCacheBytes(point storageHistoryPointDTO) int64 {
	return point.MediaThumbnailBytes +
		point.VideoPosterBytes +
		point.AnalysisPreviewBytes +
		point.MediaOtherBytes +
		point.PreviewCacheBytes +
		point.VideoTranscodeBytes
}

func storageHistoryAvailableTail(
	points []storageHistoryPointDTO,
	count int,
	available func(storageHistoryPointDTO) bool,
) []storageHistoryPointDTO {
	if count <= 0 {
		return nil
	}
	out := make([]storageHistoryPointDTO, 0, count)
	for index := len(points) - 1; index >= 0 && len(out) < count; index-- {
		if !available(points[index]) {
			break
		}
		out = append(out, points[index])
	}
	for left, right := 0, len(out)-1; left < right; left, right = left+1, right-1 {
		out[left], out[right] = out[right], out[left]
	}
	return out
}

func storageHistoryMonotonicNonDecreasing(
	points []storageHistoryPointDTO,
	value func(storageHistoryPointDTO) int64,
) bool {
	if len(points) < storageGrowthWindowSamples {
		return false
	}
	for index := 1; index < len(points); index++ {
		if value(points[index]) < value(points[index-1]) {
			return false
		}
	}
	return true
}

func storageHistoryAnomalies(
	points []storageHistoryPointDTO,
	now time.Time,
) []storageHistoryAnomalyDTO {
	now = now.UTC()
	if len(points) == 0 {
		return []storageHistoryAnomalyDTO{{
			Key: "snapshot_missing", Severity: "warning",
			Title:      "尚无每日存储快照",
			Message:    "Storage sampler 尚未生成可用于异常判断的完整快照。",
			ObservedAt: now,
		}}
	}

	latest := points[len(points)-1]
	observedAt := latest.CapturedAt.UTC()
	anomalies := make([]storageHistoryAnomalyDTO, 0, 8)
	add := func(value storageHistoryAnomalyDTO) {
		value.ObservedAt = observedAt
		anomalies = append(anomalies, value)
	}

	age := now.Sub(observedAt)
	if age > storageSnapshotStaleAfter {
		add(storageHistoryAnomalyDTO{
			Key: "snapshot_stale", Severity: "warning",
			Title:    "每日存储快照已过期",
			Message:  "最近一次完整物理快照超过 36 小时未更新，请检查 Storage sampler。",
			AgeHours: age.Hours(),
		})
	}

	if latest.GCClassificationSnapshotAvailable {
		if latest.PhysicalMissingBlobCount > 0 {
			add(storageHistoryAnomalyDTO{
				Key: "physical_missing", Severity: "bad",
				Title:        "CAS 物理对象缺失",
				Message:      "存在 Blob 元数据但对应物理对象不存在，应运行存储完整性校验。",
				CurrentCount: latest.PhysicalMissingBlobCount,
				CurrentBytes: latest.PhysicalMissingMetadataBytes,
			})
		}
		if latest.MetadataInconsistentBlobCount > 0 {
			add(storageHistoryAnomalyDTO{
				Key: "metadata_inconsistent", Severity: "bad",
				Title:        "待 GC Blob 元数据状态异常",
				Message:      "存在 ref_count=0 但状态不符合 GC 合同的 Blob，应检查或修复 CAS 元数据。",
				CurrentCount: latest.MetadataInconsistentBlobCount,
				CurrentBytes: latest.MetadataInconsistentBlobBytes,
			})
		}
		blocked := storageHistoryAvailableTail(
			points,
			storageGrowthWindowSamples,
			func(point storageHistoryPointDTO) bool {
				return point.GCClassificationSnapshotAvailable
			},
		)
		if len(blocked) == storageGrowthWindowSamples &&
			storageHistoryMonotonicNonDecreasing(
				blocked,
				func(point storageHistoryPointDTO) int64 {
					return point.BlockedByUploadBlobBytes
				},
			) &&
			blocked[0].BlockedByUploadBlobCount > 0 &&
			latest.BlockedByUploadBlobCount > 0 {
			add(storageHistoryAnomalyDTO{
				Key: "blocked_by_upload_stalled", Severity: "warning",
				Title:        "恢复上传持续阻塞 Blob GC",
				Message:      "连续 3 个每日快照中被 UploadPart 占用的待 GC 数据没有下降，请检查长期未完成的恢复上传。",
				CurrentCount: latest.BlockedByUploadBlobCount,
				CurrentBytes: latest.BlockedByUploadBlobBytes,
				DeltaBytes:   latest.BlockedByUploadBlobBytes - blocked[0].BlockedByUploadBlobBytes,
			})
		}
	}

	if latest.CASHealthSnapshotAvailable {
		drift := latest.MissingMetadataCount +
			latest.RefCountMismatchCount +
			latest.StateMismatchCount +
			latest.SizeMismatchCount +
			latest.KeyHashMismatchCount +
			latest.InvalidStateCount
		if drift > 0 {
			add(storageHistoryAnomalyDTO{
				Key: "cas_metadata_drift", Severity: "bad",
				Title:        "CAS 元数据一致性异常",
				Message:      "每日快照检测到 CAS 引用、状态、大小、Key/Hash 或状态值不一致。",
				CurrentCount: drift,
			})
		}
		if latest.StaleDeletingBlobCount > 0 {
			add(storageHistoryAnomalyDTO{
				Key: "stale_deleting", Severity: "warning",
				Title:        "Deleting Blob 长时间未清理",
				Message:      "存在超过正常 Janitor 窗口仍处于 deleting 状态的 Blob。",
				CurrentCount: latest.StaleDeletingBlobCount,
				CurrentBytes: latest.DeletingBlobMetadataBytes,
			})
		}
	}

	if latest.AnomalySnapshotAvailable && latest.UnclassifiedBytes > 0 {
		add(storageHistoryAnomalyDTO{
			Key: "unclassified_storage", Severity: "warning",
			Title:        "存在未分类 xDrive 存储数据",
			Message:      "存储根目录出现无法归入已知主数据、缓存或临时目录的数据，请检查存储清单。",
			CurrentBytes: latest.UnclassifiedBytes,
		})
	}

	unreferenced := storageHistoryAvailableTail(
		points,
		storageGrowthWindowSamples,
		func(storageHistoryPointDTO) bool { return true },
	)
	if len(unreferenced) == storageGrowthWindowSamples &&
		storageHistoryMonotonicNonDecreasing(
			unreferenced,
			func(point storageHistoryPointDTO) int64 {
				return point.UnreferencedBlobBytes
			},
		) {
		delta := latest.UnreferencedBlobBytes - unreferenced[0].UnreferencedBlobBytes
		relativeFloor := unreferenced[0].UnreferencedBlobBytes / 4
		if relativeFloor < storageUnreferencedGrowthFloor {
			relativeFloor = storageUnreferencedGrowthFloor
		}
		if delta >= relativeFloor && latest.UnreferencedBlobBytes > 0 {
			add(storageHistoryAnomalyDTO{
				Key: "unreferenced_growth", Severity: "warning",
				Title:        "待 GC 数据连续增长",
				Message:      "最近 3 个每日快照中未引用 Blob 持续增长且达到异常阈值，请检查 Janitor 与 GC backlog。",
				CurrentCount: latest.UnreferencedBlobCount,
				CurrentBytes: latest.UnreferencedBlobBytes,
				DeltaBytes:   delta,
			})
		}
	}

	if len(points) >= 2 && latest.AnomalySnapshotAvailable {
		previous := points[len(points)-2]
		if previous.AnomalySnapshotAvailable {
			currentCache := storageHistoryCacheBytes(latest)
			previousCache := storageHistoryCacheBytes(previous)
			delta := currentCache - previousCache
			if delta >= storageCacheGrowthFloor &&
				(previousCache == 0 || delta >= previousCache/2) {
				add(storageHistoryAnomalyDTO{
					Key: "cache_growth_spike", Severity: "warning",
					Title:        "缓存容量单日异常增长",
					Message:      "媒体缩略图、Poster、分析预览或其他缓存单日增长超过阈值，请确认是否符合近期媒体处理量。",
					CurrentBytes: currentCache,
					DeltaBytes:   delta,
				})
			}
		}
	}

	return anomalies
}

func storageWorkloadShares(buckets []storageSizeBucketDTO, totalCount, totalBytes int64) (small64, small256, large16 float64) {
	var small64Count, small256Count, large16Bytes int64
	for _, bucket := range buckets {
		switch bucket.Key {
		case "lt_16_kib", "16_64_kib":
			small64Count += bucket.Count
			small256Count += bucket.Count
		case "64_256_kib":
			small256Count += bucket.Count
		case "16_64_mib", "ge_64_mib":
			large16Bytes += bucket.Bytes
		}
	}
	if totalCount > 0 {
		small64 = float64(small64Count) / float64(totalCount)
		small256 = float64(small256Count) / float64(totalCount)
	}
	if totalBytes > 0 {
		large16 = float64(large16Bytes) / float64(totalBytes)
	}
	return
}

func storageDecision(points []storageHistoryPointDTO) storageDecisionDTO {
	decision := storageDecisionDTO{
		Priority:    "collecting",
		Confidence:  "low",
		WindowHours: int(storageDecisionWindow / time.Hour),
		ReasonCodes: []string{"insufficient_history"},
	}
	if len(points) == 0 {
		return decision
	}

	latest := points[len(points)-1].SlotAt
	cutoff := latest.Add(-storageDecisionWindow)
	start := 0
	for start < len(points) && points[start].SlotAt.Before(cutoff) {
		start++
	}
	window := points[start:]
	decision.SampleCount = len(window)
	if len(window) > 1 {
		decision.SpanHours = window[len(window)-1].SlotAt.Sub(window[0].SlotAt).Hours()
	}
	for _, point := range window {
		decision.AverageSmallLT64CountShare += point.SmallLT64KiBCountShare
		decision.AverageSmallLT256CountShare += point.SmallLT256KiBCountShare
		decision.AverageLargeGE16ByteShare += point.LargeGE16MiBByteShare
		decision.AverageDedupRatio += point.CASDedupRatio
	}
	if len(window) > 0 {
		n := float64(len(window))
		decision.AverageSmallLT64CountShare /= n
		decision.AverageSmallLT256CountShare /= n
		decision.AverageLargeGE16ByteShare /= n
		decision.AverageDedupRatio /= n
	}

	if len(window) < storageDecisionMinSamples || decision.SpanHours < storageDecisionMinSpan.Hours() {
		return decision
	}
	if window[len(window)-1].CASBlobCount == 0 {
		decision.ReasonCodes = []string{"no_cas_workload"}
		return decision
	}

	decision.Confidence = "medium"
	if len(window) >= 7 && decision.SpanHours >= 6*24 {
		decision.Confidence = "high"
	}

	smallPressure := decision.AverageSmallLT64CountShare >= 0.50 ||
		decision.AverageSmallLT256CountShare >= 0.75
	cdcShape := decision.AverageLargeGE16ByteShare >= 0.60 &&
		decision.AverageSmallLT64CountShare < 0.35 &&
		decision.AverageDedupRatio < 1.15

	switch {
	case smallPressure:
		decision.Priority = "small_file_packing"
		decision.ReasonCodes = []string{"small_blob_count_pressure"}
	case cdcShape:
		decision.Priority = "cdc"
		decision.ReasonCodes = []string{"large_blob_byte_dominance", "low_full_file_dedup"}
	default:
		decision.Priority = "observe"
		decision.ReasonCodes = []string{"no_strong_storage_format_signal"}
	}
	return decision
}
