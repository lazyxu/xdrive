//go:build linux || windows

package localpush

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

const commonBatchHistoryLimit = 64
const commonBatchHistoryReadLimit = 20

// History is a bounded owner-private observation of completed Agent attempts.
// It never replaces immutable per-file SQL Operations, proves physical CAS,
// or authorizes cleanup, retries, or deletion.
func commonBatchHistoryDir(configDir string, grant RootGrant) (string, error) {
	base, err := commonUploadPlanJournalDir(configDir, grant)
	if err != nil {
		return "", ErrCommonUploadPlanQuarantined
	}
	dir := filepath.Join(base, "run-history")
	if err := os.Mkdir(dir, 0o700); err != nil && !errors.Is(err, os.ErrExist) {
		return "", ErrCommonUploadPlanQuarantined
	}
	info, err := os.Lstat(dir)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 ||
		(runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0) {
		return "", ErrCommonUploadPlanQuarantined
	}
	return dir, nil
}

func commonBatchHistoryRecordName(runID string) string {
	return "run-" + runID + ".json"
}

func readCommonBatchHistoryRecord(path string, grant RootGrant, session string) (CommonBatchCheckpoint, error) {
	deny := ErrCommonUploadPlanQuarantined
	var zero CommonBatchCheckpoint
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 ||
		info.Size() <= 0 || info.Size() > commonBatchCheckpointLimit ||
		(runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0) {
		return zero, deny
	}
	f, err := os.Open(path)
	if err != nil {
		return zero, deny
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !opened.Mode().IsRegular() || !os.SameFile(info, opened) ||
		(runtime.GOOS != "windows" && opened.Mode().Perm()&0o077 != 0) {
		return zero, deny
	}
	decoder := json.NewDecoder(io.LimitReader(f, commonBatchCheckpointLimit+1))
	decoder.DisallowUnknownFields()
	var record CommonBatchCheckpoint
	if err := decoder.Decode(&record); err != nil ||
		!record.valid(grant, session, record.SourceRevision) ||
		record.State == "running" || record.RunID == "" ||
		filepath.Base(path) != commonBatchHistoryRecordName(record.RunID) {
		return zero, deny
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return zero, deny
	}
	return record, nil
}

func readCommonBatchHistory(ctx context.Context, dir string, grant RootGrant, session string) ([]CommonBatchCheckpoint, error) {
	deny := ErrCommonUploadPlanQuarantined
	if ctx == nil || ctx.Err() != nil {
		return nil, deny
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) > commonBatchHistoryLimit+16 {
		return nil, deny
	}
	out := make([]CommonBatchCheckpoint, 0, len(entries))
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		name := entry.Name()
		if strings.HasPrefix(name, ".history-pending-") {
			continue // orphaned temporary file can never become a trusted run
		}
		if !strings.HasPrefix(name, "run-") || !strings.HasSuffix(name, ".json") {
			return nil, deny
		}
		p, err := readCommonBatchHistoryRecord(filepath.Join(dir, name), grant, session)
		if err != nil {
			return nil, deny
		}
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool {
		if !out[i].UpdatedAt.Equal(out[j].UpdatedAt) {
			return out[i].UpdatedAt.After(out[j].UpdatedAt)
		}
		return out[i].RunID > out[j].RunID
	})
	return out, nil
}

