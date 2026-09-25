package api

import (
	"testing"
	"time"
)

func TestStorageDecisionPrefersSmallFilePacking(t *testing.T) {
	base := time.Date(2026, 9, 25, 0, 0, 0, 0, time.UTC)
	points := make([]storageHistoryPointDTO, 0, 5)
	for i := 0; i < 5; i++ {
		points = append(points, storageHistoryPointDTO{
			SlotAt:                  base.Add(time.Duration(i) * 6 * time.Hour),
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
			SlotAt:                  base.Add(time.Duration(i) * 6 * time.Hour),
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
		{SlotAt: base.Add(6 * time.Hour), CASBlobCount: 100, SmallLT64KiBCountShare: 0.9},
		{SlotAt: base.Add(12 * time.Hour), CASBlobCount: 100, SmallLT64KiBCountShare: 0.9},
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
