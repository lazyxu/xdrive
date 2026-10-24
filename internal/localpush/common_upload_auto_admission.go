//go:build linux || windows

package localpush

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/google/uuid"
)

const (
	commonAutoAdmissionVersion = 1
	commonAutoAdmissionLimit   = 4 << 10
	commonAutoAdmissionMaxStep = 4
)

// This is only an advisory scheduling cooldown, NEVER a second task queue,
// a native Root grant, a Server receipt, or proof of physical cancellation.
// Its observed checkpoint already passed Source/Root/session verification.
type commonAutoAdmissionRecord struct {
	Version             int       `json:"version"`
	SourceID            uint64    `json:"source_id"`
	SourceRevision      uint64    `json:"source_revision"`
	RootFingerprint     string    `json:"root_fingerprint"`
	SessionDigest       string    `json:"session_digest"`
	CheckpointRunID     string    `json:"checkpoint_run_id"`
	CheckpointUpdatedAt time.Time `json:"checkpoint_updated_at"`
	AttemptAt           time.Time `json:"attempt_at"`
	NextAttemptAt       time.Time `json:"next_attempt_at"`
	Streak              int       `json:"streak"`
}

func commonAutoAdmissionDelay(streak int) time.Duration {
	if streak < 1 {
		streak = 1
	}
	if streak > commonAutoAdmissionMaxStep {
		streak = commonAutoAdmissionMaxStep
	}
	return 15 * time.Minute * time.Duration(1<<(streak-1))
}

func (r commonAutoAdmissionRecord) valid(grant RootGrant) bool {
	id, err := uuid.Parse(r.CheckpointRunID)
	if err != nil || id.String() != r.CheckpointRunID ||
		len(r.SessionDigest) != 64 {
		return false
	}
	// The stored session SHA-256 is never a token. Nevertheless, malformed
	// textual digests are corruption, NOT legitimate session rotation.
	decoded, err := hex.DecodeString(r.SessionDigest)
	if err != nil || len(decoded) != 32 {
		return false
	}
	return r.Version == commonAutoAdmissionVersion &&
		r.SourceID == grant.SourceID && r.SourceRevision != 0 &&
		r.RootFingerprint == grant.Fingerprint &&
		!r.CheckpointUpdatedAt.IsZero() && !r.AttemptAt.IsZero() &&
		!r.CheckpointUpdatedAt.After(r.AttemptAt) &&
		r.Streak >= 1 && r.Streak <= commonAutoAdmissionMaxStep &&
		r.NextAttemptAt.Equal(r.AttemptAt.Add(commonAutoAdmissionDelay(r.Streak)))
}

func commonAutoAdmissionPath(configDir string, grant RootGrant) (string, error) {
	dir, err := commonUploadPlanJournalDir(configDir, grant)
	if err != nil {
		return "", ErrCommonUploadPlanQuarantined
	}
	return filepath.Join(dir, "auto-admission-v1.json"), nil
}

func readCommonAutoAdmission(path string, grant RootGrant) (commonAutoAdmissionRecord, bool, error) {
	var empty commonAutoAdmissionRecord
	deny := ErrCommonUploadPlanQuarantined
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return empty, false, nil
	}
	if err != nil || !info.Mode().IsRegular() ||
		info.Mode()&os.ModeSymlink != 0 || info.Size() <= 0 ||
		info.Size() > commonAutoAdmissionLimit ||
		(runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0) {
		return empty, false, deny
	}
	f, err := os.Open(path)
	if err != nil {
		return empty, false, deny
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !opened.Mode().IsRegular() || !os.SameFile(info, opened) ||
		(runtime.GOOS != "windows" && opened.Mode().Perm()&0o077 != 0) {
		return empty, false, deny
	}
	decoder := json.NewDecoder(io.LimitReader(f, commonAutoAdmissionLimit+1))
	decoder.DisallowUnknownFields()
	var record commonAutoAdmissionRecord
	if err := decoder.Decode(&record); err != nil || !record.valid(grant) {
		return empty, false, deny
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return empty, false, deny
	}
	return record, true, nil
}

