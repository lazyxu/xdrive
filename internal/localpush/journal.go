package localpush

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
)

const inventoryJournalVersion = 1

// InventoryJournalSnapshot is only a local immutable *read-only* manifest.
// No snapshot is an accepted xDrive SourceRun or evidence of remote deletion.
type InventoryJournalSnapshot struct {
	Version              int       `json:"version"`
	SourceID             uint64    `json:"source_id"`
	RootID               string    `json:"root_id"`
	DeviceID             string    `json:"device_id"`
	RootFingerprint      string    `json:"root_fingerprint"`
	SnapshotName         string    `json:"snapshot_name"`
	SnapshotSHA256       string    `json:"snapshot_sha256"`
	Items                int64     `json:"items"`
	Bytes                int64     `json:"bytes"`
	WithNativeIdentity   int64     `json:"with_native_identity"`
	CompletedAt          time.Time `json:"completed_at"`
	MissingInferenceSafe bool      `json:"missing_inference_safe"`
}

type InventoryJournalWriter struct {
	grant       RootGrant
	dir         string
	pending     string
	snapshot    string
	file        *os.File
	buffer      *bufio.Writer
	encoder     *json.Encoder
	digest      hash.Hash
	items       int64
	bytes       int64
	nativeItems int64
	finalized   bool
}

func inventoryJournalDir(configDir string, grant RootGrant) (string, error) {
	if strings.TrimSpace(configDir) == "" {
		return "", errors.New("inventory journal configuration directory is required")
	}
	// Both the Root and its private journal must be outside each other's
	// directory subtree. Never import the journal itself as user files.
	rootAbs, err := filepath.Abs(grant.Path)
	if err != nil {
		return "", err
	}
	configAbs, err := filepath.Abs(configDir)
	if err != nil {
		return "", err
	}
	for _, scope := range [][2]string{{rootAbs, configAbs}, {configAbs, rootAbs}} {
		relative, err := filepath.Rel(scope[0], scope[1])
		if err != nil {
			return "", err
		}
		if relative == "." || (relative != ".." &&
			!strings.HasPrefix(relative, ".."+string(filepath.Separator))) {
			return "", errors.New("inventory journal cannot overlap the authorized Root")
		}
	}
	// No raw Root path, account token or Server credential enters the key.
	key := sha256.Sum256([]byte(grant.Server + "\x00" + grant.Account + "\x00" +
		grant.DeviceID + "\x00" + grant.RootID + "\x00" + strconv.FormatUint(grant.SourceID, 10)))
	return filepath.Join(configAbs, "localpush", "journals", hex.EncodeToString(key[:16])), nil
}

func BeginInventoryJournal(configDir string, grant RootGrant) (*InventoryJournalWriter, error) {
	if err := VerifyRootGrant(grant); err != nil {
		return nil, err
	}
	dir, err := inventoryJournalDir(configDir, grant)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return nil, err
	}
	file, err := os.CreateTemp(dir, ".snapshot-incomplete-*.ndjson")
	if err != nil {
		return nil, err
	}
	if err := file.Chmod(0o600); err != nil {
		_ = file.Close()
		_ = os.Remove(file.Name())
		return nil, err
	}
	h := sha256.New()
	buffer := bufio.NewWriterSize(file, 32<<10)
	return &InventoryJournalWriter{
		grant:    grant,
		dir:      dir,
		pending:  file.Name(),
		snapshot: "snapshot-" + uuid.NewString() + ".ndjson",
		file:     file,
		buffer:   buffer,
		encoder:  json.NewEncoder(io.MultiWriter(buffer, h)),
		digest:   h,
	}, nil
}

