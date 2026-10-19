package localpush

import (
	"context"
	"errors"
)

// NativeHeldCurrentOriginal is an Agent-local, ephemeral read observation.
// It contains sensitive Root-scoped identity. NONE of its members are JSON
// serializable, and it conveys no distributed commit, cancel or upload right.
type NativeHeldCurrentOriginal struct {
	SourceID       uint64 `json:"-"`
	DeviceID       string `json:"-"`
	RootID         string `json:"-"`
	RelativePath   string `json:"-"`
	PathKey        string `json:"-"`
	SnapshotSHA256 string `json:"-"`
	ContentSHA256  string `json:"-"`
	NativeKey      string `json:"-"`
	Size           int64  `json:"-"`
}

const nativeHeldCurrentMaxBytes = int64(64 << 20)

// WithHeldCurrentOriginalReadCheckpoint is a private read-only native witness,
// NOT an executable Push/SourceRun, HTTP endpoint or Server write authorization.
// It reads exactly one strong, single-link CURRENT file under a securely opened
// Linux/Windows native descriptor, holds that descriptor THROUGH checkpoint,
// and re-hashes the SAME descriptor afterwards. Persisted Root and the exact
// CURRENT journal are checked before AND after. No bytes or path are exported.
//
// The checkpoint is for a read-only correlated observation. It MUST NOT write
// remote CAS/SQL or retire a credential: an OS file handle alone does not
// provide cross-machine atomic commit/cancel exclusion, nor defeat A-B-A writes.
func WithHeldCurrentOriginalReadCheckpoint(
	ctx context.Context, configDir string, grant RootGrant,
	expectedSnapshotSHA256, relativePath, expectedContentSHA256 string,
	expectedSize int64,
	checkpoint func(context.Context, NativeHeldCurrentOriginal) error,
) (NativeHeldCurrentOriginal, error) {
	return withHeldCurrentOriginalCheckpoint(ctx, configDir, grant,
		expectedSnapshotSHA256, relativePath, expectedContentSHA256,
		expectedSize, checkpoint)
}

// WithHeldCurrentOriginalFirstLeafCommitWindow explicitly names the one
// Agent-private exception to the READ-ONLY checkpoint contract: a caller may
// perform the exact authenticated first-leaf HTTP operation while the original
// strongly identified native fd is still held and independently post-hashed.
// This operation does NOT supply remote atomic COMMIT/cancel exclusion, grant
// Server mutation authority, prove a finished SourceRun, or authorize key
// retirement. Keep ALL product entrypoints disabled until G2c has durable
// terminal outcome/cancellation proof and installed-device acceptance.
func WithHeldCurrentOriginalFirstLeafCommitWindow(
	ctx context.Context, configDir string, grant RootGrant,
	expectedSnapshotSHA256, relativePath, expectedContentSHA256 string,
	expectedSize int64,
	commit func(context.Context, NativeHeldCurrentOriginal) error,
) (NativeHeldCurrentOriginal, error) {
	return withHeldCurrentOriginalCheckpoint(ctx, configDir, grant,
		expectedSnapshotSHA256, relativePath, expectedContentSHA256,
		expectedSize, commit)
}

