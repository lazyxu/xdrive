package localpush

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
)

// InventoryCandidate is read-only planning evidence, not an ExternalID,
// SourceItem mutation, accepted SyncRun or remote-delete observation.
// Its path key distinguishes even two paths to the same hard-linked inode.
type InventoryCandidate struct {
	Path                 string     `json:"path"`
	Kind                 string     `json:"kind"`
	Size                 int64      `json:"size"`
	ModifiedAt           *time.Time `json:"modified_at,omitempty"`
	Ignored              bool       `json:"ignored"`
	PathKey              string     `json:"path_key"`
	NativeIdentityKey    string     `json:"native_identity_key"`
	StrongNativeIdentity bool       `json:"strong_native_identity"`
	LinkCount            uint64     `json:"link_count"`
	RenameHintSafe       bool       `json:"rename_hint_safe"`
	NeedsContentHash     bool       `json:"needs_content_hash"`
}

type InventoryCandidateSummary struct {
	Snapshot             InventoryJournalSnapshot `json:"snapshot"`
	Items                int64                    `json:"items"`
	IgnoredItems         int64                    `json:"ignored_items"`
	NeedsContentHash     int64                    `json:"needs_content_hash"`
	MissingInferenceSafe bool                     `json:"missing_inference_safe"`
}

// CandidateFromInventoryItem never assigns a persistent logical SourceItem
// ExternalID. The future reconciler must preserve SourceItem IDs across
// path/native transitions using an explicit, durable alias/checkpoint index.
func CandidateFromInventoryItem(grant RootGrant, item InventoryItem) (InventoryCandidate, error) {
	if grant.SourceID == 0 {
		return InventoryCandidate{}, errors.New("candidate Root Source ID is required")
	}
	if _, err := uuid.Parse(grant.RootID); err != nil {
		return InventoryCandidate{}, fmt.Errorf("invalid candidate Root ID: %w", err)
	}
	path, err := sourcepkg.NormalizeRelativePath(item.Path)
	if err != nil || path != item.Path || path == "" {
		return InventoryCandidate{}, fmt.Errorf("invalid local candidate path %q", item.Path)
	}
	if (item.Kind != "file" && item.Kind != "directory") || item.Size < 0 ||
		(item.Kind == "directory" && item.Size != 0) ||
		item.NativeIdentity == nil || len(item.NativeIdentity.Key) != 64 ||
		item.NativeIdentity.LinkCount == 0 {
		return InventoryCandidate{}, errors.New("local candidate lacks valid native item metadata")
	}
	if _, err := hex.DecodeString(item.NativeIdentity.Key); err != nil {
		return InventoryCandidate{}, errors.New("invalid candidate native identity")
	}
	if item.NativeIdentity.RenameCandidate && (!item.NativeIdentity.Strong ||
		(item.Kind == "file" && item.NativeIdentity.LinkCount != 1)) {
		return InventoryCandidate{}, errors.New("unsafe native rename candidate")
	}
	// This key is *path-specific* even for hard links. Do not use it as an
	// automatic persistent remote SourceItem ID without a reconciliation index.
	digest := sha256.Sum256([]byte("xdrive-local-path-v1\x00" +
		grant.RootID + "\x00" + item.Kind + "\x00" + item.Path))
	return InventoryCandidate{
		Path: path, Kind: item.Kind, Size: item.Size, ModifiedAt: item.ModifiedAt,
		Ignored: item.Ignored, PathKey: hex.EncodeToString(digest[:]),
		NativeIdentityKey:    item.NativeIdentity.Key,
		StrongNativeIdentity: item.NativeIdentity.Strong,
		LinkCount:            item.NativeIdentity.LinkCount,
		RenameHintSafe: item.NativeIdentity.RenameCandidate && item.NativeIdentity.Strong &&
			(item.Kind == "directory" || item.NativeIdentity.LinkCount == 1),
		NeedsContentHash: item.Kind == "file" && !item.Ignored,
	}, nil
}

// StreamInventoryCandidates projects a fully verified immutable Root journal
// into at most 500 candidates per synchronous callback. The read-only caller
// MUST NOT write remote files, SourceItems, SyncRuns or deletion evidence based
// on a callback, since later callbacks/checks may still fail.
func StreamInventoryCandidates(
	ctx context.Context,
	configDir string,
	grant RootGrant,
	batchSize int,
	yield func([]InventoryCandidate) error,
) (InventoryCandidateSummary, error) {
	var empty InventoryCandidateSummary
	if yield == nil {
		return empty, errors.New("candidate callback required")
	}
	var counts InventoryCandidateSummary
	snapshot, err := StreamVerifiedInventoryJournal(ctx, configDir, grant, batchSize,
		func(items []InventoryItem) error {
			batch := make([]InventoryCandidate, 0, len(items))
			for _, item := range items {
				candidate, err := CandidateFromInventoryItem(grant, item)
				if err != nil {
					return err
				}
				counts.Items++
				if candidate.Ignored {
					counts.IgnoredItems++
				}
				if candidate.NeedsContentHash {
					counts.NeedsContentHash++
				}
				batch = append(batch, candidate)
			}
			return yield(batch)
		})
	if err != nil {
		return empty, err
	}
	if counts.Items != snapshot.Items || counts.IgnoredItems > counts.Items ||
		counts.NeedsContentHash > counts.Items {
		return empty, errors.New("candidate totals do not match the verified journal")
	}
	counts.Snapshot = snapshot
	counts.MissingInferenceSafe = false
	return counts, nil
}
