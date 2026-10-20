package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/localpushrunner"
)

// Only a private, LOCAL diagnostic record of one previously verified first
// file. It is not a Server/native file-terminal receipt, SourceRun, success
// token, cancellation or authority to retire an operation key. Every field
// remains absent from JSON sent through public Agent IPC or Web.
const (
	localPushPositiveAuditVersion  = 1
	localPushPositiveAuditMaxBytes = 2048
)

type localPushPositiveAuditDisk struct {
	Version        int    `json:"version"`
	ScopeDigest    string `json:"scope_digest"`
	StageID        string `json:"stage_id"`
	OperationID    string `json:"operation_id"`
	Generation     uint64 `json:"generation"`
	State          string `json:"state"`
	ContentSHA256  string `json:"content_sha256"`
	SnapshotSHA256 string `json:"snapshot_sha256"`
	CurrentPathKey string `json:"current_path_key"`
	Size           int64  `json:"size"`
	ObservedAt     string `json:"observed_at"`
	MAC            string `json:"mac"`
}

func localPushPositiveAuditPath(configDir string, scope localPushRequestKeyScope) (string, string, error) {
	id, _, scopeDigest, err := localPushRequestKeyNames(configDir, scope)
	if err != nil {
		return "", "", errLocalPushDriverDenied
	}
	return filepath.Join(configDir, "localpush", "positive-audit", id+".json"), scopeDigest, nil
}

func localPushPositiveAuditMAC(record localPushPositiveAuditDisk, key localPushPrivateRequestKey) string {
	mac := hmac.New(sha256.New, key.bytes[:])
	fields := []string{
		"xdrive-localpush-positive-audit-v1", strconv.Itoa(record.Version),
		record.ScopeDigest, record.StageID, record.OperationID,
		strconv.FormatUint(record.Generation, 10), record.State,
		record.ContentSHA256, record.SnapshotSHA256, record.CurrentPathKey,
		strconv.FormatInt(record.Size, 10), record.ObservedAt,
	}
	_, _ = mac.Write([]byte(strings.Join(fields, "\x00")))
	return hex.EncodeToString(mac.Sum(nil))
}

// Read-only verification NEVER treats an earlier observation as current
// evidence. The caller must independently reauthenticate the current native
// Root, saved Stage, original SecretStore key and SQL/CAS before using it.
func readLocalPushPositiveAudit(ctx context.Context, d *localPushFirstLeafDriver,
	evidence localPushPrivateOriginalRecoveryEvidence,
) (localPushPositiveAuditDisk, error) {
	var empty localPushPositiveAuditDisk
	if d == nil || ctx == nil || ctx.Err() != nil ||
		d.localPushPriorEvidenceUnchanged(ctx, evidence) != nil {
		return empty, errLocalPushDriverDenied
	}
	// The on-disk MAC alone is historical: even private Agent reads must
	// reauthorize the exact CURRENT Server/account/session/Device/Root.
	bound := *d
	bound.key, bound.prepared, bound.stage, bound.bound =
		evidence.key, evidence.prepared, evidence.hint.Stage, true
	if bound.Check(ctx, bound.scope) != nil {
		return empty, errLocalPushDriverDenied
	}
	name, digest, err := localPushPositiveAuditPath(d.configDir, d.requestScope)
	if err != nil || !localPushStageAdmissionDirSafe(filepath.Dir(name)) {
		return empty, errLocalPushDriverDenied
	}
	stat, err := os.Lstat(name)
	if err != nil || !stat.Mode().IsRegular() || stat.Size() < 1 ||
		stat.Size() > localPushPositiveAuditMaxBytes ||
		(runtime.GOOS != "windows" && stat.Mode().Perm()&0o077 != 0) {
		return empty, errLocalPushDriverDenied
	}
	f, err := os.Open(name)
	if err != nil {
		return empty, errLocalPushDriverDenied
	}
	opened, statErr := f.Stat()
	if statErr != nil || !opened.Mode().IsRegular() || !os.SameFile(stat, opened) {
		_ = f.Close()
		return empty, errLocalPushDriverDenied
	}
	data, readErr := io.ReadAll(io.LimitReader(f, localPushPositiveAuditMaxBytes+1))
	closeErr := f.Close()
	if readErr != nil || closeErr != nil || len(data) == 0 || len(data) > localPushPositiveAuditMaxBytes {
		return empty, errLocalPushDriverDenied
	}
	var saved localPushPositiveAuditDisk
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&saved) != nil {
		return empty, errLocalPushDriverDenied
	}
	var trailing any
	if !errors.Is(decoder.Decode(&trailing), io.EOF) {
		return empty, errLocalPushDriverDenied
	}
	observed, timeErr := time.Parse(time.RFC3339Nano, saved.ObservedAt)
	if timeErr != nil || observed.IsZero() ||
		!strings.HasSuffix(saved.ObservedAt, "Z") ||
		observed.UTC().Format(time.RFC3339Nano) != saved.ObservedAt ||
		saved.Version != localPushPositiveAuditVersion ||
		saved.ScopeDigest != digest ||
		saved.StageID != evidence.hint.Stage.StageID ||
		saved.OperationID != evidence.prepared.operationID ||
		saved.Generation != evidence.prepared.generation ||
		saved.State != localPushPriorPhysicalCommitObserved ||
		saved.ContentSHA256 != evidence.hint.Stage.SHA256 ||
		saved.SnapshotSHA256 != evidence.hint.Stage.SnapshotSHA256 ||
		saved.CurrentPathKey != evidence.hint.Stage.CurrentPathKey ||
		saved.Size != evidence.hint.Stage.Size ||
		!hmac.Equal([]byte(saved.MAC), []byte(localPushPositiveAuditMAC(saved, evidence.key))) ||
		ctx.Err() != nil || d.localPushPriorEvidenceUnchanged(ctx, evidence) != nil {
		return empty, errLocalPushDriverDenied
	}
	return saved, nil
}

