package mediagroup

import (
	"encoding/hex"
	"strings"
)

// contentCopyCandidate represents one locally indexed original. The content
// hash only disambiguates byte-identical copies of the *same evidence role*;
// it never replaces the embedded Apple/XMP identity used for pairing.
type contentCopyCandidate struct {
	NodeID          uint64
	SHA256          string
	NodeRevision    uint64
	IndexedRevision uint64
}

func contentCopyRepresentative(copies []contentCopyCandidate, preferredID uint64) (uint64, bool) {
	if len(copies) == 0 {
		return 0, false
	}
	if len(copies) == 1 {
		// Preserve the existing valid single-pair semantics for legacy files
		// without a persisted content digest.
		return copies[0].NodeID, copies[0].NodeID != 0
	}

	var digest string
	var firstID uint64
	foundPreferred := false
	for _, copy := range copies {
		sha := strings.ToLower(strings.TrimSpace(copy.SHA256))
		if copy.NodeID == 0 || copy.NodeRevision == 0 ||
			copy.NodeRevision != copy.IndexedRevision || len(sha) != 64 {
			return 0, false
		}
		raw, err := hex.DecodeString(sha)
		if err != nil || len(raw) != 32 {
			return 0, false
		}
		if digest == "" {
			digest = sha
		} else if digest != sha {
			// Different byte sequences with the same embedded identifier
			// remain genuinely ambiguous and must not be paired.
			return 0, false
		}
		if firstID == 0 || copy.NodeID < firstID {
			firstID = copy.NodeID
		}
		if copy.NodeID == preferredID {
			foundPreferred = true
		}
	}
	if foundPreferred {
		return preferredID, true
	}
	return firstID, true
}