// withHeldCurrentOriginalCheckpoint is the shared native descriptor verifier.
// It is not an admission gate; the specialized Agent caller must separately
// prove Owner/Device/Root/Source/revision and exact keyed Stage/Operation SQL.
func withHeldCurrentOriginalCheckpoint(
	ctx context.Context, configDir string, grant RootGrant,
	expectedSnapshotSHA256, relativePath, expectedContentSHA256 string,
	expectedSize int64,
	checkpoint func(context.Context, NativeHeldCurrentOriginal) error,
) (NativeHeldCurrentOriginal, error) {
	var empty NativeHeldCurrentOriginal
	deny := func(err error) (NativeHeldCurrentOriginal, error) {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return empty, err
		}
		return empty, errors.New("owning native original unavailable")
	}
	if ctx == nil || configDir == "" || relativePath == "" || checkpoint == nil ||
		grant.SourceID == 0 || !grant.StrongIdentity ||
		!validEvidenceDigest(expectedSnapshotSHA256) ||
		!validEvidenceDigest(expectedContentSHA256) ||
		expectedSize < 0 || expectedSize > nativeHeldCurrentMaxBytes {
		return deny(nil)
	}
	if err := ctx.Err(); err != nil {
		return deny(err)
	}
	stored, err := LoadRootGrant(configDir, grant.Server, grant.Account, grant.RootID)
	if err != nil || !sameLocalIdentityRoot(stored, grant) {
		return deny(err)
	}
	pathKey, err := LocalInventoryPathKey(grant, "file", relativePath)
	if err != nil {
		return deny(err)
	}
	before, err := VerifyInventoryJournal(ctx, configDir, grant)
	if err != nil || before.MissingInferenceSafe ||
		before.SnapshotSHA256 != expectedSnapshotSHA256 {
		return deny(err)
	}
	// Derive the item from the WHOLE already-verified CURRENT journal. No
	// caller-created InventoryItem can skip the strong native identity check.
	var item InventoryItem
	matches := 0
	snapshot, err := StreamVerifiedInventoryJournal(
		ctx, configDir, grant, DefaultInventoryBatchSize,
		func(rows []InventoryItem) error {
			for _, row := range rows {
				if row.Path != relativePath {
					continue
				}
				matches++
				if matches != 1 {
					return errors.New("duplicate CURRENT native path")
				}
				item = row
			}
			return ctx.Err()
		},
	)
	if err != nil || matches != 1 ||
		snapshot.SnapshotSHA256 != before.SnapshotSHA256 ||
		snapshot.SnapshotName != before.SnapshotName ||
		item.Kind != "file" || item.Ignored || item.Size != expectedSize ||
		item.NativeIdentity == nil || !item.NativeIdentity.Strong ||
		item.NativeIdentity.LinkCount != 1 || !item.NativeIdentity.RenameCandidate {
		return deny(err)
	}
	checkpointCalls := 0
	digest, err := streamVerifiedInventoryFileBytesWithHeldCheckpoint(
		ctx, grant, item, nil, nil,
		func(heldCtx context.Context, current VerifiedInventoryFileDigest) error {
			if heldCtx.Err() != nil || current.Path != relativePath ||
				current.Size != expectedSize ||
				current.SHA256 != expectedContentSHA256 ||
				current.NativeIdentityKey != item.NativeIdentity.Key {
				return errors.New("native file bytes drifted")
			}
			// This occurs while the verified original file fd is STILL open.
			saved, loadErr := LoadRootGrant(configDir, grant.Server, grant.Account, grant.RootID)
			if loadErr != nil || !sameLocalIdentityRoot(saved, grant) {
				return errors.New("owning device Root changed")
			}
			checkpointCalls++
			return checkpoint(heldCtx, NativeHeldCurrentOriginal{
				SourceID: grant.SourceID, DeviceID: grant.DeviceID,
				RootID: grant.RootID, RelativePath: relativePath,
				PathKey: pathKey, SnapshotSHA256: expectedSnapshotSHA256,
				ContentSHA256: current.SHA256,
				NativeKey:     current.NativeIdentityKey, Size: current.Size,
			})
		},
	)
	if err != nil || checkpointCalls != 1 ||
		digest.Path != relativePath || digest.SHA256 != expectedContentSHA256 ||
		digest.Size != expectedSize || digest.NativeIdentityKey != item.NativeIdentity.Key {
		return deny(err)
	}
	after, err := VerifyInventoryJournal(ctx, configDir, grant)
	if err != nil || after.MissingInferenceSafe ||
		after.SnapshotName != before.SnapshotName ||
		after.SnapshotSHA256 != before.SnapshotSHA256 ||
		after.Items != before.Items || after.Bytes != before.Bytes {
		return deny(err)
	}
	saved, err := LoadRootGrant(configDir, grant.Server, grant.Account, grant.RootID)
	if err != nil || !sameLocalIdentityRoot(saved, grant) || ctx.Err() != nil {
		return deny(err)
	}
	return NativeHeldCurrentOriginal{
		SourceID: grant.SourceID, DeviceID: grant.DeviceID,
		RootID: grant.RootID, RelativePath: relativePath,
		PathKey: pathKey, SnapshotSHA256: expectedSnapshotSHA256,
		ContentSHA256: digest.SHA256,
		NativeKey:     digest.NativeIdentityKey, Size: digest.Size,
	}, nil
}
