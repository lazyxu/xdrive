package localpush

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"

	"github.com/google/uuid"
)

// InventoryNativeIdentity describes a filesystem object, not a unique
// SourceItem. Two hard-link paths legitimately point to the same object.
// A strong key is only a rename candidate until the Agent's future
// transactional per-path identity index and snapshot validation are present.
type InventoryNativeIdentity struct {
	Key             string `json:"key"`
	Strong          bool   `json:"strong"`
	LinkCount       uint64 `json:"link_count"`
	RenameCandidate bool   `json:"rename_candidate"`
}

// platformNativeItemIdentity never opens file content and MUST refuse
// observed replacements or unsafe reparse points rather than following them.
type nativeItemObject struct {
	Token     string
	Strong    bool
	LinkCount uint64
}

func readInventoryNativeIdentity(rootID, path string, info os.FileInfo) (*InventoryNativeIdentity, error) {
	if _, err := uuid.Parse(rootID); err != nil {
		return nil, fmt.Errorf("invalid local root ID: %w", err)
	}
	if info == nil || (!info.IsDir() && !info.Mode().IsRegular()) ||
		info.Mode()&os.ModeSymlink != 0 {
		return nil, ErrUnsafeRoot
	}
	object, err := platformNativeItemIdentity(path, info)
	if err != nil {
		return nil, err
	}
	if object.Token == "" || object.LinkCount == 0 {
		return nil, fmt.Errorf("native file identity is incomplete")
	}
	// Keep the platform's volume/device/inode/creation fields private.
	// Root scope makes keys from different approved Sources non-interchangeable.
	digest := sha256.Sum256([]byte("xdrive-native-item-v1\x00" + rootID + "\x00" + object.Token))
	return &InventoryNativeIdentity{
		Key:             hex.EncodeToString(digest[:]),
		Strong:          object.Strong,
		LinkCount:       object.LinkCount,
		RenameCandidate: object.Strong && (info.IsDir() || object.LinkCount == 1),
	}, nil
}
