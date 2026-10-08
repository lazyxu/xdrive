package api

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/maintenance"
)

func TestStorageDecisionPrefersSmallFilePacking(t *testing.T) {
	base := time.Date(2026, 9, 25, 0, 0, 0, 0, time.UTC)
	points := make([]storageHistoryPointDTO, 0, 5)
	for i := 0; i < 5; i++ {
		points = append(points, storageHistoryPointDTO{
			SlotAt:                  base.Add(time.Duration(i) * 24 * time.Hour),
			CASBlobCount:            1000,
			CASPhysicalBytes:        1 << 30,
			CASDedupRatio:           1.3,
			SmallLT64KiBCountShare:  0.62,
			SmallLT256KiBCountShare: 0.81,
			LargeGE16MiBByteShare:   0.25,
		})
	}
	decision := storageDecision(points)
	if decision.Priority != "small_file_packing" {
		t.Fatalf("priority=%q want small_file_packing: %+v", decision.Priority, decision)
	}
	if decision.Confidence != "medium" {
		t.Fatalf("confidence=%q want medium", decision.Confidence)
	}
}

func TestStorageDecisionPrefersCDCEvaluation(t *testing.T) {
	base := time.Date(2026, 9, 25, 0, 0, 0, 0, time.UTC)
	points := make([]storageHistoryPointDTO, 0, 5)
	for i := 0; i < 5; i++ {
		points = append(points, storageHistoryPointDTO{
			SlotAt:                  base.Add(time.Duration(i) * 24 * time.Hour),
			CASBlobCount:            400,
			CASPhysicalBytes:        8 << 30,
			CASDedupRatio:           1.07,
			SmallLT64KiBCountShare:  0.12,
			SmallLT256KiBCountShare: 0.20,
			LargeGE16MiBByteShare:   0.78,
		})
	}
	decision := storageDecision(points)
	if decision.Priority != "cdc" {
		t.Fatalf("priority=%q want cdc: %+v", decision.Priority, decision)
	}
}

func TestStorageDecisionWaitsForHistory(t *testing.T) {
	base := time.Date(2026, 9, 25, 0, 0, 0, 0, time.UTC)
	points := []storageHistoryPointDTO{
		{SlotAt: base, CASBlobCount: 100, SmallLT64KiBCountShare: 0.9},
		{SlotAt: base.Add(24 * time.Hour), CASBlobCount: 100, SmallLT64KiBCountShare: 0.9},
		{SlotAt: base.Add(48 * time.Hour), CASBlobCount: 100, SmallLT64KiBCountShare: 0.9},
	}
	decision := storageDecision(points)
	if decision.Priority != "collecting" {
		t.Fatalf("priority=%q want collecting", decision.Priority)
	}
}

func TestStorageWorkloadShares(t *testing.T) {
	buckets := []storageSizeBucketDTO{
		{Key: "lt_16_kib", Count: 40, Bytes: 100},
		{Key: "16_64_kib", Count: 20, Bytes: 200},
		{Key: "64_256_kib", Count: 10, Bytes: 300},
		{Key: "16_64_mib", Count: 2, Bytes: 4000},
		{Key: "ge_64_mib", Count: 1, Bytes: 5000},
	}
	small64, small256, large16 := storageWorkloadShares(buckets, 100, 10000)
	if small64 != 0.60 {
		t.Fatalf("small64=%f want 0.60", small64)
	}
	if small256 != 0.70 {
		t.Fatalf("small256=%f want 0.70", small256)
	}
	if large16 != 0.90 {
		t.Fatalf("large16=%f want 0.90", large16)
	}
}

func TestStorageSampleIntervalIsDaily(t *testing.T) {
	if storageSampleInterval != 24*time.Hour {
		t.Fatalf("storageSampleInterval=%s want=24h", storageSampleInterval)
	}
	base := time.Date(2026, 10, 7, 19, 48, 0, 0, time.UTC)
	if got, want := base.Truncate(storageSampleInterval), time.Date(2026, 10, 7, 0, 0, 0, 0, time.UTC); !got.Equal(want) {
		t.Fatalf("daily slot=%s want=%s", got, want)
	}
}

