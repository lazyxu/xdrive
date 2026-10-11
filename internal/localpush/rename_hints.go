package localpush

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"

	sourcepkg "github.com/lazyxu/xdrive/internal/source"
)

// L03-D2b1 returns conservative, read-only native-identity rename HINTS.
// A hint is not a SourceItem alias, remote move, deletion, content proof, or
// permission to begin a SourceRun. Only the owning Agent consumes local paths.
type InventoryRenameHint struct {
	PreviousPath      string
	CurrentPath       string
	NativeIdentityKey string
}

type InventoryRenameHintSummary struct {
	Delta                InventoryDeltaSummary
	Hints                int64
	MissingInferenceSafe bool
}

const (
	inventoryRenameBucketCount = 64
	inventoryRenameBucketLimit = 8192
)

// Records contain only private, Root-scoped relative-path metadata. Both
// generations are included, even when a path is unchanged, to detect reused
// or non-unique native identities rather than guessing at a rename.
type inventoryRenameRecord struct {
	Side                 string `json:"side"`
	Path                 string `json:"path"`
	Kind                 string `json:"kind"`
	Ignored              bool   `json:"ignored"`
	NativeIdentityKey    string `json:"native_identity_key"`
	StrongNativeIdentity bool   `json:"strong_native_identity"`
	RenameHintSafe       bool   `json:"rename_hint_safe"`
	LinkCount            uint64 `json:"link_count"`
}

type inventoryRenameGroup struct {
	Before      inventoryRenameRecord
	After       inventoryRenameRecord
	BeforeCount int
	AfterCount  int
}

type inventoryRenameWriter struct {
	file   *os.File
	buffer *bufio.Writer
	encode *json.Encoder
	count  int
}

func inventoryRenameBucket(key string) int {
	hash := sha256.Sum256([]byte(key))
	return int(hash[0]) % inventoryRenameBucketCount
}

func inventoryRenameSpoolPath(dir string, bucket int) string {
	return filepath.Join(dir, fmt.Sprintf("native-%02d.ndjson", bucket))
}

func inventoryRenameRecordFor(side string, item InventoryCandidate) inventoryRenameRecord {
	return inventoryRenameRecord{
		Side: side, Path: item.Path, Kind: item.Kind, Ignored: item.Ignored,
		NativeIdentityKey:    item.NativeIdentityKey,
		StrongNativeIdentity: item.StrongNativeIdentity,
		RenameHintSafe:       item.RenameHintSafe, LinkCount: item.LinkCount,
	}
}

// A unique strong single-linked FILE identity on both sides is only a rename
// hint when its paths differ. Directories and ambiguous/multiple hard-link
// paths remain unpaired; content still requires independent verification.
func inventoryRenameHintFor(group inventoryRenameGroup) (InventoryRenameHint, bool) {
	before, after := group.Before, group.After
	if group.BeforeCount != 1 || group.AfterCount != 1 ||
		before.Path == "" || after.Path == "" || before.Path == after.Path ||
		before.Kind != "file" || after.Kind != "file" ||
		before.Ignored || after.Ignored ||
		before.NativeIdentityKey == "" || before.NativeIdentityKey != after.NativeIdentityKey ||
		!before.StrongNativeIdentity || !after.StrongNativeIdentity ||
		!before.RenameHintSafe || !after.RenameHintSafe ||
		before.LinkCount != 1 || after.LinkCount != 1 {
		return InventoryRenameHint{}, false
	}
	return InventoryRenameHint{
		PreviousPath: before.Path, CurrentPath: after.Path,
		NativeIdentityKey: before.NativeIdentityKey,
	}, true
}

func readInventoryRenameBucket(dir string, index int) (map[string]inventoryRenameGroup, error) {
	groups := make(map[string]inventoryRenameGroup)
	file, err := os.Open(inventoryRenameSpoolPath(dir, index))
	if errors.Is(err, os.ErrNotExist) {
		return groups, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	reader := json.NewDecoder(bufio.NewReaderSize(file, 32<<10))
	for rows := 0; ; rows++ {
		var record inventoryRenameRecord
		err := reader.Decode(&record)
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("invalid private native-rename staging record: %w", err)
		}
		if rows >= inventoryRenameBucketLimit {
			return nil, errors.New("native-rename identity bucket exceeds memory limit")
		}
		canonical, pathErr := sourcepkg.NormalizeRelativePath(record.Path)
		if pathErr != nil || canonical != record.Path || canonical == "" ||
			(record.Side != "before" && record.Side != "after") ||
			(record.Kind != "file" && record.Kind != "directory") ||
			len(record.NativeIdentityKey) != 64 ||
			inventoryRenameBucket(record.NativeIdentityKey) != index {
			return nil, errors.New("invalid private native-rename identity or relative path")
		}
		if _, err := hex.DecodeString(record.NativeIdentityKey); err != nil {
			return nil, errors.New("invalid native-rename identity digest")
		}
		group := groups[record.NativeIdentityKey]
		if record.Side == "before" {
			group.BeforeCount++
			if group.BeforeCount == 1 {
				group.Before = record
			}
		} else {
			group.AfterCount++
			if group.AfterCount == 1 {
				group.After = record
			}
		}
		groups[record.NativeIdentityKey] = group
	}
	return groups, nil
}

