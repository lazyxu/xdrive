package mount

type CacheStats struct {
	Supported        bool   `json:"supported"`
	Reason           string `json:"reason,omitempty"`
	UsedBytes        int64  `json:"used_bytes"`
	LimitBytes       int64  `json:"limit_bytes"`
	ReclaimableBytes int64  `json:"reclaimable_bytes"`
	PinnedBytes      int64  `json:"pinned_bytes"`
	CachedFiles      int    `json:"cached_files"`
	ReclaimableFiles int    `json:"reclaimable_files"`
	PinnedFiles      int    `json:"pinned_files"`
}

type CacheReleaseResult struct {
	Stats         CacheStats `json:"stats"`
	ReleasedBytes int64      `json:"released_bytes"`
	ReleasedFiles int        `json:"released_files"`
	FailedFiles   int        `json:"failed_files"`
}

func CacheUsage(root string, opts Options) (CacheStats, error) {
	return cacheUsagePlatform(root, opts)
}

func ReleaseReclaimableCache(root string, opts Options) (CacheReleaseResult, error) {
	return releaseReclaimableCachePlatform(root, opts)
}
