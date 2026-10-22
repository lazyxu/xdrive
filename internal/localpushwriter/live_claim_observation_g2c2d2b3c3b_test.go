package localpushwriter

import (
	"context"
	"errors"
	"os"
	"runtime"
	"testing"
)

func TestLiveClaimHoldsOriginalKernelLockAcrossPrivateObservation(t *testing.T) {
	s := testScope(t)
	claim, err := Begin(context.Background(), s)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = claim.Close() })
	called := 0
	err = WithHeldLiveOriginalWriterObservation(context.Background(), claim, s,
		func(ctx context.Context) error {
			called++
			if ctx.Err() != nil {
				return ctx.Err()
			}
			// A second descriptor cannot acquire the original live kernel
			// lock during the callback (Linux flock / Windows LockFileEx).
			other, err := os.OpenFile(s.path(), os.O_RDWR, 0)
			if err == nil {
				defer other.Close()
				if err := lockNativeWriter(other); err == nil {
					_ = unlockNativeWriter(other)
					t.Fatal("live original Writer lock released during callback")
				}
			} else if runtime.GOOS != "windows" {
				t.Fatal(err)
			}
			return nil
		})
	if err != nil || called != 1 {
		t.Fatalf("live originally locked callback unavailable: calls=%d err=%v", called, err)
	}
	if _, err := Begin(context.Background(), s); err == nil {
		t.Fatal("live callback reopened one-shot writer slot")
	}
	foreign := s
	foreign.sessionID = "different-session"
	wasCalled := false
	if err := WithHeldLiveOriginalWriterObservation(context.Background(), claim, foreign,
		func(context.Context) error { wasCalled = true; return nil }); err == nil || wasCalled {
		t.Fatal("different session reused original native Writer lock")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := WithHeldLiveOriginalWriterObservation(ctx, claim, s,
		func(context.Context) error { wasCalled = true; return nil }); err == nil || wasCalled {
		t.Fatal("canceled callback bypassed original writer")
	}
	sentinel := errors.New("private failure")
	err = WithHeldLiveOriginalWriterObservation(context.Background(), claim, s,
		func(context.Context) error { return sentinel })
	if err == nil || errors.Is(err, sentinel) {
		t.Fatal("private callback error escaped while live Writer held")
	}
	if err := claim.Close(); err != nil {
		t.Fatal(err)
	}
	if err := WithHeldLiveOriginalWriterObservation(context.Background(), claim, s,
		func(context.Context) error { t.Fatal("closed Writer admitted"); return nil }); err == nil {
		t.Fatal("closed writer allowed live original proof")
	}
	if b, err := os.ReadFile(s.path()); err != nil || string(b) != s.marker() {
		t.Fatalf("immutable original writer claim changed: %v", err)
	}
}

func TestLiveClaimRejectsTamperedOrReplacedPrivateMarker(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows immutable writer lock prevents portable path-replacement fixture")
	}
	s := testScope(t)
	claim, err := Begin(context.Background(), s)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = claim.Close() })
	calls := 0
	if err := os.WriteFile(s.path(), []byte("tampered"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := WithHeldLiveOriginalWriterObservation(context.Background(), claim, s,
		func(context.Context) error { calls++; return nil }); err == nil || calls != 0 {
		t.Fatal("tampered original marker received native writer attestation")
	}
	if err := claim.Close(); err != nil {
		t.Fatal(err)
	}
	// Use a distinct original claim to prove post-Open path replacement is
	// also denied even if the replacement contains the exact same bytes.
	second := testScope(t)
	active, err := Begin(context.Background(), second)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = active.Close() })
	previous := second.path() + ".previous"
	if err := os.Rename(second.path(), previous); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(second.path(), []byte(second.marker()), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := WithHeldLiveOriginalWriterObservation(context.Background(), active, second,
		func(context.Context) error { calls++; return nil }); err == nil || calls != 0 {
		t.Fatal("identical-content inode replacement accepted while original lock held")
	}
	if b, err := os.ReadFile(previous); err != nil || string(b) != second.marker() {
		t.Fatalf("original O_EXCL marker was modified: %v", err)
	}
}
