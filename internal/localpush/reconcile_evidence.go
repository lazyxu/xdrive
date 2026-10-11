package localpush

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	localEvidenceVersion  = 1
	localEvidenceFile     = "ADVISORY.json"
	localEvidenceLock     = ".publish-lock"
	localEvidenceMaxBytes = 8192
)

// LocalReconcileEvidence is a crash-recoverable, advisory generation fence.
// It is NOT a SourceItem identity, alias, executor proof, deletion observation,
// or accepted SourceRun checkpoint. SourceRevision is supplied by the caller,
// not authenticated by this library; the owning Agent/Server must revalidate.
type LocalReconcileEvidence struct {
	Version              int       `json:"version"`
	SourceID             uint64    `json:"source_id"`
	SourceRevision       uint64    `json:"source_revision"`
	DeviceID             string    `json:"device_id"`
	RootID               string    `json:"root_id"`
	RootFingerprint      string    `json:"root_fingerprint"`
	ScopeSHA256          string    `json:"scope_sha256"`
	PreviousSnapshot     string    `json:"previous_snapshot"`
	PreviousSHA256       string    `json:"previous_sha256"`
	CurrentSnapshot      string    `json:"current_snapshot"`
	CurrentSHA256        string    `json:"current_sha256"`
	Added                int64     `json:"added"`
	Changed              int64     `json:"changed"`
	MetadataStable       int64     `json:"metadata_stable"`
	AbsentCandidates     int64     `json:"absent_candidates"`
	PreviousItems        int64     `json:"previous_items"`
	CurrentItems         int64     `json:"current_items"`
	PublishedAt          time.Time `json:"published_at"`
	MissingInferenceSafe bool      `json:"missing_inference_safe"`
	Authoritative        bool      `json:"authoritative"`
	IntegritySHA256      string    `json:"integrity_sha256"`
}

func localEvidenceScope(grant RootGrant) string {
	digest := sha256.Sum256([]byte(grant.Server + "\x00" + grant.Account))
	return hex.EncodeToString(digest[:])
}

func localEvidenceDirectory(configDir string, grant RootGrant) (string, error) {
	journalDir, err := inventoryJournalDir(configDir, grant)
	if err != nil {
		return "", err
	}
	return filepath.Join(journalDir, "reconcile-evidence-v1"), nil
}

