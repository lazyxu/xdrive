//go:build linux || windows

package localpush

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpushcommon"
)

// checkHeldCommonNativeFile checks the ORIGINAL securely opened OS descriptor,
// its still-current pathname, private Root grant and CURRENT Inventory. It
// hashes the SAME descriptor both before HTTP and after reconciliation. This
// is a native content fence, not a distributed physical-CANCEL claim.
func checkHeldCommonNativeFile(
	ctx context.Context, configDir string, grant RootGrant,
	snapshotSHA256 string, plan localpushcommon.Plan,
	file *os.File, opened os.FileInfo, versioned bool,
) error {
	deny := ErrCommonUploadPlanQuarantined
	if ctx == nil || ctx.Err() != nil || file == nil || opened == nil ||
		plan.Validate() != nil || (!versioned && plan.Size > 64<<20) ||
		grant.SourceID != plan.SourceID || grant.Server != plan.Server ||
		grant.Account != plan.Account || grant.DeviceID != plan.DeviceID ||
		grant.RootID != plan.RootID || grant.Fingerprint != plan.RootFingerprint {
		return deny
	}
	stored, err := LoadRootGrant(configDir, grant.Server, grant.Account, grant.RootID)
	if err != nil || !sameLocalIdentityRoot(stored, grant) {
		return deny
	}
	snapshot, err := VerifyInventoryJournal(ctx, configDir, grant)
	if err != nil || snapshot.MissingInferenceSafe ||
		snapshot.SnapshotSHA256 != snapshotSHA256 {
		return deny
	}

	full := filepath.Join(grant.Path, filepath.FromSlash(plan.RelativePath))
	pathInfo, pathErr := os.Lstat(full)
	fdInfo, fdErr := file.Stat()
	if pathErr != nil || fdErr != nil ||
		!pathInfo.Mode().IsRegular() || pathInfo.Mode()&os.ModeSymlink != 0 ||
		!fdInfo.Mode().IsRegular() || fdInfo.Size() != plan.Size ||
		!os.SameFile(pathInfo, fdInfo) || !os.SameFile(opened, fdInfo) ||
		!opened.ModTime().UTC().Equal(fdInfo.ModTime().UTC()) {
		return deny
	}
	native, err := readInventoryNativeIdentity(grant.RootID, full, pathInfo)
	if err != nil || native == nil || !native.Strong ||
		native.LinkCount != 1 || !native.RenameCandidate ||
		native.Key != plan.NativeIdentityKey {
		return deny
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return deny
	}
	digest := sha256.New()
	n, err := io.CopyBuffer(digest, &contextReader{ctx: ctx, r: file},
		make([]byte, localFileHashBufferSize))
	if err != nil || n != plan.Size ||
		hex.EncodeToString(digest.Sum(nil)) != plan.ContentSHA256 {
		return deny
	}
	afterFD, fdErr := file.Stat()
	afterPath, pathErr := os.Lstat(full)
	if fdErr != nil || pathErr != nil ||
		!afterPath.Mode().IsRegular() || afterPath.Mode()&os.ModeSymlink != 0 ||
		!os.SameFile(afterFD, opened) || !os.SameFile(afterFD, afterPath) ||
		afterFD.Size() != plan.Size ||
		!afterFD.ModTime().UTC().Equal(opened.ModTime().UTC()) {
		return deny
	}
	// The path and Root might change during hashing, and a journal generation
	// might be replaced during upload. Recheck after the complete fd digest.
	stored, err = LoadRootGrant(configDir, grant.Server, grant.Account, grant.RootID)
	if err != nil || !sameLocalIdentityRoot(stored, grant) {
		return deny
	}
	after, err := VerifyInventoryJournal(ctx, configDir, grant)
	if err != nil || after.MissingInferenceSafe ||
		after.SnapshotName != snapshot.SnapshotName ||
		after.SnapshotSHA256 != snapshotSHA256 {
		return deny
	}
	return nil
}

// UploadVerifiedCommonNativeOne is an owning-Agent-private, single-file
// execution bridge. It only accepts a Plan already persisted by
// PrepareVerifiedCommonUploadPlan, never a renderer-provided path or invented
// Operation ID. The ordinary /uploads writer remains the only byte writer.
//
// This helper is NOT yet called by any Desktop IPC or background SourceRun.
// The old Stage/Key/Writer admission stays quarantined, and there is no
// authorization for a second file or automatic backup.
func UploadVerifiedCommonNativeOne(
	ctx context.Context, configDir string, grant RootGrant,
	expectedSnapshotSHA256 string, plan localpushcommon.Plan,
	api localpushcommon.DurableTransport, proof client.LocalBoundSourceProof,
	progress client.UploadProgress,
) (client.LocalPushCommonUploadReceipt, error) {
	return uploadVerifiedCommonNativeOne(ctx, configDir, grant,
		expectedSnapshotSHA256, plan, api, proof, progress, false)
}

