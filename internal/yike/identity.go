package yike

import (
	"fmt"
	"strings"
)

// ExternalID is the canonical SourceItem identity for a Yike file. FSID is
// only unique inside the upstream owner namespace, so both owner UK and FSID
// are required for shared-album content.
func ExternalID(ownerUK, fsid int64) (string, error) {
	if ownerUK <= 0 || fsid <= 0 {
		return "", fmt.Errorf("owner uk and fsid must be positive")
	}
	return fmt.Sprintf("yike:%d:%d", ownerUK, fsid), nil
}

// AlbumExternalID is the canonical SourceCollection identity for a Yike album.
func AlbumExternalID(albumID string) (string, error) {
	albumID = strings.TrimSpace(albumID)
	if albumID == "" {
		return "", fmt.Errorf("album_id is empty")
	}
	value := "yike:album:" + albumID
	if len([]byte(value)) > 512 {
		return "", fmt.Errorf("album_id is too long")
	}
	return value, nil
}
