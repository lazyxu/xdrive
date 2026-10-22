package localpushwriter

import (
	"context"
	"crypto/subtle"
	"io"
	"os"
	"path/filepath"
	"runtime"
)

// ReadOriginalWriterQuarantine checks one exact previously persisted native
// O_EXCL marker using only the original Agent-private immutable Scope. This is
// a read-only historical correlation check: even a positive match proves NO
// remote HTTP quiescence, physical-CANCEL, SQL COMMIT, or safe Stage/key reuse.
// Missing, corrupt, replaced or inaccessible markers always fail closed.
func ReadOriginalWriterQuarantine(ctx context.Context, scope Scope) error {
	if ctx == nil || ctx.Err() != nil || !scope.valid() {
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
	f, err := os.Open(path)
	if err != nil {
		return ErrUnavailable
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !opened.Mode().IsRegular() || !os.SameFile(before, opened) ||
		opened.Size() != int64(len(expected)) {
		return ErrUnavailable
	}
	// Never read arbitrary-size or user-controlled files from a replaced
	// marker path. No marker bytes or identity fields leave this package.
	actual, err := io.ReadAll(io.LimitReader(f, int64(len(expected)+1)))
	if err != nil || subtle.ConstantTimeCompare(actual, expected) != 1 ||
		ctx.Err() != nil {
		return ErrUnavailable
	}
	// A same-content path replacement after Open must not allow the
	// historical native marker read to be reported as original evidence.
	// This is read-only correlation, NEVER physical COMMIT/CANCEL authority.
	if !originalWriterPathMatchesOpenedAfterRead(ctx, scope, f, opened, int64(len(expected))) {
		return ErrUnavailable
	}
	return nil
}

// originalWriterPathMatchesOpenedAfterRead rechecks both the private parent
// and the exact on-disk identity after reading the original descriptor.
// Same contents at a different inode/path are not the original claim.
// This cannot prove anything about future replacements or remote writers.
func originalWriterPathMatchesOpenedAfterRead(
	ctx context.Context, scope Scope, f *os.File, opened os.FileInfo, expectedSize int64,
) bool {
	if ctx == nil || ctx.Err() != nil || f == nil || opened == nil ||
		!privateDirsSafe(scope.configDir, filepath.Dir(scope.path())) {
		return false
	}
	atPath, err := os.Lstat(scope.path())
	if err != nil || !atPath.Mode().IsRegular() || atPath.Size() != expectedSize ||
		(runtime.GOOS != "windows" && atPath.Mode().Perm()&0o077 != 0) ||
		!os.SameFile(opened, atPath) {
		return false
	}
	stillOpen, err := f.Stat()
	return err == nil && stillOpen.Mode().IsRegular() &&
		stillOpen.Size() == expectedSize && os.SameFile(opened, stillOpen) &&
		ctx.Err() == nil
}