// UploadVerifiedCommonNativeVersionedOne uses the same securely held native
// descriptor and ordinary /uploads transport as the original first-file
// bridge, with the append-only per-target-revision local task journal.
func UploadVerifiedCommonNativeVersionedOne(
	ctx context.Context, configDir string, grant RootGrant,
	expectedSnapshotSHA256 string, plan localpushcommon.Plan,
	api localpushcommon.DurableTransport, proof client.LocalBoundSourceProof,
	progress client.UploadProgress,
) (client.LocalPushCommonUploadReceipt, error) {
	return uploadVerifiedCommonNativeOne(ctx, configDir, grant,
		expectedSnapshotSHA256, plan, api, proof, progress, true)
}

func uploadVerifiedCommonNativeOne(
	ctx context.Context, configDir string, grant RootGrant,
	expectedSnapshotSHA256 string, plan localpushcommon.Plan,
	api localpushcommon.DurableTransport, proof client.LocalBoundSourceProof,
	progress client.UploadProgress, versioned bool,
) (client.LocalPushCommonUploadReceipt, error) {
	var zero client.LocalPushCommonUploadReceipt
	if ctx == nil || ctx.Err() != nil || api == nil ||
		plan.Validate() != nil || (!versioned && plan.Size > 64<<20) ||
		proof.DeviceID != grant.DeviceID || proof.DeviceToken == "" ||
		proof.RootID != grant.RootID || proof.RootFingerprint != grant.Fingerprint {
		return zero, ErrCommonUploadPlanQuarantined
	}
	var original localpushcommon.Plan
	var err error
	if versioned {
		original, err = PrepareVerifiedCommonUploadVersionedPlan(ctx, configDir, grant,
			plan.OwnerSession, plan.SourceRevision, expectedSnapshotSHA256,
			plan.RelativePath, plan.Target)
	} else {
		original, err = PrepareVerifiedCommonUploadPlan(ctx, configDir, grant,
			plan.OwnerSession, plan.SourceRevision, expectedSnapshotSHA256,
			plan.RelativePath, plan.Target)
	}
	if err != nil || original != plan {
		return zero, ErrCommonUploadPlanQuarantined
	}
	// Keep exactly this OS handle open for prehash, offset streaming, and
	// posthash. Never reopen from a caller-supplied path after HTTP starts.
	file, err := openRootScopedRegularFile(grant, plan.RelativePath)
	if err != nil {
		return zero, ErrCommonUploadPlanQuarantined
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || checkHeldCommonNativeFile(ctx, configDir, grant,
		expectedSnapshotSHA256, plan, file, opened, versioned) != nil {
		return zero, ErrCommonUploadPlanQuarantined
	}
	opens := 0
	open := func(openCtx context.Context, offset int64) (io.ReadCloser, error) {
		if openCtx == nil || openCtx.Err() != nil || ctx.Err() != nil ||
			opens != 0 || offset < 0 || offset > plan.Size {
			return nil, ErrCommonUploadPlanQuarantined
		}
		// There may be a network round trip (admit + bind) between the first
		// prehash and the first byte. Revalidate before exposing that byte.
		if err := checkHeldCommonNativeFile(openCtx, configDir, grant,
			expectedSnapshotSHA256, plan, file, opened, versioned); err != nil {
			return nil, err
		}
		if _, err := file.Seek(offset, io.SeekStart); err != nil {
			return nil, ErrCommonUploadPlanQuarantined
		}
		opens++
		// The ordinary uploader calls Close after Finalize. A nop closer
		// keeps the original descriptor alive for our mandatory posthash.
		return io.NopCloser(&contextReader{ctx: openCtx, r: file}), nil
	}
	receipt, uploadErr := localpushcommon.UploadDurableOne(ctx, api, proof,
		localpushcommon.Task{Plan: plan, Open: open}, progress)
	postErr := checkHeldCommonNativeFile(ctx, configDir, grant,
		expectedSnapshotSHA256, plan, file, opened, versioned)
	if uploadErr != nil || postErr != nil || ctx.Err() != nil {
		// A remote immutable COMMIT may already exist even if posthash
		// detects local mutation. Never retry using a different Operation.
		return zero, localpushcommon.ErrUncertain
	}
	return receipt, nil
}
