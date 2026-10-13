package localpush

import (
	"context"
	"errors"
	"io"
)

// LocalStagedOriginal records only a *completed* native temporary byte copy.
// All fields deliberately remain private under JSON. A completed local copy
// is NOT a Server upload, CAS reference, durable job or Source authorization.
type LocalStagedOriginal struct {
	SHA256         string `json:"-"`
	Size           int64  `json:"-"`
	SnapshotSHA256 string `json:"-"`
}

// StreamCurrentInventoryFileToStaging copies actual Root-scoped source bytes
// into an Agent-private, DISCARDABLE staging writer using <=256KiB buffers.
// The caller MUST NOT pass a final CAS writer or publish any bytes until the
// entire operation returns successfully and independent Server authorization,
// content admission, durable commit and recovery are implemented.
//
// The file comes from a fully verified CURRENT journal, not a caller-created
// InventoryItem. Exact persisted Root approval, unique strong/single-link
// identity, declared expected native content SHA256 and complete journal
// generation are rechecked after the physical copy. A failed copy can leave
// partial bytes in staging: it never returns a positive content result.
// This single-file helper does not have a scalable 100k-file lookup index;
// the future executor must batch journal membership for large workloads.
func StreamCurrentInventoryFileToStaging(
	ctx context.Context, configDir string, grant RootGrant,
	expectedSnapshotSHA256, relativePath, expectedContentSHA256 string,
	staging io.Writer, onProgress func(done, total int64) error,
) (LocalStagedOriginal, error) {
	var empty LocalStagedOriginal
	if ctx == nil || staging == nil || relativePath == "" ||
		!validEvidenceDigest(expectedSnapshotSHA256) ||
		!validEvidenceDigest(expectedContentSHA256) {
		return empty, errors.New("invalid private native staging inputs")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	persisted, err := LoadRootGrant(configDir, grant.Server, grant.Account, grant.RootID)
	if err != nil || !sameLocalIdentityRoot(persisted, grant) {
		return empty, errors.New("owning native Root authorization unavailable")
	}

	var item InventoryItem
	matched := 0
	snapshot, err := StreamVerifiedInventoryJournal(
		ctx, configDir, grant, DefaultInventoryBatchSize,
		func(batch []InventoryItem) error {
			for _, entry := range batch {
				if entry.Path != relativePath {
					continue
				}
				matched++
				if matched != 1 {
					return errors.New("ambiguous private CURRENT inventory path")
				}
				item = entry
			}
			return ctx.Err()
		})
	if err != nil {
		return empty, err
	}
	if snapshot.SnapshotSHA256 != expectedSnapshotSHA256 ||
		snapshot.MissingInferenceSafe || matched != 1 ||
		item.Kind != "file" || item.Ignored ||
		item.NativeIdentity == nil || !item.NativeIdentity.Strong ||
		item.NativeIdentity.LinkCount != 1 {
		return empty, errors.New("CURRENT inventory is not a unique authorized file")
	}
	digest, err := streamVerifiedInventoryFileBytes(ctx, grant, item, staging, onProgress)
	if err != nil {
		return empty, err
	}
	if digest.Path != relativePath ||
		digest.NativeIdentityKey != item.NativeIdentity.Key ||
		digest.Size != item.Size || digest.SHA256 != expectedContentSHA256 {
		return empty, errors.New("original bytes differ from expected native content")
	}
	persisted, err = LoadRootGrant(configDir, grant.Server, grant.Account, grant.RootID)
	if err != nil || !sameLocalIdentityRoot(persisted, grant) {
		return empty, errors.New("native Root authorization changed during staging")
	}
	current, err := VerifyInventoryJournal(ctx, configDir, grant)
	if err != nil || current.SnapshotSHA256 != snapshot.SnapshotSHA256 ||
		current.SnapshotName != snapshot.SnapshotName ||
		current.Items != snapshot.Items ||
		current.Bytes != snapshot.Bytes {
		return empty, errors.New("CURRENT inventory generation changed during staging")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	return LocalStagedOriginal{
		SHA256: digest.SHA256, Size: digest.Size,
		SnapshotSHA256: snapshot.SnapshotSHA256,
	}, nil
}
