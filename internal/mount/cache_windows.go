//go:build windows

package mount

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
)

func cacheUsagePlatform(root string, opts Options) (CacheStats, error) {
	policy := newSyncPolicy(opts)
	stats := CacheStats{Supported: true, LimitBytes: opts.CacheLimitBytes}
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			if errors.Is(walkErr, os.ErrNotExist) {
				return nil
			}
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if policy.excludedPath(rel) {
			return nil
		}
		state, err := availabilityPlatform(path)
		if err != nil || !state.Placeholder {
			return nil
		}
		allocated, err := allocatedSizeWindows(path)
		if err != nil || allocated <= 0 {
			return nil
		}
		stats.UsedBytes += allocated
		stats.CachedFiles++

		pinned := state.Pinned || policy.alwaysLocalPath(rel)
		if pinned {
			stats.PinnedBytes += allocated
			stats.PinnedFiles++
			return nil
		}
		if state.Placeholder && state.InSync {
			stats.ReclaimableBytes += allocated
			stats.ReclaimableFiles++
		}
		return nil
	})
	return stats, err
}

func releaseReclaimableCachePlatform(root string, opts Options) (CacheReleaseResult, error) {
	policy := newSyncPolicy(opts)
	result := CacheReleaseResult{}
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			if errors.Is(walkErr, os.ErrNotExist) {
				return nil
			}
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			result.FailedFiles++
			return nil
		}
		rel = filepath.ToSlash(rel)
		if policy.excludedPath(rel) || policy.alwaysLocalPath(rel) {
			return nil
		}
		state, err := availabilityPlatform(path)
		if err != nil || !state.Placeholder || !state.InSync || state.Pinned {
			return nil
		}
		allocated, allocErr := allocatedSizeWindows(path)
		if allocErr != nil || allocated <= 0 {
			return nil
		}
		if err := setPinPath(path, cfPinStateUnpinned, false); err != nil {
			result.FailedFiles++
			return nil
		}
		task := startDehydrationTransfer(path)
		if err := dehydratePath(path); err != nil {
			finishTransfer(task, err)
			result.FailedFiles++
			return nil
		}
		finishTransfer(task, nil)
		result.ReleasedBytes += allocated
		result.ReleasedFiles++
		return nil
	})
	if err != nil {
		return result, err
	}
	stats, statsErr := cacheUsagePlatform(root, opts)
	result.Stats = stats
	return result, statsErr
}
