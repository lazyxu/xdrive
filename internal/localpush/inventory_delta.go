package localpush

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
)

// L03-D2a is read-only filesystem observation evidence. Nothing emitted
// here is a durable SourceItem ID, proven rename, SourceRun checkpoint,
// CAS upload authorization or Mirror deletion instruction.
type InventoryDeltaKind string

const (
	InventoryDeltaAdded   InventoryDeltaKind = "added_candidate"
	InventoryDeltaChanged InventoryDeltaKind = "changed_candidate"
	InventoryDeltaStable  InventoryDeltaKind = "metadata_stable_candidate"
	InventoryDeltaAbsent  InventoryDeltaKind = "absent_candidate"
)

type InventoryDeltaCandidate struct {
	Kind     InventoryDeltaKind
	Previous *InventoryCandidate
	Current  *InventoryCandidate
}

type InventoryDeltaSummary struct {
	Previous             InventoryJournalSnapshot
	Current              InventoryJournalSnapshot
	Added                int64
	Changed              int64
	MetadataStable       int64
	AbsentCandidates     int64
	MissingInferenceSafe bool
}

// Spool at most 64 short-lived files, and hold at most 8192 candidates per
// generation/bucket in memory. Path hashes spread 100k entries in normal
// workloads. An adversarial/skewed bucket fails closed instead of growing.
const (
	inventoryDeltaBucketCount = 64
	inventoryDeltaBucketLimit = 8192
)

type inventoryDeltaSpool struct {
	file    *os.File
	buffer  *bufio.Writer
	encoder *json.Encoder
	count   int
}

func inventoryDeltaBucket(path string) int {
	digest := sha256.Sum256([]byte(path))
	return int(digest[0]) % inventoryDeltaBucketCount
}

func inventoryDeltaBucketFile(dir, side string, bucket int) string {
	return filepath.Join(dir, fmt.Sprintf("%s-%02d.ndjson", side, bucket))
}

