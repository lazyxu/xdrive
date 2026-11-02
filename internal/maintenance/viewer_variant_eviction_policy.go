package maintenance

import (
	"errors"
	"math"
	"regexp"
	"sort"
	"time"

	mediapkg "github.com/lazyxu/xdrive/internal/media"
)

const ViewerVariantCacheDefaultBudgetBytes int64 = 10 << 30

var ErrViewerVariantCacheBudget = errors.New("invalid Viewer variant cache budget")

// Only fully canonical generated Viewer keys may enter this LRU planner.
// Never hand this planner originals, CAS keys, gallery thumbnails or an
// arbitrary user-supplied path.
var viewerVariantCacheKeyRE = regexp.MustCompile(
	`^\.xdrive-media/thumbnails/(?:[a-f0-9]{2}/[a-f0-9]{64}|node/[1-9][0-9]*-[1-9][0-9]*)-v101-(?:4096-q90\.webp|4096-q93\.jpg|1280-q82-encoder2\.webp|1280-q84-encoder2\.jpg|2048-q88-encoder2\.webp|2048-q90-encoder2\.jpg)$`,
)

// ViewerVariantCacheEntry is observed metadata; the deletion path must
// separately verify file identity and active readers under the cache lock.
type ViewerVariantCacheEntry struct {
	StorageKey      string
	Bytes           int64
	ModifiedAt      time.Time
	LastAccessAt    time.Time
	ReaderActive    bool
	WriterActive    bool
}

type ViewerVariantEvictionPlan struct {
	BudgetBytes   int64
	ObservedBytes int64
	EvictBytes    int64
	RemainBytes   int64
	OverBudget    bool
	Keys          []string
}

// PlanViewerVariantEvictions is pure. It NEVER deletes an object, and it
// deliberately leaves over-budget status true when all safe candidates are
// young (<24h), in use or being written. The file-system executor must
// recheck exact Size/mtime, read lease and DB revision under an advisory lock.
func PlanViewerVariantEvictions(
	entries []ViewerVariantCacheEntry,
	budgetBytes int64,
	now time.Time,
) (ViewerVariantEvictionPlan, error) {
	var plan ViewerVariantEvictionPlan
	if budgetBytes < 1<<20 || budgetBytes > 1<<40 || now.IsZero() {
		return plan, ErrViewerVariantCacheBudget
	}
	plan.BudgetBytes = budgetBytes
	eligible := make([]ViewerVariantCacheEntry, 0, len(entries))
	seen := make(map[string]bool, len(entries))
	for _, entry := range entries {
		if !viewerVariantCacheKeyRE.MatchString(entry.StorageKey) {
			continue
		}
		if seen[entry.StorageKey] || entry.Bytes < 0 ||
			entry.Bytes > math.MaxInt64-plan.ObservedBytes {
			return ViewerVariantEvictionPlan{}, ErrViewerVariantCacheBudget
		}
		seen[entry.StorageKey] = true
		plan.ObservedBytes += entry.Bytes
		if entry.Bytes == 0 || entry.ModifiedAt.IsZero() ||
			entry.ModifiedAt.After(now.Add(-MediaThumbnailGCMinAge)) ||
			entry.ReaderActive || entry.WriterActive {
			continue
		}
		eligible = append(eligible, entry)
	}
	plan.RemainBytes = plan.ObservedBytes
	if plan.ObservedBytes <= budgetBytes {
		return plan, nil
	}
	sort.Slice(eligible, func(i, j int) bool {
		a, b := eligible[i].LastAccessAt, eligible[j].LastAccessAt
		if a.IsZero() {
			a = eligible[i].ModifiedAt
		}
		if b.IsZero() {
			b = eligible[j].ModifiedAt
		}
		if !a.Equal(b) {
			return a.Before(b)
		}
		return eligible[i].StorageKey < eligible[j].StorageKey
	})
	for _, entry := range eligible {
		if plan.RemainBytes <= budgetBytes {
			break
		}
		plan.Keys = append(plan.Keys, entry.StorageKey)
		plan.EvictBytes += entry.Bytes
		plan.RemainBytes -= entry.Bytes
	}
	plan.OverBudget = plan.RemainBytes > budgetBytes
	return plan, nil
}

// This function exists to ensure the eviction candidates are exactly the
// same six byte encodings as the permitted Viewer variant policy.
func validManagedViewerVariantStorageKey(key string) bool {
	if !viewerVariantCacheKeyRE.MatchString(key) {
		return false
	}
	for _, preset := range []mediapkg.ViewerQualityPreset{
		mediapkg.ViewerQualityEconomy, mediapkg.ViewerQualityBalanced,
		mediapkg.ViewerQualityHigh,
	} {
		for _, format := range []string{"webp", "jpeg"} {
			variant, err := mediapkg.ViewerQualityVariantFor(preset, format)
			if err != nil {
				continue
			}
			expected, err := mediapkg.ViewerQualityStorageKey(1, 1,
				"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", variant)
			if err == nil {
				// Key's prefix varies by source; the fixed suffix is derived
				// only from vetted codec, max edge and quality.
				suffix := expected[len(mediapkg.ThumbnailStoragePrefix)+3+64:]
				if len(suffix) <= len(key) && key[len(key)-len(suffix):] == suffix {
					return true
				}
			}
		}
	}
	return false
}
