//go:build !linux && !windows

package mount

func cacheUsagePlatform(_ string, opts Options) (CacheStats, error) {
	return CacheStats{Supported: false, Reason: "persistent cache telemetry is unavailable on this platform", LimitBytes: opts.CacheLimitBytes}, nil
}

func releaseReclaimableCachePlatform(root string, opts Options) (CacheReleaseResult, error) {
	stats, err := cacheUsagePlatform(root, opts)
	return CacheReleaseResult{Stats: stats}, err
}
