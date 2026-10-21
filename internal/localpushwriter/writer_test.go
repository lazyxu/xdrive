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

func TestOriginalClaimPathUsesExactLiveWriterSlotAndSeparatesOwners(t *testing.T) {
	s := testScope(t)
	path, err := OriginalClaimPath(s.configDir, s.server, s.account, s.deviceID, s.sourceID)
	if err != nil || path != s.path() {
		t.Fatalf("restart observer and physical Writer disagree: %s %s %v", path, s.path(), err)
	}
	if _, err := os.Lstat(path); !os.IsNotExist(err) {
		t.Fatalf("pure slot derivation unexpectedly touched disk: %v", err)
	}
	mutable := s
	mutable.sessionID = "another-session"
	mutable.rootID = "another-root"
	mutable.rootFingerprint = strings.Repeat("d", 64)
	mutable.revision++
	mutable.targetID++
	mutable.originalKey = strings.Repeat("e", 64)
	mutable.contentSHA256 = strings.Repeat("f", 64)
	if mutable.path() != path {
		t.Fatal("mutable Root/session/original escaped the permanent Writer claim")
	}
	for _, altered := range []func(*Scope){
		func(v *Scope) { v.server = "https://other.invalid" },
		func(v *Scope) { v.account = "another-owner" },
		func(v *Scope) { v.deviceID = "another-device" },
		func(v *Scope) { v.sourceID++ },
	} {
		foreign := s
		altered(&foreign)
		other, err := OriginalClaimPath(foreign.configDir, foreign.server, foreign.account,
			foreign.deviceID, foreign.sourceID)
		if err != nil || other == path {
			t.Fatalf("foreign owning source inherited original slot: %s %v", other, err)
		}
	}

	mustDeny := func(dir, server, account, device string, source uint64) {
		t.Helper()
		got, err := OriginalClaimPath(dir, server, account, device, source)
		if err == nil || got != "" {
			t.Fatalf("invalid recovery key derived private Writer path: %s %v", got, err)
		}
	}
	mustDeny("relative-dir", s.server, s.account, s.deviceID, s.sourceID)
	mustDeny(s.configDir+string(filepath.Separator)+"..", s.server, s.account, s.deviceID, s.sourceID)
	mustDeny(s.configDir, "wrong\nserver", s.account, s.deviceID, s.sourceID)
	mustDeny(s.configDir, s.server, "", s.deviceID, s.sourceID)
	mustDeny(s.configDir, s.server, s.account, "bad\ndevice", s.sourceID)
	mustDeny(s.configDir, s.server, s.account, s.deviceID, 0)
}
