// Package localpushwriter keeps the original one-shot native writer isolated.
// An idle OS lock observed here is LOCAL and instantaneous; it cannot attest
// remote HTTP/SQL/CAS physical cancellation or permit a new writer/key/Stage.
package localpushwriter

import (
	"context"
	"crypto/subtle"
	"io"
	"os"
	"path/filepath"
	"runtime"
)

// WithHeldOriginalWriterObservation permits a narrow, caller-supplied PRIVATE
// read-only observation while a nonblocking OS lock is held on the EXISTING
// immutable original writer claim. No claim, directory, Stage, request key,
// Server endpoint or terminal receipt is created, modified or retired.
//
// The caller MUST still separately prove current owner/device/Root,
// original immutable Operation/Stage/Key, SQL/CAS and remote physical state.
// The kernel lock alone, even after process death, is NEVER a physical-CANCEL
// witness, proof of SQL COMMIT, permission for retry, or safe key retirement.
// A callback returning nil grants no authority outside this lock lifetime.
func WithHeldOriginalWriterObservation(
	ctx context.Context, scope Scope, observe func(context.Context) error,
) (outErr error) {
	if ctx == nil || ctx.Err() != nil || !scope.valid() || observe == nil {
		return ErrUnavailable
	}
	path := scope.path()
	dir := filepath.Dir(path)
	if !privateDirsSafe(scope.configDir, dir) {
		return ErrUnavailable
	}
	expected := []byte(scope.marker())
	before, err := os.Lstat(path)
	if err != nil || !before.Mode().IsRegular() ||
		before.Size() != int64(len(expected)) ||
		(runtime.GOOS != "windows" && before.Mode().Perm()&0o077 != 0) {
		return ErrUnavailable
	}
	// Never use O_CREATE or O_TRUNC. O_RDWR is needed by native LockFileEx.
	f, err := os.OpenFile(path, os.O_RDWR, 0)
	if err != nil {
		return ErrUnavailable
	}
	defer func() {
		if err := f.Close(); err != nil {
			outErr = ErrUnavailable
		}
	}()
	opened, err := f.Stat()
	if err != nil || !opened.Mode().IsRegular() || !os.SameFile(before, opened) ||
		opened.Size() != int64(len(expected)) {
		return ErrUnavailable
	}
	if err := lockNativeWriter(f); err != nil {
		// Another process may still be writing or the lock is unusable.
		return ErrUnavailable
	}
	defer func() {
		if err := unlockNativeWriter(f); err != nil {
			outErr = ErrUnavailable
		}
	}()
	// Confirm the same exact O_EXCL marker both before and after the
	// observation, with the SAME kernel-locked descriptor throughout.
	verify := func() bool {
		if ctx.Err() != nil || !privateDirsSafe(scope.configDir, dir) {
			return false
		}
		current, err := os.Lstat(path)
		if err != nil || !current.Mode().IsRegular() ||
			current.Size() != int64(len(expected)) ||
			(runtime.GOOS != "windows" && current.Mode().Perm()&0o077 != 0) ||
			!os.SameFile(opened, current) {
			return false
		}
		st, err := f.Stat()
		if err != nil || !st.Mode().IsRegular() || !os.SameFile(opened, st) ||
			st.Size() != int64(len(expected)) {
			return false
		}
		if _, err := f.Seek(0, io.SeekStart); err != nil {
			return false
		}
		actual, err := io.ReadAll(io.LimitReader(f, int64(len(expected)+1)))
		return err == nil && subtle.ConstantTimeCompare(actual, expected) == 1 &&
			ctx.Err() == nil
	}
	if !verify() {
		return ErrUnavailable
	}
	if err := observe(ctx); err != nil || ctx.Err() != nil {
		// Do not propagate private callback/network errors from this
		// primitive into a future controller or local IPC.
		return ErrUnavailable
	}
	if !verify() {
		return ErrUnavailable
	}
	return nil
}
