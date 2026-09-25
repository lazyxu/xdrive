//go:build linux

package mount

func cacheUsagePlatform(_ string, opts Options) (CacheStats, error) {
	return CacheStats{
		Supported:  false,
		Reason:     "Linux FUSE uses per-open temporary files rather than a persistent local hydration cache.",
		LimitBytes: opts.CacheLimitBytes,
	}, nil
}

func releaseReclaimableCachePlatform(root string, opts Options) (CacheReleaseResult, error) {
	stats, err := cacheUsagePlatform(root, opts)
	return CacheReleaseResult{Stats: stats}, err
}
