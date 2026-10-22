package localpushwriter

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestOriginalQuarantineReadOnlyExactScopeAndTamper(t *testing.T) {
	s := testScope(t)
	if err := ReadOriginalWriterQuarantine(context.Background(), s); err == nil {
		t.Fatal("missing native marker was treated as recovery evidence")
	}
	if _, err := os.Lstat(s.path()); !os.IsNotExist(err) {
		t.Fatalf("read-only observation created a claim: %v", err)
	}
	claim, err := Begin(context.Background(), s)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = claim.Close() })
	if err := claim.Close(); err != nil {
		t.Fatal(err)
	}
	if err := ReadOriginalWriterQuarantine(context.Background(), s); err != nil {
		t.Fatal("exact retained original marker was not readable:", err)
	}
	changed := s
	changed.sessionID = "new-session"
	if changed.path() != s.path() {
		t.Fatal("mutable session created a different Source slot")
	}
	if err := ReadOriginalWriterQuarantine(context.Background(), changed); err == nil {
		t.Fatal("changed original session was accepted as the original marker")
	}
	changed = s
	changed.targetID++
	if err := ReadOriginalWriterQuarantine(context.Background(), changed); err == nil {
		t.Fatal("changed target was accepted as the original marker")
	}
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if err := ReadOriginalWriterQuarantine(canceled, s); err == nil {
		t.Fatal("canceled observation accepted")
	}
	if err := os.WriteFile(s.path(), []byte(s.marker()+"extra"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := ReadOriginalWriterQuarantine(context.Background(), s); err == nil {
		t.Fatal("extended/malformed marker granted historical evidence")
	}
	if _, err := Begin(context.Background(), s); err == nil {
		t.Fatal("historical read or marker tamper reset the O_EXCL writer fence")
	}
}

func TestOriginalQuarantineReadOnlyRejectsSymlinkAndPublicPermissions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX symlink and mode checks; Windows native process crash covered separately")
	}
	s := testScope(t)
	claim, err := Begin(context.Background(), s)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = claim.Close() })
	if err := claim.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(s.path(), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := ReadOriginalWriterQuarantine(context.Background(), s); err == nil {
		t.Fatal("publicly readable native marker accepted")
	}
	if err := os.Chmod(s.path(), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := ReadOriginalWriterQuarantine(context.Background(), s); err != nil {
		t.Fatal("safe private marker should be readable:", err)
	}
	outside := filepath.Join(t.TempDir(), "outside")
	if err := os.WriteFile(outside, []byte(s.marker()), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(s.path()); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, s.path()); err != nil {
		t.Skipf("OS does not allow symlink fixture: %v", err)
	}
	if err := ReadOriginalWriterQuarantine(context.Background(), s); err == nil {
		t.Fatal("symlinked immutable writer marker accepted")
	}
}

func TestOriginalQuarantinePostReadRejectsSameContentReplacedMarker(t *testing.T) {
	if runtime.GOOS == "windows" {
		// Windows may deny renaming an open file. Native Windows writer
		// crash/release tests independently cover the persistent O_EXCL slot.
		t.Skip("renaming an open original descriptor is platform-specific")
	}
	s := testScope(t)
	claim, err := Begin(context.Background(), s)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = claim.Close() })
	if err := claim.Close(); err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(s.path())
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil {
		t.Fatal(err)
	}
	size := int64(len(s.marker()))
	if !originalWriterPathMatchesOpenedAfterRead(context.Background(), s, f, opened, size) {
		t.Fatal("unchanged original marker was rejected")
	}
	oldPath := s.path() + ".previous"
	if err := os.Rename(s.path(), oldPath); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(s.path(), []byte(s.marker()), 0o600); err != nil {
		t.Fatal(err)
	}
	// Bytes and length are identical, but a new file is not the original
	// held native writer claim. This must fail without changing either file.
	if originalWriterPathMatchesOpenedAfterRead(context.Background(), s, f, opened, size) {
		t.Fatal("same-content replaced marker passed original descriptor check")
	}
	if err := os.Remove(s.path()); err != nil {
		t.Fatal(err)
	}
	if originalWriterPathMatchesOpenedAfterRead(context.Background(), s, f, opened, size) {
		t.Fatal("missing original path passed post-read identity check")
	}
	body, err := os.ReadFile(oldPath)
	if err != nil || string(body) != s.marker() {
		t.Fatalf("original immutable marker was modified: %v", err)
	}
}