// appendLocalPushPositiveAudit accepts ONLY an independently observed
// positive original SQL/CAS+native result, and persists a MAC-bound local
// diagnostic marker. It is O_EXCL and fsynced, never overwritten or removed.
// In particular it does NOT authorize an operation-key retirement or new
// upload. Crash/ambiguous writes leave the private file quarantined.
func (d *localPushFirstLeafDriver) appendLocalPushPositiveAudit(
	ctx context.Context, evidence localPushPrivateOriginalRecoveryEvidence,
	outcome localPushPriorFirstLeafOutcome,
) error {
	if d == nil || ctx == nil || ctx.Err() != nil ||
		outcome.state != localPushPriorPhysicalCommitObserved ||
		outcome.operationID != evidence.prepared.operationID ||
		outcome.generation != evidence.prepared.generation ||
		d.localPushPriorEvidenceUnchanged(ctx, evidence) != nil {
		return errLocalPushDriverDenied
	}
	// Reuse the exact current private Driver checks: no stopped, revoked,
	// foreign or changed Source/Device/Root/session may mint a journal.
	bound := *d
	bound.key, bound.prepared, bound.stage, bound.bound =
		evidence.key, evidence.prepared, evidence.hint.Stage, true
	if bound.Check(ctx, bound.scope) != nil {
		return errLocalPushDriverDenied
	}
	name, digest, err := localPushPositiveAuditPath(d.configDir, d.requestScope)
	if err != nil {
		return errLocalPushDriverDenied
	}
	dir := filepath.Dir(name)
	if err := os.MkdirAll(dir, 0o700); err != nil ||
		!localPushStageAdmissionDirSafe(dir) {
		return errLocalPushDriverDenied
	}
	if _, err := os.Lstat(name); err == nil || !errors.Is(err, os.ErrNotExist) {
		// Exact original idempotent replay is read-only. A corrupt, partial,
		// foreign or different prior journal permanently blocks new writes.
		if _, readErr := readLocalPushPositiveAudit(ctx, d, evidence); readErr != nil {
			return errLocalPushDriverDenied
		}
		return nil
	}
	row := localPushPositiveAuditDisk{
		Version: localPushPositiveAuditVersion, ScopeDigest: digest,
		StageID:        evidence.hint.Stage.StageID,
		OperationID:    evidence.prepared.operationID,
		Generation:     evidence.prepared.generation,
		State:          localPushPriorPhysicalCommitObserved,
		ContentSHA256:  evidence.hint.Stage.SHA256,
		SnapshotSHA256: evidence.hint.Stage.SnapshotSHA256,
		CurrentPathKey: evidence.hint.Stage.CurrentPathKey,
		Size:           evidence.hint.Stage.Size,
		ObservedAt:     time.Now().UTC().Format(time.RFC3339Nano),
	}
	row.MAC = localPushPositiveAuditMAC(row, evidence.key)
	data, err := json.Marshal(row)
	if err != nil || len(data) > localPushPositiveAuditMaxBytes {
		return errLocalPushDriverDenied
	}
	f, err := os.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return errLocalPushDriverDenied
	}
	// An ambiguous fsync/write error never removes or overwrites the
	// original claimed slot. No transient file may be treated as success.
	n, writeErr := f.Write(data)
	if writeErr != nil || n != len(data) {
		_ = f.Close()
		return errLocalPushDriverDenied
	}
	syncErr := f.Sync()
	closeErr := f.Close()
	if syncErr != nil || closeErr != nil {
		return errLocalPushDriverDenied
	}
	if runtime.GOOS != "windows" {
		parent, err := os.Open(dir)
		if err != nil {
			return errLocalPushDriverDenied
		}
		syncErr := parent.Sync()
		closeErr := parent.Close()
		if syncErr != nil || closeErr != nil {
			return errLocalPushDriverDenied
		}
	}
	if _, err := readLocalPushPositiveAudit(ctx, d, evidence); err != nil ||
		bound.Check(ctx, bound.scope) != nil {
		return errLocalPushDriverDenied
	}
	return nil
}