// StreamInventoryNativeRenameHints first finishes the entire verified,
// bounded two-generation delta into private disk buckets. It only emits hints
// after the delta completed successfully. Each bucket is capped at 8192
// observations; skew or corruption fails closed, never O(100k) in-memory.
//
// This is advisory read-only Agent evidence, NOT a durable alias index. The
// caller must not mutate Source/SourceItem, cloud bytes or Mirror evidence on
// the strength of a callback, including if a later callback fails.
func StreamInventoryNativeRenameHints(
	ctx context.Context, configDir string, grant RootGrant, batchSize int,
	yield func([]InventoryRenameHint) error,
) (InventoryRenameHintSummary, error) {
	var empty InventoryRenameHintSummary
	if ctx == nil {
		return empty, errors.New("rename-hint context is required")
	}
	if yield == nil {
		return empty, errors.New("rename-hint callback is required")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	if batchSize <= 0 {
		batchSize = DefaultInventoryBatchSize
	}
	if batchSize > maxInventoryBatchSize {
		return empty, fmt.Errorf("rename-hint batch exceeds %d", maxInventoryBatchSize)
	}
	if err := VerifyRootGrant(grant); err != nil {
		return empty, err
	}
	// Guard against placing private staging files inside the scanned Root.
	if _, err := inventoryJournalDir(configDir, grant); err != nil {
		return empty, err
	}
	dir, err := os.MkdirTemp(configDir, ".localpush-rename-*")
	if err != nil {
		return empty, err
	}
	defer os.RemoveAll(dir)
	var writers [inventoryRenameBucketCount]*inventoryRenameWriter
	defer func() {
		for _, bucket := range writers {
			if bucket != nil && bucket.file != nil {
				_ = bucket.file.Close()
			}
		}
	}()
	appendRecord := func(side string, item InventoryCandidate) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		record := inventoryRenameRecordFor(side, item)
		if len(record.NativeIdentityKey) != 64 {
			return errors.New("invalid native identity in verified delta")
		}
		index := inventoryRenameBucket(record.NativeIdentityKey)
		bucket := writers[index]
		if bucket == nil {
			file, err := os.OpenFile(inventoryRenameSpoolPath(dir, index),
				os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
			if err != nil {
				return err
			}
			buffer := bufio.NewWriterSize(file, 32<<10)
			bucket = &inventoryRenameWriter{
				file: file, buffer: buffer, encode: json.NewEncoder(buffer),
			}
			writers[index] = bucket
		}
		if bucket.count >= inventoryRenameBucketLimit {
			return fmt.Errorf("native-rename bucket %d exceeds %d rows", index, inventoryRenameBucketLimit)
		}
		if err := bucket.encode.Encode(record); err != nil {
			return err
		}
		bucket.count++
		return nil
	}
	delta, err := StreamInventoryGenerationDelta(ctx, configDir, grant,
		maxInventoryBatchSize, func(batch []InventoryDeltaCandidate) error {
			for _, candidate := range batch {
				if candidate.Previous != nil {
					if err := appendRecord("before", *candidate.Previous); err != nil {
						return err
					}
				}
				if candidate.Current != nil {
					if err := appendRecord("after", *candidate.Current); err != nil {
						return err
					}
				}
			}
			return nil
		})
	if err != nil {
		return empty, err
	}
	for _, bucket := range writers {
		if bucket == nil {
			continue
		}
		if err := bucket.buffer.Flush(); err != nil {
			return empty, err
		}
		if err := bucket.file.Close(); err != nil {
			return empty, err
		}
		bucket.file = nil
	}
	// Manifest rotation after delta staging is not a valid rename observation.
	before, err := VerifyPreviousInventoryJournal(ctx, configDir, grant)
	if err != nil || before.SnapshotName != delta.Previous.SnapshotName ||
		before.SnapshotSHA256 != delta.Previous.SnapshotSHA256 {
		return empty, errors.New("previous inventory changed during rename hints")
	}
	after, err := VerifyInventoryJournal(ctx, configDir, grant)
	if err != nil || after.SnapshotName != delta.Current.SnapshotName ||
		after.SnapshotSHA256 != delta.Current.SnapshotSHA256 {
		return empty, errors.New("current inventory changed during rename hints")
	}
	summary := InventoryRenameHintSummary{Delta: delta}
	items := make([]InventoryRenameHint, 0, batchSize)
	flush := func() error {
		if len(items) == 0 {
			return nil
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := yield(append([]InventoryRenameHint(nil), items...)); err != nil {
			return err
		}
		items = items[:0]
		return nil
	}
	for index := 0; index < inventoryRenameBucketCount; index++ {
		if err := ctx.Err(); err != nil {
			return empty, err
		}
		groups, err := readInventoryRenameBucket(dir, index)
		if err != nil {
			return empty, err
		}
		keys := make([]string, 0, len(groups))
		for key := range groups {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			if err := ctx.Err(); err != nil {
				return empty, err
			}
			hint, valid := inventoryRenameHintFor(groups[key])
			if !valid {
				continue
			}
			summary.Hints++
			items = append(items, hint)
			if len(items) == batchSize {
				if err := flush(); err != nil {
					return empty, err
				}
			}
		}
	}
	if summary.Hints > delta.Added || summary.Hints > delta.AbsentCandidates {
		return empty, errors.New("native-rename hint totals exceed verified delta")
	}
	if err := VerifyRootGrant(grant); err != nil {
		return empty, err
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	if err := flush(); err != nil {
		return empty, err
	}
	// MissingInferenceSafe is deliberately false. Neither a confident
	// identity hint nor an absent path authorizes Mirror deletion.
	return summary, nil
}