func (w *InventoryJournalWriter) Append(items []InventoryItem) error {
	if w == nil || w.finalized || w.file == nil {
		return errors.New("inventory journal is not writable")
	}
	if len(items) == 0 || len(items) > maxInventoryBatchSize {
		return fmt.Errorf("inventory journal batch must contain 1-%d items", maxInventoryBatchSize)
	}
	for _, item := range items {
		canonical, err := sourcepkg.NormalizeRelativePath(item.Path)
		if err != nil || canonical != item.Path {
			return fmt.Errorf("unsafe journal entry path %q", item.Path)
		}
		if (item.Kind != "file" && item.Kind != "directory") || item.Size < 0 ||
			item.NativeIdentity == nil || len(item.NativeIdentity.Key) != 64 {
			return fmt.Errorf("journal entry %q lacks a valid native identity", item.Path)
		}
		if _, err := hex.DecodeString(item.NativeIdentity.Key); err != nil {
			return fmt.Errorf("journal entry %q has invalid native identity", item.Path)
		}
		if err := w.encoder.Encode(item); err != nil {
			return err
		}
		w.items++
		w.bytes += item.Size
		w.nativeItems++
	}
	return nil
}

// Commit must only follow a fully successful Root-verified scanner run. The
// completed snapshot file is immutable; CURRENT.json is atomically replaced
// only after the file is completely flushed and synced.
func (w *InventoryJournalWriter) Commit(summary InventorySummary) (InventoryJournalSnapshot, error) {
	if w == nil || w.finalized || w.file == nil {
		return InventoryJournalSnapshot{}, errors.New("inventory journal is not writable")
	}
	if !summary.Complete || summary.MissingInferenceSafe ||
		w.items != summary.ScannedFiles+summary.ScannedDirectories || w.bytes != summary.ScannedBytes {
		return InventoryJournalSnapshot{}, errors.New("partial or inconsistent inventory cannot be committed")
	}
	if err := VerifyRootGrant(w.grant); err != nil {
		return InventoryJournalSnapshot{}, err
	}
	if err := w.buffer.Flush(); err != nil {
		return InventoryJournalSnapshot{}, err
	}
	if err := w.file.Sync(); err != nil {
		return InventoryJournalSnapshot{}, err
	}
	if err := w.file.Close(); err != nil {
		w.file = nil
		return InventoryJournalSnapshot{}, err
	}
	w.file = nil
	target := filepath.Join(w.dir, w.snapshot)
	if err := os.Rename(w.pending, target); err != nil {
		return InventoryJournalSnapshot{}, err
	}
	// After a crash before CURRENT.json replacement the new file is only
	// an orphan, never a partial published generation.
	snapshot := InventoryJournalSnapshot{
		Version:              inventoryJournalVersion,
		SourceID:             w.grant.SourceID,
		RootID:               w.grant.RootID,
		DeviceID:             w.grant.DeviceID,
		RootFingerprint:      w.grant.Fingerprint,
		SnapshotName:         w.snapshot,
		SnapshotSHA256:       hex.EncodeToString(w.digest.Sum(nil)),
		Items:                w.items,
		Bytes:                w.bytes,
		WithNativeIdentity:   w.nativeItems,
		CompletedAt:          time.Now().UTC(),
		MissingInferenceSafe: false,
	}
	old, previousErr := loadInventoryJournalHead(w.dir)
	if previousErr != nil && !errors.Is(previousErr, os.ErrNotExist) {
		_ = os.Remove(target)
		return InventoryJournalSnapshot{}, fmt.Errorf("validate previous inventory head: %w", previousErr)
	}
	if err := writeInventoryJournalHead(w.dir, snapshot); err != nil {
		_ = os.Remove(target)
		return InventoryJournalSnapshot{}, err
	}
	w.finalized = true
	if old.SnapshotName != "" && old.SnapshotName != w.snapshot && validJournalSnapshotName(old.SnapshotName) {
		_ = os.Remove(filepath.Join(w.dir, old.SnapshotName))
	}
	return snapshot, nil
}

func (w *InventoryJournalWriter) Abort() {
	if w == nil || w.finalized {
		return
	}
	w.finalized = true
	if w.file != nil {
		_ = w.file.Close()
		w.file = nil
	}
	if w.pending != "" {
		_ = os.Remove(w.pending)
	}
}