// auditLocalPushPriorPhysicalCommitPrivate is an explicit, wholly UNROUTED,
// owning-Agent-only opt-in. Unlike the G2c2d1 READ-ONLY classifier, it
// appends a non-authoritative OS-private diagnostic record ONLY after the
// same original operation's independently verified physical SQL/CAS result.
// No Agent IPC, browser, foreign Desktop, background worker or SourceRun
// calls this method. The native grant mutex is held through the disk fsync.
func (c *agentController) auditLocalPushPriorPhysicalCommitPrivate(
	ctx context.Context, sourceID uint64,
	relativeLeaf, contentSHA256 string, size int64,
) error {
	if c == nil || ctx == nil || ctx.Err() != nil || sourceID == 0 ||
		!localPushFirstLeafNameValid(relativeLeaf) ||
		size < 0 || size > localpushrunner.MaxFirstLeafBytes ||
		!c.localFolderGrantMu.TryLock() {
		return errLocalPushDriverDenied
	}
	defer c.localFolderGrantMu.Unlock()
	first, err := c.newLocalPushFirstLeafDriverPrivate(ctx, sourceID, relativeLeaf, contentSHA256, size)
	if err != nil {
		return errLocalPushDriverDenied
	}
	original, err := first.readPriorFirstLeafOriginalEvidence(ctx, first.scope)
	if err != nil {
		return errLocalPushDriverDenied
	}
	verify, err := c.newLocalPushFirstLeafDriverPrivate(ctx, sourceID, relativeLeaf, contentSHA256, size)
	if err != nil {
		return errLocalPushDriverDenied
	}
	physical, err := verify.recoverPreviousFirstLeafReadOnly(ctx, verify.scope)
	if err != nil || !physical.Confirmed || physical.Uncertain || ctx.Err() != nil {
		return errLocalPushDriverDenied
	}
	final, err := c.newLocalPushFirstLeafDriverPrivate(ctx, sourceID, relativeLeaf, contentSHA256, size)
	if err != nil {
		return errLocalPushDriverDenied
	}
	evidence, err := final.readPriorFirstLeafOriginalEvidence(ctx, final.scope)
	if err != nil || !localPushSamePriorFirstLeafEvidence(original, evidence) {
		return errLocalPushDriverDenied
	}
	return final.appendLocalPushPositiveAudit(ctx, evidence, localPushPriorFirstLeafOutcome{
		state:       localPushPriorPhysicalCommitObserved,
		operationID: evidence.prepared.operationID,
		generation:  evidence.prepared.generation,
	})
}
