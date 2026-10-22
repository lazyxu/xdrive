package localpushwriter

import (
	"context"
	"crypto/subtle"
	"io"
	"os"
	"path/filepath"
	"runtime"
)

// WithHeldLiveOriginalWriterObservation executes a private Agent callback
// while the ORIGINAL physical Writer's kernel lock remains held. In contrast
// to historical recovery, this requires the same live *Claim returned by Begin.
// It rechecks the exact original pathname, descriptor/inode and secret-derived
// immutable marker BOTH before and after the callback. Close is serialized by
// the Claim mutex and cannot release the lock during observation.
//
// The callback must never call Claim.Close (it would deadlock), and MUST
// independently authenticate the current Root/Source/native original before
// using a remote transport. A local OS lock is NOT remote writer quiescence,
// durable physical COMMIT/CANCEL, permission to retry or Stage/key retirement.
// No disk marker, key, upload, SQL row or device authority is created here.
func WithHeldLiveOriginalWriterObservation(
	ctx context.Context, claim *Claim, scope Scope,
	observe func(context.Context) error,
) error {
	if ctx == nil || ctx.Err() != nil || claim == nil ||
		!scope.valid() || observe == nil {
		return ErrUnavailable
	}
	claim.mu.Lock()
	defer claim.mu.Unlock()
	if claim.file == nil {
		return ErrUnavailable
	}
	path := scope.path()
	dir := filepath.Dir(path)
	opened, err := claim.file.Stat()
	if err != nil || !opened.Mode().IsRegular() ||
		opened.Size() != int64(len(scope.marker())) ||
		(runtime.GOOS != "windows" && opened.Mode().Perm()&0o077 != 0) {
		return ErrUnavailable
	}
	verify := func() bool {
		if ctx.Err() != nil || !privateDirsSafe(scope.configDir, dir) {
			return false
		}
		current, err := os.Lstat(path)
		if err != nil || !current.Mode().IsRegular() ||
			current.Size() != int64(len(scope.marker())) ||
			(runtime.GOOS != "windows" && current.Mode().Perm()&0o077 != 0) ||
			!os.SameFile(opened, current) {
			return false
		}
		descriptor, err := claim.file.Stat()
		if err != nil || !descriptor.Mode().IsRegular() ||
			descriptor.Size() != int64(len(scope.marker())) ||
			!os.SameFile(opened, descriptor) {
			return false
		}
		if _, err := claim.file.Seek(0, io.SeekStart); err != nil {
			return false
		}
		actual, err := io.ReadAll(io.LimitReader(
			claim.file, int64(len(scope.marker())+1),
		))
		return err == nil &&
			subtle.ConstantTimeCompare(actual, []byte(scope.marker())) == 1 &&
			ctx.Err() == nil
	}
	if !verify() {
		return ErrUnavailable
	}
	if err := observe(ctx); err != nil || ctx.Err() != nil {
		return ErrUnavailable
	}
	if !verify() {
		return ErrUnavailable
	}
	return nil
}