// ScanInventoryToJournal streams all records to a private local immutable
// snapshot. A partial/cancelled scan never advances CURRENT.json.
func ScanInventoryToJournal(ctx context.Context, configDir string, grant RootGrant, scanner InventoryScanner) (InventoryJournalSnapshot, InventorySummary, error) {
	var empty InventoryJournalSnapshot
	if ctx == nil {
		return empty, InventorySummary{}, errors.New("inventory scan context is required")
	}
	if err := ctx.Err(); err != nil {
		return empty, InventorySummary{}, err
	}
	writer, err := BeginInventoryJournal(configDir, grant)
	if err != nil {
		return empty, InventorySummary{}, err
	}
	defer writer.Abort()
	scanner.IncludeNativeIdentity = true
	summary, err := scanner.ScanInventory(ctx, grant, writer.Append)
	if err != nil {
		return empty, summary, err
	}
	if err := ctx.Err(); err != nil {
		return empty, summary, err
	}
	snapshot, err := writer.Commit(summary)
	return snapshot, summary, err
}

func validJournalSnapshotName(value string) bool {
	if !strings.HasPrefix(value, "snapshot-") || !strings.HasSuffix(value, ".ndjson") {
		return false
	}
	_, err := uuid.Parse(strings.TrimSuffix(strings.TrimPrefix(value, "snapshot-"), ".ndjson"))
	return err == nil
}

func loadInventoryJournalHead(dir string) (InventoryJournalSnapshot, error) {
	var snap InventoryJournalSnapshot
	file, err := os.Open(filepath.Join(dir, "CURRENT.json"))
	if err != nil {
		return snap, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 8193))
	if err != nil {
		return snap, err
	}
	if len(data) > 8192 {
		return snap, errors.New("inventory manifest exceeds limit")
	}
	if err := json.Unmarshal(data, &snap); err != nil {
		return snap, err
	}
	if snap.Version != inventoryJournalVersion || !validJournalSnapshotName(snap.SnapshotName) ||
		len(snap.SnapshotSHA256) != 64 || snap.MissingInferenceSafe {
		return InventoryJournalSnapshot{}, errors.New("invalid inventory journal manifest")
	}
	if _, err := hex.DecodeString(snap.SnapshotSHA256); err != nil {
		return InventoryJournalSnapshot{}, err
	}
	return snap, nil
}

func writeInventoryJournalHead(dir string, snapshot InventoryJournalSnapshot) error {
	data, err := json.Marshal(snapshot)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(dir, ".current-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if err := file.Chmod(0o600); err != nil {
		_ = file.Close()
		return err
	}
	if _, err := file.Write(data); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), filepath.Join(dir, "CURRENT.json"))
}

// VerifyInventoryJournal streams a complete local snapshot through SHA-256;
// it does not load records into memory or consult/change xDrive Server.
func VerifyInventoryJournal(ctx context.Context, configDir string, grant RootGrant) (InventoryJournalSnapshot, error) {
	if ctx == nil {
		return InventoryJournalSnapshot{}, errors.New("inventory journal verification context is required")
	}
	if err := ctx.Err(); err != nil {
		return InventoryJournalSnapshot{}, err
	}
	if err := VerifyRootGrant(grant); err != nil {
		return InventoryJournalSnapshot{}, err
	}
	dir, err := inventoryJournalDir(configDir, grant)
	if err != nil {
		return InventoryJournalSnapshot{}, err
	}
	snap, err := loadInventoryJournalHead(dir)
	if err != nil {
		return InventoryJournalSnapshot{}, err
	}
	if snap.SourceID != grant.SourceID || snap.RootID != grant.RootID ||
		snap.DeviceID != grant.DeviceID || snap.RootFingerprint != grant.Fingerprint {
		return InventoryJournalSnapshot{}, errors.New("inventory journal belongs to another Root or Source")
	}
	file, err := os.Open(filepath.Join(dir, snap.SnapshotName))
	if err != nil {
		return InventoryJournalSnapshot{}, err
	}
	defer file.Close()
	digest := sha256.New()
	if _, err := io.Copy(digest, &contextReader{ctx: ctx, r: file}); err != nil {
		return InventoryJournalSnapshot{}, err
	}
	if hex.EncodeToString(digest.Sum(nil)) != snap.SnapshotSHA256 {
		return InventoryJournalSnapshot{}, errors.New("inventory journal snapshot checksum mismatch")
	}
	return snap, nil
}

type contextReader struct {
	ctx context.Context
	r   io.Reader
}

func (r *contextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.r.Read(p)
}
