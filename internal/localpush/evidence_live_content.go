package localpush

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
)

const maxLocalEvidenceContentCandidates = 64

// LocalEvidenceContentCandidate contains only the hashes from a server
// advisory row. Only the owning native Agent is allowed to materialize these
// hashes into relative local paths from its sealed private journals.
type LocalEvidenceContentCandidate struct {
	PreviousPathKey   string
	CurrentPathKey    string
	NativeIdentityKey string
}

// LocalEvidenceContentDigest is a TEMPORARY digest of bytes independently read
// from the currently authorized native file handle. It proves neither equality
// to a stored xDrive CAS blob nor a SourceRun/rename/deletion permission.
type LocalEvidenceContentDigest struct {
	SHA256 string
	Size   int64
	// CurrentRelativePath comes only from the freshly reverified CURRENT
	// inventory and live native file handle. This short-lived Agent-private
	// value is intentionally excluded from every JSON representation.
	// A future writer MUST independently reverify it at its commit boundary.
	CurrentRelativePath string `json:"-"`
}

type LocalEvidenceContentBatch struct {
	Digests              []LocalEvidenceContentDigest
	HashedBytes          int64
	CloudContentVerified bool
	Authoritative        bool
	MissingInferenceSafe bool
}

func validLocalEvidenceContentCandidates(candidates []LocalEvidenceContentCandidate) bool {
	if len(candidates) == 0 || len(candidates) > maxLocalEvidenceContentCandidates {
		return false
	}
	natives := make(map[string]struct{}, len(candidates))
	previous := make(map[string]struct{}, len(candidates))
	current := make(map[string]struct{}, len(candidates))
	for _, candidate := range candidates {
		if !validEvidenceDigest(candidate.PreviousPathKey) ||
			!validEvidenceDigest(candidate.CurrentPathKey) ||
			!validEvidenceDigest(candidate.NativeIdentityKey) ||
			candidate.PreviousPathKey == strings.Repeat("0", 64) ||
			candidate.CurrentPathKey == strings.Repeat("0", 64) ||
			candidate.NativeIdentityKey == strings.Repeat("0", 64) ||
			candidate.PreviousPathKey == candidate.CurrentPathKey {
			return false
		}
		if _, exists := natives[candidate.NativeIdentityKey]; exists {
			return false
		}
		if _, exists := previous[candidate.PreviousPathKey]; exists {
			return false
		}
		if _, exists := current[candidate.CurrentPathKey]; exists {
			return false
		}
		natives[candidate.NativeIdentityKey] = struct{}{}
		previous[candidate.PreviousPathKey] = struct{}{}
		current[candidate.CurrentPathKey] = struct{}{}
	}
	return true
}

