package media

import (
	"fmt"
	"strings"
)

const (
	VideoPosterEdge          = DefaultThumbnailEdge
	VideoPosterVersion       = 1
	VideoPosterStoragePrefix = ".xdrive-media/posters/"
)

func VideoPosterETag(nodeID, nodeRevision uint64, sha256 string) string {
	sha := strings.ToLower(strings.TrimSpace(sha256))
	if sha != "" {
		return fmt.Sprintf(
			"\"media-video-poster-%s-v%d-%d\"",
			sha,
			VideoPosterVersion,
			VideoPosterEdge,
		)
	}
	return fmt.Sprintf(
		"\"media-video-poster-node-%d-%d-v%d-%d\"",
		nodeID,
		nodeRevision,
		VideoPosterVersion,
		VideoPosterEdge,
	)
}

func VideoPosterStorageKey(nodeID, nodeRevision uint64, sha256 string) string {
	sha := strings.ToLower(strings.TrimSpace(sha256))
	if len(sha) >= 2 {
		return fmt.Sprintf(
			"%s%s/%s-v%d-%d.jpg",
			VideoPosterStoragePrefix,
			sha[:2],
			sha,
			VideoPosterVersion,
			VideoPosterEdge,
		)
	}
	return fmt.Sprintf(
		"%snode/%d-%d-v%d-%d.jpg",
		VideoPosterStoragePrefix,
		nodeID,
		nodeRevision,
		VideoPosterVersion,
		VideoPosterEdge,
	)
}
