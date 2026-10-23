//go:build linux || windows

package localpush

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/localpushcommon"
)

// ErrCommonUploadPlanQuarantined means the original file Operation might
// already have reached the Server. Never create a replacement Operation,
// discard its pending journal, or infer cancellation from this error.
var ErrCommonUploadPlanQuarantined = errors.New("original local Push file operation requires reconciliation")

const commonUploadPlanJournalVersion = 1
const commonUploadPlanJournalMaxBytes = 16 << 10

type commonUploadPlanRecord struct {
	Version        int                  `json:"version"`
	SnapshotSHA256 string               `json:"snapshot_sha256"`
	SessionDigest  string               `json:"session_digest"`
	ResumeKey      string               `json:"resume_key"`
	Plan           localpushcommon.Plan `json:"plan"`
}

// The raw account Session ID stays in userconfig/Agent memory, not a second
// plaintext copy in the file plan journal. This digest is an identity fence,
// not a substitute for current Server Owner/Device/Root authorization.
func commonUploadSessionDigest(value string) string {
	sum := sha256.Sum256([]byte("xdrive/localpush/owner-session/v1\x00" + value))
	return hex.EncodeToString(sum[:])
}

func commonUploadPlanJournalDir(configDir string, grant RootGrant) (string, error) {
	base, err := inventoryJournalDir(configDir, grant)
	if err != nil {
		return "", err
	}
	dir := filepath.Join(base, "common-upload-operations")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	info, err := os.Lstat(dir)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return "", ErrCommonUploadPlanQuarantined
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0 {
		return "", ErrCommonUploadPlanQuarantined
	}
	return dir, nil
}

func commonUploadPlanSlot(dir, relativePath string) string {
	sum := sha256.Sum256([]byte("xdrive/localpush/relative-file-slot/v1\x00" + relativePath))
	return filepath.Join(dir, "pending-"+hex.EncodeToString(sum[:])+".json")
}

func readCommonUploadPlanSlot(slot, session string) (commonUploadPlanRecord, localpushcommon.Plan, error) {
	var record commonUploadPlanRecord
	var empty localpushcommon.Plan
	info, err := os.Lstat(slot)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 ||
		info.Size() <= 0 || info.Size() > commonUploadPlanJournalMaxBytes ||
		(runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0) {
		return record, empty, ErrCommonUploadPlanQuarantined
	}
	f, err := os.Open(slot)
	if err != nil {
		return record, empty, ErrCommonUploadPlanQuarantined
	}
	defer f.Close()
	decoder := json.NewDecoder(io.LimitReader(f, commonUploadPlanJournalMaxBytes+1))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&record); err != nil {
		return commonUploadPlanRecord{}, empty, ErrCommonUploadPlanQuarantined
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) ||
		record.Version != commonUploadPlanJournalVersion ||
		record.Plan.OwnerSession != "" || session == "" ||
		record.SessionDigest != commonUploadSessionDigest(session) {
		return commonUploadPlanRecord{}, empty, ErrCommonUploadPlanQuarantined
	}
	plan := record.Plan
	plan.OwnerSession = session
	key, err := plan.ResumeKey()
	if err != nil || key != record.ResumeKey {
		return commonUploadPlanRecord{}, empty, ErrCommonUploadPlanQuarantined
	}
	return record, plan, nil
}

