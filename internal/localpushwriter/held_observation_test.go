package localpushwriter

import (
	"context"
	"errors"
	"os"
	"runtime"
	"testing"
)

func TestHeldOriginalWriterObservationRequiresHistoricalMarkerAndNoLiveWriter(t *testing.T) {
	s := testScope(t)
	var observations int
	observe := func(context.Context) error { observations++; return nil }
	if err := WithHeldOriginalWriterObservation(context.Background(), s, observe); err == nil {
		t.Fatal("missing original claim was accepted")
	}
	if _, err := os.Lstat(s.path()); !os.IsNotExist(err) {
		t.Fatalf("read-only observation created the original writer claim: %v", err)
	}
	claim, err := Begin(context.Background(), s)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = claim.Close() })
	if err := WithHeldOriginalWriterObservation(context.Background(), s, observe); err == nil {
		t.Fatal("live original Writer OS lock treated as released")
	}
	if observations != 0 {
		t.Fatal("callback ran without exclusive original OS lock")
	}
	if err := claim.Close(); err != nil {
		t.Fatal(err)
	}
	if err := WithHeldOriginalWriterObservation(context.Background(), s, observe); err != nil {
		t.Fatalf("exact original claim unavailable under released OS lock: %v", err)
	}
	if observations != 1 {
		t.Fatalf("exact original callback called %d times", observations)
	}
	if err := ReadOriginalWriterQuarantine(context.Background(), s); err != nil {
		t.Fatal("read-only held observation mutated original marker:", err)
	}
	if _, err := Begin(context.Background(), s); err == nil {
		t.Fatal("held observation granted a second physical writer")
	}
}

func TestHeldOriginalWriterObservationRejectsWrongScopeCancelAndCallbackErrors(t *testing.T) {
	s := testScope(t)
	claim, err := Begin(context.Background(), s)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = claim.Close() })
	if err := claim.Close(); err != nil {
		t.Fatal(err)
	}
	runs := 0
	observe := func(context.Context) error { runs++; return nil }
	changed := s
	changed.sessionID = "changed-login"
	if err := WithHeldOriginalWriterObservation(context.Background(), changed, observe); err == nil {
		t.Fatal("changed original session accepted")
	}
	changed = s
	changed.targetID++
	if err := WithHeldOriginalWriterObservation(context.Background(), changed, observe); err == nil {
		t.Fatal("changed original target accepted")
	}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if err := WithHeldOriginalWriterObservation(cancelled, s, observe); err == nil {
		t.Fatal("cancelled observation accepted")
	}
	if err := WithHeldOriginalWriterObservation(context.Background(), s, nil); err == nil {
		t.Fatal("nil callback accepted")
	}
	if runs != 0 {
		t.Fatal("unauthorized callback executed")
	}
	if err := WithHeldOriginalWriterObservation(context.Background(), s,
		func(context.Context) error { return errors.New("private /home/owner/secret") }); err == nil ||
		err.Error() != ErrUnavailable.Error() {
		t.Fatal("private callback failure was exported or accepted")
	}
	if err := WithHeldOriginalWriterObservation(context.Background(), s,
		func(ctx context.Context) error { return ctx.Err() }); err != nil {
		t.Fatal("read-only callback failed on valid original")
	}
}

func TestHeldOriginalWriterObservationRejectsTamperAndSymlink(t *testing.T) {
	s := testScope(t)
	claim, err := Begin(context.Background(), s)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = claim.Close() })
	if err := claim.Close(); err != nil {
		t.Fatal(err)
	}
	runs := 0
	check := func(context.Context) error { runs++; return nil }
	if err := os.WriteFile(s.path(), []byte(s.marker()+"bad"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := WithHeldOriginalWriterObservation(context.Background(), s, check); err == nil {
		t.Fatal("corrupt original marker accepted")
	}
	if runs != 0 {
		t.Fatal("callback ran for corrupted marker")
	}
	if runtime.GOOS == "windows" {
		return
	}
	// os.WriteFile does NOT change permissions on an existing O_EXCL marker.
	// Restore exact contents first, then explicitly widen the fixture mode.
	if err := os.WriteFile(s.path(), []byte(s.marker()), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(s.path(), 0o644); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Lstat(s.path()); err != nil || info.Mode().Perm() != 0o644 {
		t.Fatalf("public mode test fixture was not established: %v", err)
	}
	if err := WithHeldOriginalWriterObservation(context.Background(), s, check); err == nil {
		t.Fatal("public original marker accepted")
	}
	if err := os.Remove(s.path()); err != nil {
		t.Fatal(err)
	}
	outside := s.rootPath + "/outside-marker"
	if err := os.WriteFile(outside, []byte(s.marker()), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, s.path()); err != nil {
		t.Skipf("OS cannot create test symlink: %v", err)
	}
	if err := WithHeldOriginalWriterObservation(context.Background(), s, check); err == nil {
		t.Fatal("symlinked original marker accepted")
	}
	if runs != 0 {
		t.Fatal("callback ran on altered original marker")
	}
}
