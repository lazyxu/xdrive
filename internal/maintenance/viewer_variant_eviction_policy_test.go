package maintenance

import (
	"strings"
	"testing"
	"time"

	mediapkg "github.com/lazyxu/xdrive/internal/media"
)

func TestViewerVariantEvictionPlannerRetainsActiveAndYoungFiles(t *testing.T) {
	now := time.Date(2026, time.November, 2, 12, 0, 0, 0, time.UTC)
	old := now.Add(-48 * time.Hour)
	active := now.Add(-72 * time.Hour)
	sha := strings.Repeat("a", 64)
	var key []string
	for _, preset := range []mediapkg.ViewerQualityPreset{
		mediapkg.ViewerQualityEconomy, mediapkg.ViewerQualityBalanced,
		mediapkg.ViewerQualityHigh,
	} {
		for _, format := range []string{"webp", "jpeg"} {
			v, _ := mediapkg.ViewerQualityVariantFor(preset, format)
			k, err := mediapkg.ViewerQualityStorageKey(1, 1, sha, v)
			if err != nil || !validManagedViewerVariantStorageKey(k) {
				t.Fatalf("legitimate variant cannot be selected for capacity accounting: %q %v", k, err)
			}
			key = append(key, k)
		}
	}
	entries := []ViewerVariantCacheEntry{
		{StorageKey: key[0], Bytes: 700 << 10, ModifiedAt: old, LastAccessAt: active},
		{StorageKey: key[1], Bytes: 700 << 10, ModifiedAt: old, LastAccessAt: old},
		{StorageKey: key[2], Bytes: 700 << 10, ModifiedAt: old, ReaderActive: true},
		{StorageKey: key[3], Bytes: 700 << 10, ModifiedAt: now},
		{StorageKey: ".xdrive-blobs/sha256/aa/" + sha, Bytes: 1 << 30, ModifiedAt: old},
		{StorageKey: key[4], Bytes: 700 << 10, ModifiedAt: old, WriterActive: true},
	}
	plan, err := PlanViewerVariantEvictions(entries, 1<<20, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Keys) != 2 || plan.Keys[0] != key[0] || plan.Keys[1] != key[1] {
		t.Fatalf("wrong eviction order or active reader safety: %+v", plan)
	}
	if !plan.OverBudget || plan.RemainBytes != 3*(700<<10) {
		t.Fatalf("must disclose budget still exceeded by protected variants: %+v", plan)
	}
}

func TestViewerVariantEvictionPlannerRejectsUntrustedPathsAndBrokenBudget(t *testing.T) {
	now := time.Now().UTC()
	good, _ := mediapkg.ViewerQualityVariantFor(mediapkg.ViewerQualityHigh, "webp")
	key, _ := mediapkg.ViewerQualityStorageKey(9, 1, strings.Repeat("b", 64), good)
	entries := []ViewerVariantCacheEntry{
		{StorageKey: key, Bytes: 1200 << 10, ModifiedAt: now.Add(-48 * time.Hour)},
		{StorageKey: "../" + key, Bytes: 1 << 30, ModifiedAt: now.Add(-48 * time.Hour)},
		{StorageKey: ".xdrive-media/thumbnails/aa/" + strings.Repeat("c", 64) + "-v3-512.jpg", Bytes: 1 << 30},
	}
	plan, err := PlanViewerVariantEvictions(entries, 1<<20, now)
	if err != nil || len(plan.Keys) != 1 || plan.Keys[0] != key || plan.OverBudget {
		t.Fatalf("invalid/unrelated paths changed Viewer budget: %+v %v", plan, err)
	}
	if _, err := PlanViewerVariantEvictions(entries, 0, now); err != ErrViewerVariantCacheBudget {
		t.Fatal("unbounded/zero cache budget accepted")
	}
	if _, err := PlanViewerVariantEvictions(append(entries, entries[0]), 1<<20, now); err != ErrViewerVariantCacheBudget {
		t.Fatal("duplicated cache entry accepted")
	}
}