// ReserveVerifiedCommonAutoAdmission persists a bounded, Owner-private
// cooldown BEFORE asking the existing Runner to start. After Agent restart,
// the SAME verified checkpoint keeps its cooldown; a NEW trusted terminal
// checkpoint immediately resets it, even for an explicitly configured 1m
// schedule. This file can NEVER authorize a run or promote a state to partial.
func ReserveVerifiedCommonAutoAdmission(
	ctx context.Context, configDir string, grant RootGrant,
	session string, checkpoint CommonBatchCheckpoint, now time.Time,
) (bool, error) {
	deny := ErrCommonUploadPlanQuarantined
	if ctx == nil || ctx.Err() != nil || configDir == "" ||
		!grant.StrongIdentity || session == "" || now.IsZero() ||
		!checkpoint.valid(grant, session, checkpoint.SourceRevision) ||
		checkpoint.State != "partial" || checkpoint.UncertainFiles != 0 {
		return false, deny
	}
	current, err := LoadRootGrant(configDir, grant.Server, grant.Account, grant.RootID)
	if err != nil || !sameLocalIdentityRoot(current, grant) {
		return false, deny
	}
	// A well-formed in-memory checkpoint is not proof that the owning Agent
	// actually persisted that terminal run. Re-read the SAME current,
	// Root/Owner/session/revision-fenced checkpoint before changing admission
	// state, so an old/crafted value cannot silently reset cooldown.
	persisted, err := ReadVerifiedCommonBatchCheckpoint(ctx, configDir, grant,
		session, checkpoint.SourceRevision)
	if err != nil || persisted != checkpoint {
		return false, deny
	}
	path, err := commonAutoAdmissionPath(configDir, grant)
	if err != nil {
		return false, deny
	}
	prior, exists, err := readCommonAutoAdmission(path, grant)
	if err != nil {
		return false, deny // tampering, symlink or truncation never arm a run
	}
	streak := 1
	digest := commonUploadSessionDigest(session)
	if exists {
		sameCheckpoint := prior.SessionDigest == digest &&
			prior.SourceRevision == checkpoint.SourceRevision &&
			prior.CheckpointRunID == checkpoint.RunID &&
			prior.CheckpointUpdatedAt.Equal(checkpoint.UpdatedAt)
		if sameCheckpoint {
			if now.Before(prior.NextAttemptAt) {
				return false, nil
			}
			streak = prior.Streak + 1
			if streak > commonAutoAdmissionMaxStep {
				streak = commonAutoAdmissionMaxStep
			}
		} else {
			// A changed session digest, Source revision or RunID is NOT a
			// reset credential. Only a distinct authenticated terminal run
			// persisted AFTER the previous admission may reset cooldown.
			// In particular, structurally valid tampering cannot turn
			// the SAME older checkpoint into an immediately eligible run.
			if checkpoint.RunID == prior.CheckpointRunID ||
				!checkpoint.UpdatedAt.After(prior.AttemptAt) {
				return false, deny
			}
		}
	}
	record := commonAutoAdmissionRecord{
		Version: commonAutoAdmissionVersion, SourceID: grant.SourceID,
		SourceRevision:  checkpoint.SourceRevision,
		RootFingerprint: grant.Fingerprint, SessionDigest: digest,
		CheckpointRunID:     checkpoint.RunID,
		CheckpointUpdatedAt: checkpoint.UpdatedAt.UTC(),
		AttemptAt:           now.UTC(), Streak: streak,
		NextAttemptAt: now.UTC().Add(commonAutoAdmissionDelay(streak)),
	}
	if !record.valid(grant) {
		return false, deny
	}
	data, err := json.Marshal(record)
	if err != nil || len(data)+1 > commonAutoAdmissionLimit {
		return false, deny
	}
	dir := filepath.Dir(path)
	temp, err := os.CreateTemp(dir, ".auto-admission-")
	if err != nil {
		return false, deny
	}
	defer os.Remove(temp.Name())
	if err := temp.Chmod(0o600); err != nil {
		temp.Close()
		return false, deny
	}
	n, writeErr := temp.Write(append(data, '\n'))
	syncErr := temp.Sync()
	closeErr := temp.Close()
	if n != len(data)+1 || writeErr != nil || syncErr != nil ||
		closeErr != nil || ctx.Err() != nil {
		return false, deny
	}
	// An advisory record can race another owning Agent, but the existing
	// source-scoped OS lease and original SQL Operation still fence writes.
	info, statErr := os.Lstat(path)
	if statErr == nil {
		if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 ||
			(runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0) {
			return false, deny
		}
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return false, deny
	}
	if err := os.Rename(temp.Name(), path); err != nil {
		return false, deny
	}
	if runtime.GOOS != "windows" {
		parent, err := os.Open(dir)
		if err != nil {
			return false, deny
		}
		syncErr := parent.Sync()
		closeErr := parent.Close()
		if syncErr != nil || closeErr != nil {
			return false, deny
		}
	}
	return true, nil
}