// PrepareVerifiedCommonUploadPlan owns only the LOCAL pre-HTTP checkpoint.
// It never sends bytes, mutates Server Source/Node/CAS, or grants SourceRun.
// The owner must independently validate current Server Source/Target revision
// and withhold this path when legacy Stage/Writer/SecretStore claims exist.
//
// Initial scope is deliberately one regular, strongly identified file in the
// Root's TOP LEVEL (64 MiB maximum); nested Source-target ACLs are not yet
// supported. One per-path slot cannot be replaced until a future audited
// original-Operation retirement implementation has been verified.
func PrepareVerifiedCommonUploadPlan(
	ctx context.Context, configDir string, grant RootGrant,
	ownerSession string, sourceRevision uint64, expectedSnapshotSHA256 string,
	relativePath string, target localpushcommon.Target,
) (localpushcommon.Plan, error) {
	var empty localpushcommon.Plan
	deny := func(err error) (localpushcommon.Plan, error) {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return empty, err
		}
		return empty, ErrCommonUploadPlanQuarantined
	}
	if ctx == nil {
		return deny(nil)
	}
	if err := ctx.Err(); err != nil {
		return deny(err)
	}
	if configDir == "" || ownerSession == "" || sourceRevision == 0 ||
		len(expectedSnapshotSHA256) != 64 ||
		relativePath == "" || path.Base(relativePath) != relativePath ||
		strings.ContainsAny(relativePath, "/\\:\x00\r\n") ||
		!grant.StrongIdentity {
		return deny(nil)
	}
	persisted, err := LoadRootGrant(configDir, grant.Server, grant.Account, grant.RootID)
	if err != nil || !sameLocalIdentityRoot(persisted, grant) {
		return deny(err)
	}
	var selected InventoryItem
	found := 0
	snapshot, err := StreamVerifiedInventoryJournal(
		ctx, configDir, grant, DefaultInventoryBatchSize,
		func(batch []InventoryItem) error {
			for _, item := range batch {
				if item.Path == relativePath {
					found++
					selected = item
					if found > 1 {
						return ErrCommonUploadPlanQuarantined
					}
				}
			}
			return ctx.Err()
		})
	if err != nil || found != 1 || snapshot.MissingInferenceSafe ||
		snapshot.SnapshotSHA256 != expectedSnapshotSHA256 ||
		selected.Kind != "file" || selected.Ignored ||
		selected.NativeIdentity == nil || !selected.NativeIdentity.Strong ||
		selected.NativeIdentity.LinkCount != 1 ||
		!selected.NativeIdentity.RenameCandidate || selected.Size < 0 ||
		selected.Size > 64<<20 {
		return deny(err)
	}
	digest, err := HashVerifiedInventoryFile(ctx, grant, selected, nil)
	if err != nil || digest.Path != relativePath ||
		digest.NativeIdentityKey != selected.NativeIdentity.Key ||
		digest.Size != selected.Size || len(digest.SHA256) != 64 {
		return deny(err)
	}
	candidate := localpushcommon.Plan{
		Server: grant.Server, Account: grant.Account, OwnerSession: ownerSession,
		DeviceID: grant.DeviceID, RootID: grant.RootID, RootFingerprint: grant.Fingerprint,
		SourceID: grant.SourceID, SourceRevision: sourceRevision,
		OperationID: uuid.NewString(), RelativePath: relativePath,
		NativeIdentityKey: digest.NativeIdentityKey,
		ContentSHA256:     digest.SHA256, Size: digest.Size, Target: target,
	}
	if err := candidate.Validate(); err != nil {
		return deny(err)
	}
	dir, err := commonUploadPlanJournalDir(configDir, grant)
	if err != nil {
		return deny(err)
	}
	slot := commonUploadPlanSlot(dir, relativePath)
	recoverOriginal := func() (localpushcommon.Plan, error) {
		record, prior, err := readCommonUploadPlanSlot(slot, ownerSession)
		if err != nil || record.SnapshotSHA256 != expectedSnapshotSHA256 {
			return deny(err)
		}
		comparable := candidate
		comparable.OperationID = prior.OperationID
		if comparable != prior {
			return deny(nil)
		}
		return prior, nil
	}
	if _, err := os.Lstat(slot); err == nil {
		return recoverOriginal()
	} else if !errors.Is(err, os.ErrNotExist) {
		return deny(err)
	}
	key, err := candidate.ResumeKey()
	if err != nil {
		return deny(err)
	}
	stored := candidate
	stored.OwnerSession = "" // never duplicate the raw authenticated session ID on disk
	record := commonUploadPlanRecord{
		Version:        commonUploadPlanJournalVersion,
		SnapshotSHA256: expectedSnapshotSHA256,
		SessionDigest:  commonUploadSessionDigest(ownerSession),
		ResumeKey:      key, Plan: stored,
	}
	data, err := json.Marshal(record)
	if err != nil || len(data) > commonUploadPlanJournalMaxBytes {
		return deny(err)
	}
	// O_EXCL is an atomic cross-process admission fence. A crash leaving a
	// truncated slot is quarantined, never silently replaced or retried with
	// another ID. No byte upload is allowed before Close+Sync completes.
	f, err := os.OpenFile(slot, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if errors.Is(err, os.ErrExist) {
		return recoverOriginal()
	}
	if err != nil {
		return deny(err)
	}
	n, writeErr := f.Write(append(data, '\n'))
	syncErr := f.Sync()
	closeErr := f.Close()
	if writeErr != nil || syncErr != nil || closeErr != nil || n != len(data)+1 {
		return deny(errors.New("original file plan checkpoint not durable"))
	}
	if runtime.GOOS != "windows" {
		d, err := os.Open(dir)
		if err != nil {
			return deny(err)
		}
		syncErr := d.Sync()
		_ = d.Close()
		if syncErr != nil {
			return deny(syncErr)
		}
	}
	after, err := VerifyInventoryJournal(ctx, configDir, grant)
	if err != nil || after.SnapshotSHA256 != expectedSnapshotSHA256 ||
		after.SnapshotName != snapshot.SnapshotName || ctx.Err() != nil {
		// Preserve the original slot for later reconciliation. Never delete it.
		return deny(err)
	}
	return recoverOriginal()
}
