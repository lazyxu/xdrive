package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushstage"
)

const localPushStageAdmissionClaimContents = "xdrive-localpush-stage-admission-v1\n"

var errLocalPushStageAdmissionUnavailable = errors.New("owning local backup Stage admission unavailable")

// Stable Server/account/Device/Source identity avoids a second operation
// when mutable session, Root, revision or target is replaced.
func localPushStageAdmissionClaimPath(configDir string, scope localPushRequestKeyScope) (string, error) {
	id, _, _, err := localPushRequestKeyNames(configDir, scope)
	if err != nil {
		return "", errLocalPushStageAdmissionUnavailable
	}
	return filepath.Join(configDir, "localpush", "stage-admissions", id+".claim"), nil
}

func localPushStageAdmissionDirSafe(dir string) bool {
	for _, path := range []string{filepath.Dir(filepath.Dir(dir)), filepath.Dir(dir), dir} {
		info, err := os.Lstat(path)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 ||
			(runtime.GOOS != "windows" && info.Mode().Perm()&0o077 != 0) {
			return false
		}
	}
	return true
}

// reserveFreshLocalPushStageAdmission allocates exactly one persistent
// owning-Agent Stage slot BEFORE native original bytes or HTTP staging.
// No ambiguous write error, lost ACK, cancellation or failed Stage may
// remove the claim; only a future verified file-terminal protocol may.
//
// O_EXCL is the local cross-process boundary. This is NOT a cross-host
// SQL COMMIT/cancel lease or authority to activate a SourceRun.
func reserveFreshLocalPushStageAdmission(
	ctx context.Context, configDir string, scope localPushRequestKeyScope, grant localpush.RootGrant,
) error {
	if ctx == nil || ctx.Err() != nil ||
		scope.server != grant.Server || scope.account != grant.Account ||
		scope.deviceID != grant.DeviceID || scope.sourceID != grant.SourceID ||
		scope.rootID != grant.RootID || scope.rootFingerprint != grant.Fingerprint {
		return fmt.Errorf("%w: invalid-scope", errLocalPushStageAdmissionUnavailable)
	}
	claim, err := localPushStageAdmissionClaimPath(configDir, scope)
	if err != nil {
		return fmt.Errorf("%w: claim-name", errLocalPushStageAdmissionUnavailable)
	}
	// A pre-upgrade Stage may have survived without this new OS claim.
	if err := localpushstage.RequireFreshLocalOriginalStageScope(ctx, configDir, grant); err != nil {
		return fmt.Errorf("%w: old-stage-scope", errLocalPushStageAdmissionUnavailable)
	}
	if err := requireFreshLocalPushOperationSlot(configDir, scope); err != nil {
		return fmt.Errorf("%w: old-operation-slot", errLocalPushStageAdmissionUnavailable)
	}
	dir := filepath.Dir(claim)
	if err := os.MkdirAll(dir, 0o700); err != nil || !localPushStageAdmissionDirSafe(dir) {
		return fmt.Errorf("%w: claim-directory", errLocalPushStageAdmissionUnavailable)
	}
	f, err := os.OpenFile(claim, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("%w: exclusive-create", errLocalPushStageAdmissionUnavailable)
	}
	if _, err := f.Write([]byte(localPushStageAdmissionClaimContents)); err != nil {
		_ = f.Close()
		return fmt.Errorf("%w: claim-write", errLocalPushStageAdmissionUnavailable)
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		return fmt.Errorf("%w: claim-fsync", errLocalPushStageAdmissionUnavailable)
	}
	if err := f.Close(); err != nil {
		return fmt.Errorf("%w: claim-close", errLocalPushStageAdmissionUnavailable)
	}
	// Persist directory entry on POSIX. On Windows we rely on exclusive
	// create and flushed claim, not a power-loss cross-host guarantee.
	if runtime.GOOS != "windows" {
		parent, openErr := os.Open(dir)
		if openErr != nil {
			return fmt.Errorf("%w: parent-open", errLocalPushStageAdmissionUnavailable)
		}
		syncErr := parent.Sync()
		closeErr := parent.Close()
		if syncErr != nil || closeErr != nil {
			return fmt.Errorf("%w: parent-fsync", errLocalPushStageAdmissionUnavailable)
		}
	}
	// A later ownership change blocks work but leaves the claim in place.
	if ctx.Err() != nil {
		return fmt.Errorf("%w: post-cancel", errLocalPushStageAdmissionUnavailable)
	}
	if !localPushStageAdmissionDirSafe(dir) {
		return fmt.Errorf("%w: post-claim-directory", errLocalPushStageAdmissionUnavailable)
	}
	if err := localpushstage.RequireFreshLocalOriginalStageScope(ctx, configDir, grant); err != nil {
		return fmt.Errorf("%w: post-stage-scope", errLocalPushStageAdmissionUnavailable)
	}
	if err := requireFreshLocalPushOperationSlot(configDir, scope); err != nil {
		return fmt.Errorf("%w: post-operation-slot", errLocalPushStageAdmissionUnavailable)
	}
	return nil
}
