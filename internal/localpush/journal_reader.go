package localpush

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	sourcepkg "github.com/lazyxu/xdrive/internal/source"
)

// StreamVerifiedInventoryJournal exposes an already completed local snapshot
// in bounded batches to a read-only reconciler. Verification succeeds BEFORE
// any observation is emitted. A final checksum/count/Root recheck detects
// concurrent changes during the stream; callers must not mutate Source,
// SyncRun, or remote files based on callbacks from a failed/incomplete read.
//
// L03-A is not a SourceItem identity map or remote-delete authority.
func StreamVerifiedInventoryJournal(
	ctx context.Context,
	configDir string,
	grant RootGrant,
	batchSize int,
	yield func([]InventoryItem) error,
) (InventoryJournalSnapshot, error) {
	return streamVerifiedInventoryManifest(ctx, configDir, grant, batchSize, yield, inventoryJournalCurrent)
}

// StreamVerifiedPreviousInventoryJournal provides the same SHA-256, Root,
// record and <=500-item batch checks for PREVIOUS as for CURRENT. It grants
// no remote deletion, identity mapping, or SourceRun authority.
func StreamVerifiedPreviousInventoryJournal(
	ctx context.Context,
	configDir string,
	grant RootGrant,
	batchSize int,
	yield func([]InventoryItem) error,
) (InventoryJournalSnapshot, error) {
	return streamVerifiedInventoryManifest(ctx, configDir, grant, batchSize, yield, inventoryJournalPrevious)
}

func streamVerifiedInventoryManifest(
	ctx context.Context,
	configDir string,
	grant RootGrant,
	batchSize int,
	yield func([]InventoryItem) error,
	manifest string,
) (InventoryJournalSnapshot, error) {
	var empty InventoryJournalSnapshot
	if ctx == nil {
		return empty, errors.New("inventory journal context is required")
	}
	if yield == nil {
		return empty, errors.New("inventory journal callback is required")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	if batchSize <= 0 {
		batchSize = DefaultInventoryBatchSize
	}
	if batchSize > maxInventoryBatchSize {
		return empty, fmt.Errorf("inventory journal batch exceeds %d items", maxInventoryBatchSize)
	}
	var snapshot InventoryJournalSnapshot
	var err error
	switch manifest {
	case inventoryJournalCurrent:
		snapshot, err = VerifyInventoryJournal(ctx, configDir, grant)
	case inventoryJournalPrevious:
		snapshot, err = VerifyPreviousInventoryJournal(ctx, configDir, grant)
	default:
		return empty, errors.New("unsupported inventory generation")
	}
	if err != nil {
		return empty, err
	}
	dir, err := inventoryJournalDir(configDir, grant)
	if err != nil {
		return empty, err
	}
	f, err := os.Open(filepath.Join(dir, snapshot.SnapshotName))
	if err != nil {
		return empty, err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 16<<10), 64<<10)
	items := make([]InventoryItem, 0, batchSize)
	digest := sha256.New()
	var itemCount, byteCount, identityCount int64
	flush := func() error {
		if len(items) == 0 {
			return nil
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		batch := append([]InventoryItem(nil), items...)
		if err := yield(batch); err != nil {
			return err
		}
		items = items[:0]
		return nil
	}

	for scanner.Scan() {
		if err := ctx.Err(); err != nil {
			return empty, err
		}
		line := scanner.Bytes()
		if _, err := digest.Write(line); err != nil {
			return empty, err
		}
		if _, err := digest.Write([]byte{10}); err != nil {
			return empty, err
		}
		var item InventoryItem
		if err := json.Unmarshal(line, &item); err != nil {
			return empty, fmt.Errorf("invalid inventory journal record: %w", err)
		}
		canonical, err := sourcepkg.NormalizeRelativePath(item.Path)
		if err != nil || canonical != item.Path ||
			(item.Kind != "file" && item.Kind != "directory") ||
			item.Size < 0 || (item.Kind == "directory" && item.Size != 0) ||
			item.NativeIdentity == nil || len(item.NativeIdentity.Key) != 64 ||
			item.NativeIdentity.LinkCount == 0 {
			return empty, fmt.Errorf("invalid inventory journal entry at path %q", item.Path)
		}
		if _, err := hex.DecodeString(item.NativeIdentity.Key); err != nil {
			return empty, fmt.Errorf("invalid native identity at path %q", item.Path)
		}
		if item.NativeIdentity.RenameCandidate && !item.NativeIdentity.Strong {
			return empty, fmt.Errorf("weak native identity cannot be a rename candidate at %q", item.Path)
		}
		if item.Kind == "file" && item.NativeIdentity.LinkCount != 1 &&
			item.NativeIdentity.RenameCandidate {
			return empty, fmt.Errorf("hard-linked file is not a unique rename candidate at %q", item.Path)
		}
		itemCount++
		byteCount += item.Size
		identityCount++
		items = append(items, item)
		if len(items) == batchSize {
			if err := flush(); err != nil {
				return empty, err
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return empty, fmt.Errorf("read inventory snapshot: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	if itemCount != snapshot.Items || byteCount != snapshot.Bytes ||
		identityCount != snapshot.WithNativeIdentity ||
		hex.EncodeToString(digest.Sum(nil)) != snapshot.SnapshotSHA256 {
		return empty, errors.New("inventory journal changed during read or has mismatched totals")
	}
	if err := VerifyRootGrant(grant); err != nil {
		return empty, err
	}
	if err := flush(); err != nil {
		return empty, err
	}
	return snapshot, nil
}
