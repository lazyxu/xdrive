package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"

	"github.com/lazyxu/xdrive/internal/localpushwriter"
)

// localFirstFileDurableClaimPaths derives ONLY the same nonsecret, stable
// Server/account/Device/Source disk slots used by the current production
// Stage, operation-key and native Writer O_EXCL claims. Mutable login
// session, Root, target and revision intentionally do not change a slot.
// Never read a private request key, return these paths over IPC, or use a
// negative read as permission to create another writer.
func localFirstFileDurableClaimPaths(
	configDir string, key localPushFirstFileJobKey,
) ([3]string, error) {
	var empty [3]string
	if !key.valid() || !filepath.IsAbs(configDir) ||
		filepath.Clean(configDir) != configDir {
		return empty, errLocalBackupFirstFileUnavailable
	}
	// Use exactly the same production builders for every durable marker.
	// A naming change must never conceal an original uncertain upload.
	_, stagePath, operationPath, err := localPushStableClaimSlots(
		configDir, key.server, key.account, key.deviceID, key.sourceID)
	if err != nil {
		return empty, errLocalBackupFirstFileUnavailable
	}
	writerPath, err := localpushwriter.OriginalClaimPath(
		configDir, key.server, key.account, key.deviceID, key.sourceID)
	if err != nil {
		return empty, errLocalBackupFirstFileUnavailable
	}
	return [3]string{writerPath, stagePath, operationPath}, nil
}

// localFirstFileDurableClaimPresent checks only existence of original OS
// claims. Even a malformed, symlinked or incomplete file is uncertainty,
// never proof of COMMIT, cancellation, key retirement or an allowed retry.
// Unsafe claim types or private directory permissions produce an error and
// therefore an uncertain status; even absence is not upload admission.
// No file contents are opened, no directory is created and no secrets read.
func localFirstFileDurableClaimPresent(
	ctx context.Context, configDir string, key localPushFirstFileJobKey,
) (bool, error) {
	if ctx == nil || ctx.Err() != nil {
		return false, errLocalBackupFirstFileUnavailable
	}
	paths, err := localFirstFileDurableClaimPaths(configDir, key)
	if err != nil {
		return false, errLocalBackupFirstFileUnavailable
	}
	for _, path := range paths {
		for _, dir := range []string{configDir, filepath.Dir(filepath.Dir(path)), filepath.Dir(path)} {
			info, statErr := os.Lstat(dir)
			if errors.Is(statErr, os.ErrNotExist) {
				continue
			}
			if statErr != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 ||
				(runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0) {
				return false, errLocalBackupFirstFileUnavailable
			}
		}
		if ctx.Err() != nil {
			return false, errLocalBackupFirstFileUnavailable
		}
		info, statErr := os.Lstat(path)
		switch {
		case statErr == nil:
			// A directory, symlink/reparse point or permissive POSIX claim
			// is tampered evidence, never proof that the original slot is free.
			// This read remains non-authoritative even for a regular claim.
			if !info.Mode().IsRegular() ||
				(runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0) {
				return false, errLocalBackupFirstFileUnavailable
			}
			return true, nil
		case errors.Is(statErr, os.ErrNotExist):
			continue
		default:
			return false, errLocalBackupFirstFileUnavailable
		}
	}
	if ctx.Err() != nil {
		return false, errLocalBackupFirstFileUnavailable
	}
	return false, nil
}

// A persisted claim or an unreadable claim directory can downgrade only a
// process-local "not-recorded" result. It can NEVER manufacture "observed"
// or hide a current running/uncertain job. BackupComplete/RetirementSafe
// remain false. The original Agent OS/Server writer admission still fences
// every manual start even when no marker has been observed by this read.
func quarantineLocalFirstFileStatusByDurableClaim(
	view localBackupFirstFileJobStatus, exists bool, probeErr error,
) localBackupFirstFileJobStatus {
	if view.Phase == "not-recorded" && (exists || probeErr != nil) {
		view.Phase = "uncertain"
	}
	return view
}