func spoolInventoryGeneration(ctx context.Context, configDir string, grant RootGrant,
	dir, side string, expected InventoryJournalSnapshot, previous bool,
) error {
	var buckets [inventoryDeltaBucketCount]*inventoryDeltaSpool
	defer func() {
		for _, bucket := range buckets {
			if bucket != nil && bucket.file != nil {
				_ = bucket.file.Close()
			}
		}
	}()
	yield := func(items []InventoryItem) error {
		for _, item := range items {
			if err := ctx.Err(); err != nil {
				return err
			}
			candidate, err := CandidateFromInventoryItem(grant, item)
			if err != nil {
				return err
			}
			index := inventoryDeltaBucket(candidate.Path)
			bucket := buckets[index]
			if bucket == nil {
				file, err := os.OpenFile(inventoryDeltaBucketFile(dir, side, index),
					os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
				if err != nil {
					return err
				}
				buffer := bufio.NewWriterSize(file, 32<<10)
				bucket = &inventoryDeltaSpool{
					file: file, buffer: buffer, encoder: json.NewEncoder(buffer),
				}
				buckets[index] = bucket
			}
			if bucket.count >= inventoryDeltaBucketLimit {
				return fmt.Errorf("inventory delta bucket %d exceeds %d records", index, inventoryDeltaBucketLimit)
			}
			if err := bucket.encoder.Encode(candidate); err != nil {
				return err
			}
			bucket.count++
		}
		return nil
	}
	var actual InventoryJournalSnapshot
	var err error
	if previous {
		actual, err = StreamVerifiedPreviousInventoryJournal(ctx, configDir, grant, maxInventoryBatchSize, yield)
	} else {
		actual, err = StreamVerifiedInventoryJournal(ctx, configDir, grant, maxInventoryBatchSize, yield)
	}
	if err != nil {
		return err
	}
	if actual.SnapshotName != expected.SnapshotName ||
		actual.SnapshotSHA256 != expected.SnapshotSHA256 || actual.Items != expected.Items {
		return errors.New("inventory snapshot changed while staging a delta")
	}
	for _, bucket := range buckets {
		if bucket == nil {
			continue
		}
		if err := bucket.buffer.Flush(); err != nil {
			return err
		}
		if err := bucket.file.Close(); err != nil {
			return err
		}
		bucket.file = nil
	}
	return nil
}

func readInventoryDeltaBucket(dir, side string, index int) (map[string]InventoryCandidate, error) {
	result := make(map[string]InventoryCandidate)
	file, err := os.Open(inventoryDeltaBucketFile(dir, side, index))
	if errors.Is(err, os.ErrNotExist) {
		return result, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	decoder := json.NewDecoder(bufio.NewReaderSize(file, 32<<10))
	for {
		var candidate InventoryCandidate
		err := decoder.Decode(&candidate)
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("invalid inventory delta staging record: %w", err)
		}
		if candidate.Path == "" || inventoryDeltaBucket(candidate.Path) != index {
			return nil, errors.New("inventory delta staging path is invalid")
		}
		if len(result) >= inventoryDeltaBucketLimit {
			return nil, errors.New("inventory delta staging bucket exceeded memory limit")
		}
		if _, exists := result[candidate.Path]; exists {
			return nil, errors.New("duplicate relative path in one inventory generation")
		}
		result[candidate.Path] = candidate
	}
	return result, nil
}

func inventoryDeltaMetadataStable(a, b InventoryCandidate) bool {
	// A missing timestamp cannot prove metadata stability. Even matching
	// timestamps/size/identity do NOT establish identical file contents.
	if a.ModifiedAt == nil || b.ModifiedAt == nil {
		return false
	}
	return a.Kind == b.Kind && a.Size == b.Size && a.Ignored == b.Ignored &&
		a.NativeIdentityKey == b.NativeIdentityKey &&
		a.StrongNativeIdentity == b.StrongNativeIdentity &&
		a.LinkCount == b.LinkCount && a.RenameHintSafe == b.RenameHintSafe &&
		a.ModifiedAt.Equal(*b.ModifiedAt)
}

// StreamInventoryGenerationDelta only compares two independently verified,
// DIFFERENT, complete local Root generations. Two small hash-partitioned
// private spool sets avoid a 100k-row in-memory map. All source checks and
// spooling finish before the first callback. A later callback failure,
// cancellation or Root replacement invalidates the entire advisory result.
//
// In particular, old paths absent from the new snapshot are only
// "absent_candidate": not deletion, not rename, not Mirror evidence.
func StreamInventoryGenerationDelta(ctx context.Context, configDir string, grant RootGrant,
	batchSize int, yield func([]InventoryDeltaCandidate) error,
) (InventoryDeltaSummary, error) {
	var empty InventoryDeltaSummary
	if ctx == nil {
		return empty, errors.New("inventory delta requires context")
	}
	if yield == nil {
		return empty, errors.New("inventory delta requires callback")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	if batchSize <= 0 {
		batchSize = DefaultInventoryBatchSize
	}
	if batchSize > maxInventoryBatchSize {
		return empty, fmt.Errorf("inventory delta batch exceeds %d", maxInventoryBatchSize)
	}
	previous, err := VerifyPreviousInventoryJournal(ctx, configDir, grant)
	if err != nil {
		return empty, err
	}
	current, err := VerifyInventoryJournal(ctx, configDir, grant)
	if err != nil {
		return empty, err
	}
	// PREVIOUS may equal CURRENT after a crash between head publications.
	if previous.SnapshotName == current.SnapshotName ||
		current.CompletedAt.Before(previous.CompletedAt) {
		return empty, errors.New("two distinct ordered inventory generations required")
	}
	// MkdirTemp mode is 0700. Spool records have 0600 permissions and only
	// relative-path metadata, in the Agent-owned config tree; all are removed.
	dir, err := os.MkdirTemp(configDir, ".localpush-delta-*")
	if err != nil {
		return empty, err
	}
	defer os.RemoveAll(dir)
	if err := spoolInventoryGeneration(ctx, configDir, grant, dir, "before", previous, true); err != nil {
		return empty, err
	}
	if err := spoolInventoryGeneration(ctx, configDir, grant, dir, "after", current, false); err != nil {
		return empty, err
	}
	// Abort if a new scan rotated the manifests between independent reads.
	beforeNow, err := VerifyPreviousInventoryJournal(ctx, configDir, grant)
	if err != nil || beforeNow.SnapshotName != previous.SnapshotName ||
		beforeNow.SnapshotSHA256 != previous.SnapshotSHA256 {
		return empty, errors.New("previous inventory changed during delta")
	}
	afterNow, err := VerifyInventoryJournal(ctx, configDir, grant)
	if err != nil || afterNow.SnapshotName != current.SnapshotName ||
		afterNow.SnapshotSHA256 != current.SnapshotSHA256 {
		return empty, errors.New("current inventory changed during delta")
	}
	summary := InventoryDeltaSummary{Previous: previous, Current: current}
	// MissingInferenceSafe intentionally never becomes true in this stage.
	items := make([]InventoryDeltaCandidate, 0, batchSize)
	flush := func() error {
		if len(items) == 0 {
			return nil
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := yield(append([]InventoryDeltaCandidate(nil), items...)); err != nil {
			return err
		}
		items = items[:0]
		return nil
	}
	for index := 0; index < inventoryDeltaBucketCount; index++ {
		if err := ctx.Err(); err != nil {
			return empty, err
		}
		oldItems, err := readInventoryDeltaBucket(dir, "before", index)
		if err != nil {
			return empty, err
		}
		newItems, err := readInventoryDeltaBucket(dir, "after", index)
		if err != nil {
			return empty, err
		}
		paths := make([]string, 0, len(newItems))
		for path := range newItems {
			paths = append(paths, path)
		}
		sort.Strings(paths)
		for _, path := range paths {
			if err := ctx.Err(); err != nil {
				return empty, err
			}
			now := newItems[path]
			candidate := InventoryDeltaCandidate{Current: &now}
			if before, exists := oldItems[path]; exists {
				delete(oldItems, path)
				candidate.Previous = &before
				if inventoryDeltaMetadataStable(before, now) {
					candidate.Kind = InventoryDeltaStable
					summary.MetadataStable++
				} else {
					candidate.Kind = InventoryDeltaChanged
					summary.Changed++
				}
			} else {
				candidate.Kind = InventoryDeltaAdded
				summary.Added++
			}
			items = append(items, candidate)
			if len(items) == batchSize {
				if err := flush(); err != nil {
					return empty, err
				}
			}
		}
		paths = paths[:0]
		for path := range oldItems {
			paths = append(paths, path)
		}
		sort.Strings(paths)
		for _, path := range paths {
			if err := ctx.Err(); err != nil {
				return empty, err
			}
			before := oldItems[path]
			items = append(items, InventoryDeltaCandidate{
				Kind: InventoryDeltaAbsent, Previous: &before,
			})
			summary.AbsentCandidates++
			if len(items) == batchSize {
				if err := flush(); err != nil {
					return empty, err
				}
			}
		}
	}
	if summary.Added+summary.Changed+summary.MetadataStable != current.Items ||
		summary.AbsentCandidates+summary.Changed+summary.MetadataStable != previous.Items {
		return empty, errors.New("delta counts do not reconcile with complete inventory generations")
	}
	if err := VerifyRootGrant(grant); err != nil {
		return empty, err
	}
	if err := flush(); err != nil {
		return empty, err
	}
	return summary, nil
}
