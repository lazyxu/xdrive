//go:build linux || windows

package localpush

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/google/uuid"
)

const commonBatchCheckpointVersion = 1
const commonBatchCheckpointLimit = 4 << 10

// CommonBatchCheckpoint records a bounded, redacted owning-Agent run summary.
// Per-file original Operations are the ACTUAL durable queue; this snapshot
// only supports progress after IPC detach or an Agent restart. A stored
// running state from an old process is NEVER evidence of a completed backup.
type CommonBatchCheckpoint struct {
	Version            int       `json:"version"`
	RunID              string    `json:"run_id"`
	SourceID           uint64    `json:"source_id"`
	SourceRevision     uint64    `json:"source_revision"`
	RootFingerprint    string    `json:"root_fingerprint"`
	SessionDigest      string    `json:"session_digest"`
	State              string    `json:"state"`
	InspectedFiles     int64     `json:"inspected_files"`
	ConfirmedFiles     int64     `json:"confirmed_files"`
	SkippedFiles       int64     `json:"skipped_files"`
	UnsupportedFiles   int64     `json:"unsupported_files"`
	UncertainFiles     int64     `json:"uncertain_files"`
	ConfirmedBytes     int64     `json:"confirmed_bytes"`
	UpdatedAt          time.Time `json:"updated_at"`
	BackupComplete     bool      `json:"backup_complete"`
	RetirementSafe     bool      `json:"retirement_safe"`
	CurrentCASVerified bool      `json:"current_cas_verified"`
}

func (p CommonBatchCheckpoint) valid(grant RootGrant, session string, revision uint64) bool {
	id, err := uuid.Parse(p.RunID)
	if err != nil || id.String() != p.RunID || p.Version != commonBatchCheckpointVersion ||
		p.SourceID != grant.SourceID || p.SourceRevision != revision ||
		p.RootFingerprint != grant.Fingerprint ||
		p.SessionDigest != commonUploadSessionDigest(session) ||
		p.BackupComplete || p.RetirementSafe || p.CurrentCASVerified ||
		p.UpdatedAt.IsZero() || revision == 0 {
		return false
	}
	if p.State != "running" && p.State != "partial" && p.State != "uncertain" &&
		p.State != "paused" && p.State != "cancelled" {
		return false
	}
	if p.InspectedFiles < 0 || p.ConfirmedFiles < 0 || p.SkippedFiles < 0 ||
		p.UnsupportedFiles < 0 || p.UncertainFiles < 0 || p.ConfirmedBytes < 0 ||
		p.ConfirmedFiles > p.InspectedFiles ||
		p.SkippedFiles > p.InspectedFiles-p.ConfirmedFiles ||
		p.UnsupportedFiles > p.InspectedFiles-p.ConfirmedFiles-p.SkippedFiles {
		return false
	}
	return true
}

func commonBatchCheckpointPath(configDir string, grant RootGrant) (string, error) {
	dir, err := commonUploadPlanJournalDir(configDir, grant)
	if err != nil {
		return "", ErrCommonUploadPlanQuarantined
	}
	return filepath.Join(dir, "latest-batch-run.json"), nil
}

// StoreVerifiedCommonBatchCheckpoint uses the existing private Root journal
// directory, never a user backup Root. A rename after fsync publishes a
// complete status atomically. Failure MUST stop scheduling further files.
func StoreVerifiedCommonBatchCheckpoint(ctx context.Context, configDir string,
	grant RootGrant, session string, revision uint64,
	summary CommonBatchCheckpoint,
) error {
	deny := ErrCommonUploadPlanQuarantined
	if ctx == nil || ctx.Err() != nil || !grant.StrongIdentity ||
		session == "" || !summary.valid(grant, session, revision) {
		return deny
	}
	stored, err := LoadRootGrant(configDir, grant.Server, grant.Account, grant.RootID)
	if err != nil || !sameLocalIdentityRoot(stored, grant) {
		return deny
	}
	dest, err := commonBatchCheckpointPath(configDir, grant)
	if err != nil {
		return deny
	}
	// Existing status can be overwritten only via rename of a new regular
	// private file; never follow a symlink during open/read.
	info, statErr := os.Lstat(dest)
	if statErr == nil {
		if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 ||
			(runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0) {
			return deny
		}
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return deny
	}
	data, err := json.Marshal(summary)
	if err != nil || len(data) == 0 || len(data) > commonBatchCheckpointLimit {
		return deny
	}
	dir := filepath.Dir(dest)
	f, err := os.CreateTemp(dir, ".batch-checkpoint-")
	if err != nil {
		return deny
	}
	temp := f.Name()
	defer os.Remove(temp)
	_, writeErr := f.Write(append(data, '\n'))
	syncErr := f.Sync()
	closeErr := f.Close()
	if writeErr != nil || syncErr != nil || closeErr != nil || ctx.Err() != nil {
		return deny
	}
	if err := os.Rename(temp, dest); err != nil {
		return deny
	}
	if runtime.GOOS != "windows" {
		parent, err := os.Open(dir)
		if err != nil {
			return deny
		}
		syncErr := parent.Sync()
		closeErr := parent.Close()
		if syncErr != nil || closeErr != nil {
			return deny
		}
	}
	return nil
}

// ReadVerifiedCommonBatchCheckpoint requires a CURRENT local private Root
// grant and active Owner session. The persisted status is not a Server receipt
// and must never grant upload authority or prove a complete SourceRun.
func ReadVerifiedCommonBatchCheckpoint(ctx context.Context, configDir string,
	grant RootGrant, session string, revision uint64,
) (CommonBatchCheckpoint, error) {
	var zero CommonBatchCheckpoint
	deny := ErrCommonUploadPlanQuarantined
	if ctx == nil || ctx.Err() != nil || !grant.StrongIdentity || session == "" || revision == 0 {
		return zero, deny
	}
	stored, err := LoadRootGrant(configDir, grant.Server, grant.Account, grant.RootID)
	if err != nil || !sameLocalIdentityRoot(stored, grant) {
		return zero, deny
	}
	dest, err := commonBatchCheckpointPath(configDir, grant)
	if err != nil {
		return zero, deny
	}
	info, err := os.Lstat(dest)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 ||
		info.Size() <= 0 || info.Size() > commonBatchCheckpointLimit ||
		(runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0) {
		return zero, deny
	}
	f, err := os.Open(dest)
	if err != nil {
		return zero, deny
	}
	defer f.Close()
	decoder := json.NewDecoder(io.LimitReader(f, commonBatchCheckpointLimit+1))
	decoder.DisallowUnknownFields()
	var result CommonBatchCheckpoint
	if err := decoder.Decode(&result); err != nil || !result.valid(grant, session, revision) {
		return zero, deny
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) ||
		ctx.Err() != nil {
		return zero, deny
	}
	return result, nil
}