func TestStorageHistorySnapshotProjectsPersistedAnomalyInventory(t *testing.T) {
	stats := storageStatsDTO{
		PendingGC: &storagePendingGCSnapshotDTO{
			AwaitingGCBlobCount:           2,
			AwaitingGCBlobBytes:           20,
			BlockedByUploadBlobCount:      3,
			BlockedByUploadBlobBytes:      30,
			PhysicalMissingBlobCount:      4,
			PhysicalMissingMetadataBytes:  40,
			MetadataInconsistentBlobCount: 5,
			MetadataInconsistentBlobBytes: 50,
			DeletingBlobCount:             9,
			DeletingBlobMetadataBytes:     90,
		},
		CASHealth: &maintenance.CASHealthReport{
			DeletingBlobs:      9,
			StaleDeletingBlobs: 2,
			MissingMetadata:    1,
			RefCountMismatches: 3,
			StateMismatches:    4,
			SizeMismatches:     5,
			KeyHashMismatches:  6,
			InvalidStates:      7,
		},
		UploadStaging: &uploadStagingStatsDTO{
			OrphanBytes:      11,
			ReclaimableBytes: 17,
		},
		Inventory: &storageInventoryDTO{
			Items: []storageInventoryItemDTO{
				{Key: "media_thumbnail", Bytes: 21},
				{Key: "video_poster", Bytes: 22},
				{Key: "analysis_preview", Bytes: 23},
				{Key: "preview_cache", Bytes: 24},
				{Key: "video_transcode", Bytes: 25},
				{Key: "write_temp", Bytes: 26},
				{Key: "readiness_temp", Bytes: 27},
			},
			UnclassifiedBytes: 28,
		},
	}
	raw, err := json.Marshal(stats)
	if err != nil {
		t.Fatal(err)
	}
	got, ok := storageHistorySnapshot(string(raw))
	if !ok || got.Inventory == nil || got.UploadStaging == nil {
		t.Fatalf("snapshot not projected: ok=%v snapshot=%+v", ok, got)
	}
	if got.PendingGC == nil ||
		got.PendingGC.BlockedByUploadBlobCount != 3 ||
		got.PendingGC.PhysicalMissingBlobCount != 4 ||
		got.PendingGC.DeletingBlobMetadataBytes != 90 {
		t.Fatalf("pending gc=%+v", got.PendingGC)
	}
	if got.CASHealth == nil ||
		got.CASHealth.DeletingBlobs != 9 ||
		got.CASHealth.StaleDeletingBlobs != 2 ||
		got.CASHealth.RefCountMismatches != 3 {
		t.Fatalf("cas health=%+v", got.CASHealth)
	}
	if got.UploadStaging.OrphanBytes != 11 || got.UploadStaging.ReclaimableBytes != 17 {
		t.Fatalf("staging=%+v", got.UploadStaging)
	}
	if got.Inventory.UnclassifiedBytes != 28 {
		t.Fatalf("inventory=%+v", got.Inventory)
	}
	if got := storageHistoryInventoryBytes(got.Inventory, "analysis_preview"); got != 23 {
		t.Fatalf("analysis preview bytes=%d want=23", got)
	}
	if got := storageHistoryInventoryBytes(got.Inventory, "missing"); got != 0 {
		t.Fatalf("missing inventory bytes=%d want=0", got)
	}
}

func TestStorageHistorySnapshotToleratesLegacyRows(t *testing.T) {
	for _, raw := range []string{"", "{}", "{not-json"} {
		if _, ok := storageHistorySnapshot(raw); ok {
			t.Fatalf("legacy snapshot %q unexpectedly available", raw)
		}
	}
}

func storageHistoryAnomalyKeys(values []storageHistoryAnomalyDTO) map[string]bool {
	out := make(map[string]bool, len(values))
	for _, value := range values {
		out[value.Key] = true
	}
	return out
}

func TestStorageHistoryAnomaliesDetectsIntegrityAndFreshnessIssues(t *testing.T) {
	now := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	points := []storageHistoryPointDTO{{
		SlotAt:                            now.Add(-48 * time.Hour),
		CapturedAt:                        now.Add(-48 * time.Hour),
		AnomalySnapshotAvailable:          true,
		GCClassificationSnapshotAvailable: true,
		CASHealthSnapshotAvailable:        true,
		PhysicalMissingBlobCount:          2,
		PhysicalMissingMetadataBytes:      20,
		MetadataInconsistentBlobCount:     3,
		MetadataInconsistentBlobBytes:     30,
		StaleDeletingBlobCount:            4,
		DeletingBlobMetadataBytes:         40,
		MissingMetadataCount:              1,
		RefCountMismatchCount:             2,
		UnclassifiedBytes:                 50,
	}}

	anomalies := storageHistoryAnomalies(points, now)
	keys := storageHistoryAnomalyKeys(anomalies)
	for _, key := range []string{
		"snapshot_stale",
		"physical_missing",
		"metadata_inconsistent",
		"cas_metadata_drift",
		"stale_deleting",
		"unclassified_storage",
	} {
		if !keys[key] {
			t.Fatalf("missing anomaly %q: %+v", key, anomalies)
		}
	}
}

func TestStorageHistoryAnomaliesDetectsStalledAndGrowingBacklogs(t *testing.T) {
	now := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	points := make([]storageHistoryPointDTO, 0, 3)
	for index := 0; index < 3; index++ {
		points = append(points, storageHistoryPointDTO{
			SlotAt:                            now.Add(time.Duration(index-2) * 24 * time.Hour),
			CapturedAt:                        now.Add(time.Duration(index-2) * 24 * time.Hour),
			AnomalySnapshotAvailable:          true,
			GCClassificationSnapshotAvailable: true,
			BlockedByUploadBlobCount:          int64(2 + index),
			BlockedByUploadBlobBytes:          int64(128+index*16) << 20,
			UnreferencedBlobCount:             int64(10 + index),
			UnreferencedBlobBytes:             int64(index) * (128 << 20),
			MediaThumbnailBytes:               1 << 30,
		})
	}
	points[1].MediaThumbnailBytes = 2 << 30
	points[2].MediaThumbnailBytes = 16 << 30

	anomalies := storageHistoryAnomalies(points, now)
	keys := storageHistoryAnomalyKeys(anomalies)
	for _, key := range []string{
		"blocked_by_upload_stalled",
		"unreferenced_growth",
		"cache_growth_spike",
	} {
		if !keys[key] {
			t.Fatalf("missing anomaly %q: %+v", key, anomalies)
		}
	}
}

func TestStorageHistoryAnomaliesDoNotTreatLegacyUnavailableFieldsAsZero(t *testing.T) {
	now := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	points := []storageHistoryPointDTO{{
		SlotAt:                now.Add(-time.Hour),
		CapturedAt:            now.Add(-time.Hour),
		UnreferencedBlobBytes: 10,
	}}
	anomalies := storageHistoryAnomalies(points, now)
	if len(anomalies) != 0 {
		t.Fatalf("legacy point produced false anomalies: %+v", anomalies)
	}

	missing := storageHistoryAnomalies(nil, now)
	if len(missing) != 1 || missing[0].Key != "snapshot_missing" {
		t.Fatalf("missing history anomaly=%+v", missing)
	}
}
