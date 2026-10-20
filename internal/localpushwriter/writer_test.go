package localpushwriter

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func testScope(t *testing.T) Scope {
	t.Helper()
	base := t.TempDir()
	config := filepath.Join(base, "configuration")
	root := filepath.Join(base, "originals")
	for _, d := range []string{config, root} {
		if err := os.Mkdir(d, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	s, err := NewScope(config, root, "https://example.invalid", "owner", "session",
		"device-id", "root-id", strings.Repeat("a", 64), 42, 3, 99,
		strings.Repeat("b", 64), strings.Repeat("c", 64))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestNativeWriterCrossProcessSlotNeverReused(t *testing.T) {
	s := testScope(t)
	claim, err := Begin(context.Background(), s)
	if err != nil {
		t.Fatal(err)
	}
	// Cleanup runs before testScope's TempDir cleanup even on a fatal assertion.
	// In particular, Windows cannot remove a file with an active LockFileEx.
	t.Cleanup(func() { _ = claim.Close() })
	if _, err := Begin(context.Background(), s); err == nil {
		t.Fatal("parallel writer admitted")
	}
	f, err := os.OpenFile(s.path(), os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	if lockNativeWriter(f) == nil {
		_ = unlockNativeWriter(f)
		_ = f.Close()
		t.Fatal("second file descriptor acquired live writer lock")
	}
	_ = f.Close()
	// Windows LockFileEx deliberately prohibits a second handle from reading
	// the exclusively locked range. Verify the persisted marker only AFTER the
	// original live writer has released its kernel lock, not before.
	if err := claim.Close(); err != nil {
		t.Fatal(err)
	}
	if err := claim.Close(); err != nil {
		t.Fatal("idempotent close failed", err)
	}
	data, err := os.ReadFile(s.path())
	if err != nil || string(data) != s.marker() {
		t.Fatalf("private immutable claim malformed after writer closed: %v", err)
	}
	if strings.Contains(string(data), "owner") || strings.Contains(string(data), "originals") {
		t.Fatal("marker leaked identity")
	}
	if _, err := Begin(context.Background(), s); err == nil {
		t.Fatal("post-exit write replay admitted")
	}
	// A released OS lock is NOT a physical-CANCEL terminal; only the marker
	// is consulted for admission and it remains durably quarantined.
	f, err = os.OpenFile(s.path(), os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := lockNativeWriter(f); err != nil {
		t.Fatal("kernel lock did not release", err)
	}
	_ = unlockNativeWriter(f)
	_ = f.Close()
}

func TestNativeWriterChangingRootSessionOrTargetCannotResetSlot(t *testing.T) {
	s := testScope(t)
	claim, err := Begin(context.Background(), s)
	if err != nil {
		t.Fatal(err)
	}
	defer claim.Close()
	other := s
	other.rootID = "replacement-root"
	other.sessionID = "replacement-session"
	other.revision++
	other.targetID++
	if s.path() != other.path() {
		t.Fatal("mutable binding changed source slot")
	}
	if _, err := Begin(context.Background(), other); err == nil {
		t.Fatal("mutable identity bypassed existing writer")
	}
}

func TestNativeWriterInvalidScopeAndCanceledDoNotCreateClaim(t *testing.T) {
	s := testScope(t)
	overlapped := s
	overlapped.rootPath = filepath.Join(s.configDir, "child")
	if _, err := Begin(context.Background(), overlapped); err == nil {
		t.Fatal("root/config overlap admitted")
	}
	invalid := s
	invalid.originalKey = "weak"
	if _, err := Begin(context.Background(), invalid); err == nil {
		t.Fatal("weak native identity admitted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Begin(ctx, s); err == nil {
		t.Fatal("canceled begin admitted")
	}
	if _, err := os.Lstat(s.path()); !os.IsNotExist(err) {
		t.Fatalf("canceled call created a claim: %v", err)
	}
}

func TestNativeWriterClaimNeverSerializesSecrets(t *testing.T) {
	s := testScope(t)
	data, err := json.Marshal(s)
	if err != nil || string(data) != "{}" {
		t.Fatalf("scope escaped into JSON: %s %v", data, err)
	}
}

func TestNativeWriterSymlinkedParentCannotCreateOutsideDirectory(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows junction classification requires separate native coverage")
	}
	s := testScope(t)
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(s.configDir, "localpush")); err != nil {
		t.Skipf("OS does not support symlink fixture: %v", err)
	}
	if _, err := Begin(context.Background(), s); err == nil {
		t.Fatal("preexisting symlink parent admitted")
	}
	if _, err := os.Lstat(filepath.Join(outside, "native-writers")); !os.IsNotExist(err) {
		t.Fatalf("created outside Agent private tree: %v", err)
	}
}
