package localpush

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
)

var ErrEntryIdentityChanged = errors.New("local file entry changed during identity observation")

// EntryIdentity is a local, path-independent filesystem identity *hint*.
// Fingerprint is not a SHA-256 of file bytes and MUST NOT be used directly as
// SourceItem.ExternalID or as proof that content is unchanged.
type EntryIdentity struct {
	Fingerprint string `json:"fingerprint"`
	Strong      bool   `json:"strong"`
	RenameSafe  bool   `json:"rename_safe"`
	LinkCount   uint64 `json:"link_count"`
}

// ObserveEntryIdentity retains hard-link ambiguity: distinct directory entries
// may share an underlying filesystem identity. Only a single-link file or a
// directory on a filesystem with a reliable creation identity is rename-safe.
// Even then, future SourceItem reconciliation must verify uniqueness and
// the original content/revision before preserving an existing Node identity.
func ObserveEntryIdentity(path string, info os.FileInfo) (EntryIdentity, error) {
	if info == nil || (info.Mode()&os.ModeSymlink != 0) ||
		(!info.IsDir() && !info.Mode().IsRegular()) {
		return EntryIdentity{}, ErrUnsafeRoot
	}
	key, strong, links, err := platformEntryIdentity(path, info)
	if err != nil {
		return EntryIdentity{}, err
	}
	if key == "" || links == 0 {
		return EntryIdentity{}, fmt.Errorf("%w: empty native key or link count", ErrEntryIdentityChanged)
	}
	sum := sha256.Sum256([]byte("xdrive-local-entry-v1\x00" + key))
	return EntryIdentity{
		Fingerprint: hex.EncodeToString(sum[:]),
		Strong:      strong,
		RenameSafe:  strong && (info.IsDir() || links == 1),
		LinkCount:   links,
	}, nil
}
