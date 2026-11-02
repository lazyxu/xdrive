package maintenance

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

type ViewerVariantCacheInventory struct {
	Plan ViewerVariantEvictionPlan
	Entries []ViewerVariantCacheEntry
}

// Inspect generated Viewer variants only; no original/CAS or 512px wall files.
// Until durable last-access metadata is available, age is a conservative
// mtime proxy, not a claim of accurate user-visit LRU ordering.
func ScanViewerVariantCache(ctx context.Context, root string, budget int64, now time.Time) (ViewerVariantCacheInventory, error) {
	var result ViewerVariantCacheInventory
	if ctx == nil { ctx = context.Background() }
	if err := ctx.Err(); err != nil { return result, err }
	if budget < 1<<20 || budget > 1<<40 || now.IsZero() {
		return result, ErrViewerVariantCacheBudget
	}
	absolute, thumbnailRoot, realRoot, exists, err := thumbnailGCRoot(root)
	if err != nil { return result, err }
	if !exists {
		result.Plan, err = PlanViewerVariantEvictions(nil, budget, now)
		return result, err
	}
	err = filepath.WalkDir(thumbnailRoot, func(path string, entry os.DirEntry, walkErr error) error {
		if errors.Is(walkErr, os.ErrNotExist) { return nil }
		if walkErr != nil { return walkErr }
		if err := ctx.Err(); err != nil { return err }
		if entry.IsDir() || entry.Type()&os.ModeSymlink != 0 { return nil }
		relative, err := filepath.Rel(absolute, path)
		if err != nil { return err }
		key := filepath.ToSlash(relative)
		if !validManagedViewerVariantStorageKey(key) { return nil }
		// Validate nested directories and symlink containment, not just the
		// lexically normalized key.
		if _, err := thumbnailGCFilePath(absolute, thumbnailRoot, realRoot, key); err != nil {
			return fmt.Errorf("Viewer cache path is unsafe: %w", err)
		}
		stat, err := entry.Info()
		if errors.Is(err, os.ErrNotExist) { return nil }
		if err != nil { return err }
		if !stat.Mode().IsRegular() { return nil }
		result.Entries = append(result.Entries, ViewerVariantCacheEntry{
			StorageKey: key, Bytes: stat.Size(), ModifiedAt: stat.ModTime().UTC(),
		})
		return nil
	})
	if err != nil { return ViewerVariantCacheInventory{}, err }
	result.Plan, err = PlanViewerVariantEvictions(result.Entries, budget, now)
	if err != nil { return ViewerVariantCacheInventory{}, err }
	return result, nil
}

type ViewerVariantCacheApplyResult struct {
	Plan ViewerVariantEvictionPlan
	DeletedFiles int64
	DeletedBytes int64
	SkippedFiles int64
	RemainingBytes int64
	OverBudget bool
	DeletedKeys []string
}

// Requires BOTH the exclusive PostgreSQL media-cache writer lock and the
// exclusive Viewer read-lifecycle lock held by the API caller for the entire
// function call. Do not expose this function directly to an HTTP endpoint.
// Files are re-statted, validated inside the cache root, and never followed
// through a symlink. Corrupt or replaced files are skipped.
func EvictViewerVariantCacheAssumingExclusiveLease(ctx context.Context, root string, budget int64, now time.Time) (ViewerVariantCacheApplyResult, error) {
	var report ViewerVariantCacheApplyResult
	inventory, err := ScanViewerVariantCache(ctx, root, budget, now)
	if err != nil { return report, err }
	report.Plan = inventory.Plan
	report.RemainingBytes = inventory.Plan.ObservedBytes
	if len(inventory.Plan.Keys) == 0 {
		report.OverBudget = report.RemainingBytes > budget
		return report, nil
	}
	absolute, thumbnailRoot, realRoot, exists, err := thumbnailGCRoot(root)
	if err != nil { return report, err }
	if !exists { return report, errors.New("Viewer cache root disappeared") }
	observed := make(map[string]ViewerVariantCacheEntry, len(inventory.Entries))
	for _, entry := range inventory.Entries { observed[entry.StorageKey] = entry }
	cutoff := now.Add(-MediaThumbnailGCMinAge)
	for _, key := range inventory.Plan.Keys {
		if err := ctx.Err(); err != nil { return report, err }
		record, ok := observed[key]
		if !ok || !validManagedViewerVariantStorageKey(key) {
			return report, errors.New("Viewer eviction encountered unknown cache identity")
		}
		path, err := thumbnailGCFilePath(absolute, thumbnailRoot, realRoot, key)
		if errors.Is(err, os.ErrNotExist) { report.SkippedFiles++; continue }
		if err != nil { return report, err }
		stat, err := os.Lstat(path)
		if errors.Is(err, os.ErrNotExist) { report.SkippedFiles++; continue }
		if err != nil { return report, err }
		if !stat.Mode().IsRegular() || stat.Size() != record.Bytes ||
			!stat.ModTime().UTC().Equal(record.ModifiedAt) ||
			stat.ModTime().UTC().After(cutoff) {
			report.SkippedFiles++
			continue
		}
		if err := os.Remove(path); err != nil {
			if errors.Is(err, os.ErrNotExist) { report.SkippedFiles++; continue }
			return report, err
		}
		report.DeletedFiles++
		report.DeletedBytes += record.Bytes
		report.RemainingBytes -= record.Bytes
		report.DeletedKeys = append(report.DeletedKeys, key)
	}
	report.OverBudget = report.RemainingBytes > budget
	return report, nil
}
