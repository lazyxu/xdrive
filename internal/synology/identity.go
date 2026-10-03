package synology

import "fmt"

// ExternalID is the canonical SourceItem identity for a Synology Photos item.
// Personal and Shared spaces are separate provider namespaces, so the space is
// part of the identity even when DSM happens to reuse a numeric item ID.
func ExternalID(space Space, itemID int64) (string, error) {
	switch space {
	case SpacePersonal, SpaceShared:
	default:
		return "", fmt.Errorf("unsupported Synology Photos space %q", space)
	}
	if itemID <= 0 {
		return "", fmt.Errorf("Synology Photos item id must be positive")
	}
	return fmt.Sprintf("synology:%s:%d", space, itemID), nil
}

// AlbumExternalID is the canonical SourceCollection identity for a Synology
// Photos album. Albums are scoped by Photos space for the same reason as items.
func AlbumExternalID(space Space, albumID int64) (string, error) {
	switch space {
	case SpacePersonal, SpaceShared:
	default:
		return "", fmt.Errorf("unsupported Synology Photos space %q", space)
	}
	if albumID <= 0 {
		return "", fmt.Errorf("Synology Photos album id must be positive")
	}
	return fmt.Sprintf("synology:album:%s:%d", space, albumID), nil
}