// HashCurrentLocalEvidenceBatch is the strictly read-only, bounded in-memory
// continuation of the owning-Agent Server identity preflight. Both COMPLETE
// sealed journals are streamed (<=500 records per callback) before hashing
// any current original file. Each native key must identify exactly one strong,
// nonignored, single-link regular file on BOTH generations at the claimed
// path keys. A symlink, replaced Root, changed mtime/size/inode, cancellation
// or corrupted/rotated journal invalidates the WHOLE batch.
//
// This intentionally does NOT compare the digest to the Server's current CAS
// File/FileVersion SHA256. It never writes SourceItem/alias/Node/SourceRun
// state, and is never exposed by Agent HTTP/IPC, Desktop or Web.
func HashCurrentLocalEvidenceBatch(
	ctx context.Context, configDir string, grant RootGrant,
	sourceRevision uint64, candidates []LocalEvidenceContentCandidate,
) (LocalEvidenceContentBatch, error) {
	var empty LocalEvidenceContentBatch
	if ctx == nil || sourceRevision == 0 || !validLocalEvidenceContentCandidates(candidates) {
		return empty, errors.New("valid owning Agent evidence candidates and revision required")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	generation, err := LoadLocalReconcileEvidence(ctx, configDir, grant, sourceRevision)
	if err != nil {
		return empty, err
	}
	if generation.Authoritative || generation.MissingInferenceSafe {
		return empty, errors.New("unsafe local advisory generation")
	}

	index := make(map[string]int, len(candidates))
	for i, row := range candidates {
		index[row.NativeIdentityKey] = i
	}
	beforeCount := make([]int, len(candidates))
	afterCount := make([]int, len(candidates))
	currentItems := make([]InventoryItem, len(candidates))
	visit := func(isCurrent bool) func([]InventoryItem) error {
		return func(items []InventoryItem) error {
			for _, item := range items {
				if err := ctx.Err(); err != nil {
					return err
				}
				if item.NativeIdentity == nil {
					return errors.New("sealed inventory missing native identity")
				}
				i, found := index[item.NativeIdentity.Key]
				if !found {
					continue
				}
				identity := item.NativeIdentity
				if item.Kind != "file" || item.Ignored ||
					!identity.Strong || !identity.RenameCandidate ||
					identity.LinkCount != 1 {
					return errors.New("ambiguous or unsafe native file identity")
				}
				key, err := LocalInventoryPathKey(grant, "file", item.Path)
				if err != nil {
					return err
				}
				if isCurrent {
					afterCount[i]++
					if afterCount[i] != 1 || key != candidates[i].CurrentPathKey {
						return errors.New("current file changed or native identity is ambiguous")
					}
					currentItems[i] = item
				} else {
					beforeCount[i]++
					if beforeCount[i] != 1 || key != candidates[i].PreviousPathKey {
						return errors.New("previous file identity conflicts with advisory evidence")
					}
				}
			}
			return nil
		}
	}

	previous, err := StreamVerifiedPreviousInventoryJournal(
		ctx, configDir, grant, DefaultInventoryBatchSize, visit(false))
	if err != nil {
		return empty, err
	}
	if previous.SnapshotName != generation.PreviousSnapshot ||
		previous.SnapshotSHA256 != generation.PreviousSHA256 ||
		previous.Items != generation.PreviousItems {
		return empty, errors.New("previous inventory generation changed")
	}
	current, err := StreamVerifiedInventoryJournal(
		ctx, configDir, grant, DefaultInventoryBatchSize, visit(true))
	if err != nil {
		return empty, err
	}
	if current.SnapshotName != generation.CurrentSnapshot ||
		current.SnapshotSHA256 != generation.CurrentSHA256 ||
		current.Items != generation.CurrentItems {
		return empty, errors.New("current inventory generation changed")
	}
	for i := range candidates {
		if beforeCount[i] != 1 || afterCount[i] != 1 {
			return empty, errors.New("advisory native file is not uniquely present in both generations")
		}
	}
	result := LocalEvidenceContentBatch{
		Digests:              make([]LocalEvidenceContentDigest, 0, len(candidates)),
		CloudContentVerified: false, Authoritative: false, MissingInferenceSafe: false,
	}
	for i, item := range currentItems {
		if err := ctx.Err(); err != nil {
			return empty, err
		}
		digest, err := HashVerifiedInventoryFile(ctx, grant, item, nil)
		if err != nil || digest.NativeIdentityKey != candidates[i].NativeIdentityKey ||
			digest.Path != item.Path || digest.Size != item.Size ||
			!validEvidenceDigest(digest.SHA256) {
			return empty, fmt.Errorf("current native file content is not verified: %w",
				coalesceLocalEvidenceError(err))
		}
		if digest.Size > math.MaxInt64-result.HashedBytes {
			return empty, errors.New("advisory hashed byte total overflow")
		}
		result.HashedBytes += digest.Size
		result.Digests = append(result.Digests, LocalEvidenceContentDigest{
			SHA256: digest.SHA256, Size: digest.Size,
			CurrentRelativePath: item.Path,
		})
	}
	last, err := LoadLocalReconcileEvidence(ctx, configDir, grant, sourceRevision)
	if err != nil {
		return empty, err
	}
	if last.IntegritySHA256 != generation.IntegritySHA256 ||
		last.PreviousSnapshot != generation.PreviousSnapshot ||
		last.CurrentSnapshot != generation.CurrentSnapshot ||
		last.PreviousSHA256 != generation.PreviousSHA256 ||
		last.CurrentSHA256 != generation.CurrentSHA256 {
		return empty, errors.New("private inventory generation rotated while hashing")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	return result, nil
}

func coalesceLocalEvidenceError(err error) error {
	if err != nil {
		return err
	}
	return errors.New("live digest or native identity mismatch")
}