// AppendVerifiedCommonBatchHistory publishes an immutable terminal attempt
// atomically. The Source lease serializes writers, while hard-link publication
// never overwrites an older run after a crash or lost ACK.
func AppendVerifiedCommonBatchHistory(ctx context.Context, configDir string,
	grant RootGrant, session string, record CommonBatchCheckpoint,
) error {
	deny := ErrCommonUploadPlanQuarantined
	if ctx == nil || ctx.Err() != nil || session == "" ||
		!record.valid(grant, session, record.SourceRevision) ||
		record.State == "running" {
		return deny
	}
	current, err := LoadRootGrant(configDir, grant.Server, grant.Account, grant.RootID)
	if err != nil || !sameLocalIdentityRoot(current, grant) {
		return deny
	}
	dir, err := commonBatchHistoryDir(configDir, grant)
	if err != nil {
		return deny
	}
	data, err := json.Marshal(record)
	if err != nil || len(data) == 0 || len(data)+1 > commonBatchCheckpointLimit {
		return deny
	}
	data = append(data, '\n')
	target := filepath.Join(dir, commonBatchHistoryRecordName(record.RunID))
	temp, err := os.CreateTemp(dir, ".history-pending-")
	if err != nil {
		return deny
	}
	defer os.Remove(temp.Name())
	if err := temp.Chmod(0o600); err != nil {
		temp.Close()
		return deny
	}
	n, writeErr := temp.Write(data)
	syncErr := temp.Sync()
	closeErr := temp.Close()
	if n != len(data) || writeErr != nil || syncErr != nil ||
		closeErr != nil || ctx.Err() != nil {
		return deny
	}
	if err := os.Link(temp.Name(), target); err != nil {
		if !errors.Is(err, os.ErrExist) {
			return deny
		}
		// Idempotent same-run replay, but never replace a different receipt.
		existing, readErr := readCommonBatchHistoryRecord(target, grant, session)
		raw, contentErr := os.ReadFile(target)
		if readErr != nil || contentErr != nil || existing.RunID != record.RunID ||
			!bytes.Equal(raw, data) {
			return deny
		}
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
	items, err := readCommonBatchHistory(ctx, dir, grant, session)
	if err != nil {
		return deny
	}
	if len(items) > commonBatchHistoryLimit {
		for _, old := range items[commonBatchHistoryLimit:] {
			if err := os.Remove(filepath.Join(dir, commonBatchHistoryRecordName(old.RunID))); err != nil {
				return deny
			}
		}
	}
	return nil
}

// ReconcileVerifiedCommonBatchHistoryBeforeRun closes the crash window where
// the latest checkpoint was fsynced but immutable history was not yet linked.
// A stale running checkpoint is archived as UNCERTAIN only after the Source's
// cross-process lease is acquired; this does not assert remote cancellation.
func ReconcileVerifiedCommonBatchHistoryBeforeRun(ctx context.Context,
	configDir string, grant RootGrant, session string, revision uint64,
) error {
	deny := ErrCommonUploadPlanQuarantined
	if ctx == nil || ctx.Err() != nil || session == "" || revision == 0 {
		return deny
	}
	dest, err := commonBatchCheckpointPath(configDir, grant)
	if err != nil {
		return deny
	}
	if _, err := os.Lstat(dest); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return deny
	}
	checkpoint, err := ReadVerifiedCommonBatchCheckpoint(ctx, configDir, grant, session, revision)
	if err != nil {
		return deny
	}
	if checkpoint.State == "running" {
		checkpoint.State = "uncertain"
		if checkpoint.UncertainFiles == 0 {
			checkpoint.UncertainFiles = 1
		}
		checkpoint.UpdatedAt = time.Now().UTC()
		if err := StoreVerifiedCommonBatchCheckpoint(
			ctx, configDir, grant, session, revision, checkpoint,
		); err != nil {
			return deny
		}
	}
	return AppendVerifiedCommonBatchHistory(ctx, configDir, grant, session, checkpoint)
}

// ListVerifiedCommonBatchHistory returns at most 20 redacted, terminal runs
// after verifying the current Root grant and owning account session.
func ListVerifiedCommonBatchHistory(ctx context.Context, configDir string,
	grant RootGrant, session string,
) ([]CommonBatchCheckpoint, error) {
	deny := ErrCommonUploadPlanQuarantined
	if ctx == nil || ctx.Err() != nil || session == "" || !grant.StrongIdentity {
		return nil, deny
	}
	current, err := LoadRootGrant(configDir, grant.Server, grant.Account, grant.RootID)
	if err != nil || !sameLocalIdentityRoot(current, grant) {
		return nil, deny
	}
	dir, err := commonBatchHistoryDir(configDir, grant)
	if err != nil {
		return nil, deny
	}
	items, err := readCommonBatchHistory(ctx, dir, grant, session)
	if err != nil {
		return nil, err
	}
	if len(items) > commonBatchHistoryReadLimit {
		items = items[:commonBatchHistoryReadLimit]
	}
	return items, nil
}
