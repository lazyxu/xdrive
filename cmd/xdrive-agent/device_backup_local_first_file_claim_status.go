package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strconv"

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
	source := strconv.FormatUint(key.sourceID, 10)
	identity := key.server + "\x00" + key.account + "\x00" + key.deviceID + "\x00" + source
	requestHash := sha256.Sum256([]byte("xdrive-localpush-request-slot-v1\x00" + identity))
	requestID := "local-push-request-" + hex.EncodeToString(requestHash[:16])
	// Use the actual production native Writer slot algorithm instead of
	// copying its hash/prefix: a future Writer naming change must not make
	// a surviving original appear absent after Agent restart.
	writerPath, err := localpushwriter.OriginalClaimPath(
		configDir, key.server, key.account, key.deviceID, key.sourceID)
	if err != nil {
		return empty, errLocalBackupFirstFileUnavailable
	}
	root := filepath.Join(configDir, "localpush")
	return [3]string{
		writerPath,
		filepath.Join(root, "stage-admissions", requestID+".claim"),
		filepath.Join(root, "operation-requests", requestID+".claim"),
	}, nil
}

// localFirstFileDurableClaimPresent checks only existence of original OS
// claims. Even a malformed, symlinked or incomplete file is uncertainty,
// never proof of COMMIT, cancellation, key retirement or an allowed retry.
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
			if statErr != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
				return false, errLocalBackupFirstFileUnavailable
			}
		}
		if ctx.Err() != nil {
			return false, errLocalBackupFirstFileUnavailable
		}
		_, statErr := os.Lstat(path)
		switch {
		case statErr == nil:
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