func validEvidenceDigest(value string) bool {
	if len(value) != 64 {
		return false
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size && strings.ToLower(value) == value
}

func evidenceSeal(record LocalReconcileEvidence) (string, error) {
	record.IntegritySHA256 = ""
	bytes, err := json.Marshal(record)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(bytes)
	return hex.EncodeToString(digest[:]), nil
}

func validateLocalEvidence(record LocalReconcileEvidence, grant RootGrant) error {
	if record.Version != localEvidenceVersion ||
		record.SourceRevision == 0 || record.SourceID != grant.SourceID ||
		record.RootID != grant.RootID || record.DeviceID != grant.DeviceID ||
		record.RootFingerprint != grant.Fingerprint ||
		record.ScopeSHA256 != localEvidenceScope(grant) ||
		record.MissingInferenceSafe || record.Authoritative ||
		!validJournalSnapshotName(record.PreviousSnapshot) ||
		!validJournalSnapshotName(record.CurrentSnapshot) ||
		record.PreviousSnapshot == record.CurrentSnapshot ||
		!validEvidenceDigest(record.PreviousSHA256) ||
		!validEvidenceDigest(record.CurrentSHA256) ||
		!validEvidenceDigest(record.IntegritySHA256) ||
		record.PublishedAt.IsZero() ||
		record.Added < 0 || record.Changed < 0 ||
		record.MetadataStable < 0 || record.AbsentCandidates < 0 ||
		record.PreviousItems < 0 || record.CurrentItems < 0 ||
		record.Added+record.Changed+record.MetadataStable != record.CurrentItems ||
		record.AbsentCandidates+record.Changed+record.MetadataStable != record.PreviousItems {
		return errors.New("invalid local advisory reconciliation evidence")
	}
	seal, err := evidenceSeal(record)
	if err != nil || seal != record.IntegritySHA256 {
		return errors.New("local advisory reconciliation evidence checksum mismatch")
	}
	return nil
}

func readLocalEvidence(dir string, grant RootGrant) (LocalReconcileEvidence, error) {
	var empty LocalReconcileEvidence
	path := filepath.Join(dir, localEvidenceFile)
	info, err := os.Lstat(path)
	if err != nil {
		return empty, err
	}
	if !info.Mode().IsRegular() || info.Size() > localEvidenceMaxBytes {
		return empty, errors.New("local advisory manifest must be a bounded regular file")
	}
	file, err := os.Open(path)
	if err != nil {
		return empty, err
	}
	defer file.Close()
	decoder := json.NewDecoder(io.LimitReader(file, localEvidenceMaxBytes+1))
	decoder.DisallowUnknownFields()
	var result LocalReconcileEvidence
	if err := decoder.Decode(&result); err != nil {
		return empty, err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return empty, errors.New("local advisory manifest has trailing or excess content")
	}
	if err := validateLocalEvidence(result, grant); err != nil {
		return empty, err
	}
	return result, nil
}

func verifyLocalEvidenceHeads(ctx context.Context, configDir string, grant RootGrant, record LocalReconcileEvidence) error {
	previous, err := VerifyPreviousInventoryJournal(ctx, configDir, grant)
	if err != nil {
		return err
	}
	current, err := VerifyInventoryJournal(ctx, configDir, grant)
	if err != nil {
		return err
	}
	if previous.SnapshotName != record.PreviousSnapshot ||
		previous.SnapshotSHA256 != record.PreviousSHA256 ||
		previous.Items != record.PreviousItems ||
		current.SnapshotName != record.CurrentSnapshot ||
		current.SnapshotSHA256 != record.CurrentSHA256 ||
		current.Items != record.CurrentItems ||
		current.CompletedAt.Before(previous.CompletedAt) {
		return errors.New("local advisory evidence is stale or inventory generations changed")
	}
	return ctx.Err()
}

// LoadLocalReconcileEvidence is fail-closed on a stale revision, moved Root,
// changed/tampered snapshot, truncated manifest or private-scope mismatch.
// It does not authorize cloud writes even if it returns successfully.
func LoadLocalReconcileEvidence(ctx context.Context, configDir string, grant RootGrant, sourceRevision uint64) (LocalReconcileEvidence, error) {
	var empty LocalReconcileEvidence
	if ctx == nil || sourceRevision == 0 {
		return empty, errors.New("context and positive Source revision required")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	if err := VerifyRootGrant(grant); err != nil {
		return empty, err
	}
	dir, err := localEvidenceDirectory(configDir, grant)
	if err != nil {
		return empty, err
	}
	result, err := readLocalEvidence(dir, grant)
	if err != nil {
		return empty, err
	}
	if result.SourceRevision != sourceRevision {
		return empty, errors.New("local advisory evidence Source revision changed")
	}
	if err := verifyLocalEvidenceHeads(ctx, configDir, grant, result); err != nil {
		return empty, err
	}
	if err := VerifyRootGrant(grant); err != nil {
		return empty, err
	}
	return result, nil
}

// PublishLocalReconcileEvidence stores only a sealed, generation-bound SUMMARY
// after a complete SHA-256-verified delta. It never persists 100k candidate
// rows, sets SourceItem IDs, or publishes remote deletion/rename authority.
//
// A private O_EXCL directory lock rejects simultaneous writers. If a process
// crashes while holding it, reads of the last complete manifest still work,
// but publishing fails closed until operator-verified recovery of the lock.
func PublishLocalReconcileEvidence(ctx context.Context, configDir string, grant RootGrant, sourceRevision uint64) (LocalReconcileEvidence, error) {
	var empty LocalReconcileEvidence
	if ctx == nil || sourceRevision == 0 {
		return empty, errors.New("context and positive Source revision required")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	if err := VerifyRootGrant(grant); err != nil {
		return empty, err
	}
	dir, err := localEvidenceDirectory(configDir, grant)
	if err != nil {
		return empty, err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return empty, err
	}
	info, err := os.Lstat(dir)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return empty, errors.New("local advisory directory must not be a symlink")
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return empty, err
	}
	lockPath := filepath.Join(dir, localEvidenceLock)
	if err := os.Mkdir(lockPath, 0o700); err != nil {
		return empty, fmt.Errorf("local advisory publish already locked or unsafe: %w", err)
	}
	defer os.Remove(lockPath)

	prior, priorErr := readLocalEvidence(dir, grant)
	if priorErr != nil && !errors.Is(priorErr, os.ErrNotExist) {
		return empty, priorErr
	}
	if priorErr == nil && prior.SourceRevision > sourceRevision {
		return empty, errors.New("cannot overwrite a newer Source revision evidence")
	}
	// Callback never writes to disk or mutates any Source state. All verified
	// delta batches, count checks and Root checks must finish before publish.
	delta, err := StreamInventoryGenerationDelta(ctx, configDir, grant, maxInventoryBatchSize,
		func([]InventoryDeltaCandidate) error { return ctx.Err() })
	if err != nil {
		return empty, err
	}
	record := LocalReconcileEvidence{
		Version:              localEvidenceVersion,
		SourceID:             grant.SourceID,
		SourceRevision:       sourceRevision,
		RootID:               grant.RootID,
		DeviceID:             grant.DeviceID,
		RootFingerprint:      grant.Fingerprint,
		ScopeSHA256:          localEvidenceScope(grant),
		PreviousSnapshot:     delta.Previous.SnapshotName,
		PreviousSHA256:       delta.Previous.SnapshotSHA256,
		CurrentSnapshot:      delta.Current.SnapshotName,
		CurrentSHA256:        delta.Current.SnapshotSHA256,
		Added:                delta.Added,
		Changed:              delta.Changed,
		MetadataStable:       delta.MetadataStable,
		AbsentCandidates:     delta.AbsentCandidates,
		PreviousItems:        delta.Previous.Items,
		CurrentItems:         delta.Current.Items,
		PublishedAt:          time.Now().UTC(),
		MissingInferenceSafe: false,
		Authoritative:        false,
	}
	record.IntegritySHA256, err = evidenceSeal(record)
	if err != nil {
		return empty, err
	}
	if err := validateLocalEvidence(record, grant); err != nil {
		return empty, err
	}
	if err := verifyLocalEvidenceHeads(ctx, configDir, grant, record); err != nil {
		return empty, err
	}
	if priorErr == nil && prior.SourceRevision == sourceRevision &&
		prior.PreviousSnapshot == record.PreviousSnapshot &&
		prior.PreviousSHA256 == record.PreviousSHA256 &&
		prior.CurrentSnapshot == record.CurrentSnapshot &&
		prior.CurrentSHA256 == record.CurrentSHA256 {
		// Exact replay is idempotent, no manifest rewrite or new checkpoint.
		return prior, nil
	}
	data, err := json.Marshal(record)
	if err != nil || len(data) > localEvidenceMaxBytes {
		return empty, errors.New("local advisory manifest cannot be encoded within limit")
	}
	file, err := os.CreateTemp(dir, ".advisory-incomplete-*.tmp")
	if err != nil {
		return empty, err
	}
	defer os.Remove(file.Name())
	if err := file.Chmod(0o600); err != nil {
		_ = file.Close()
		return empty, err
	}
	if _, err := file.Write(data); err != nil {
		_ = file.Close()
		return empty, err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return empty, err
	}
	if err := file.Close(); err != nil {
		return empty, err
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	if err := verifyLocalEvidenceHeads(ctx, configDir, grant, record); err != nil {
		return empty, err
	}
	if err := os.Rename(file.Name(), filepath.Join(dir, localEvidenceFile)); err != nil {
		return empty, err
	}
	// Linux persists the directory rename as well. Windows uses the
	// existing xDrive file-sync + atomic-rename manifest convention.
	if runtime.GOOS == "linux" {
		directory, err := os.Open(dir)
		if err != nil {
			return empty, err
		}
		err = directory.Sync()
		_ = directory.Close()
		if err != nil {
			return empty, err
		}
	}
	return record, nil
}
