package transfer

import (
	"context"
	"errors"
	"testing"
	"time"
)

func waitRetryRaceSignal(t *testing.T, ch <-chan struct{}, label string) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(10 * time.Second):
		t.Fatalf("timed out waiting for %s", label)
	}
}

func waitRetryRaceResult(t *testing.T, ch <-chan error, label string) error {
	t.Helper()
	select {
	case result := <-ch:
		return result
	case <-time.After(10 * time.Second):
		t.Fatalf("timed out waiting for %s", label)
		return nil
	}
}

// A user cancellation that reaches a running retry's real context must not
// be reported as a new failed transfer. This must hold when the retry callback
// returns context.Canceled after its owned transport has stopped.
func TestCancelDuringRetryPreservesCancelledTerminalState(t *testing.T) {
	manager := NewManager(10)
	retryStarted := make(chan struct{})
	retryDone := make(chan error, 1)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	h := manager.Start(Spec{
		FileName: "retrying-upload.bin", Kind: KindUpload, Direction: "upload",
		TotalBytes: 100,
		Retry: func(ctx context.Context) error {
			close(retryStarted)
			<-ctx.Done()
			return ctx.Err()
		},
	})
	h.Fail(errors.New("temporary upload failure"))
	go func() {
		retryDone <- manager.Retry(ctx, h.ID())
	}()
	waitRetryRaceSignal(t, retryStarted, "retry start")
	if !h.BindCancel(cancel) {
		t.Fatal("active retry could not bind its owned cancellation context")
	}
	if err := manager.Cancel(h.ID()); err != nil {
		t.Fatalf("cancel active retry: %v", err)
	}
	if err := waitRetryRaceResult(t, retryDone, "cancelled retry completion"); !errors.Is(err, context.Canceled) {
		t.Fatalf("retry error=%v, want context.Canceled", err)
	}
	_, tasks := manager.Snapshot()
	if len(tasks) != 1 || tasks[0].State != StateCancelled || tasks[0].Cancelable || tasks[0].CompletedAt == nil {
		t.Fatalf("cancelled retry incorrectly changed terminal state: %+v", tasks)
	}
}

// An old retry callback must never regress the terminal cancellation already
// committed by the owning operation, even if that callback returns nil later.
func TestLateRetryReturnCannotOverwriteConfirmedCancellation(t *testing.T) {
	manager := NewManager(10)
	retryStarted := make(chan struct{})
	allowOldRetryReturn := make(chan struct{})
	retryDone := make(chan error, 1)
	defer func() {
		select {
		case <-allowOldRetryReturn:
		default:
			close(allowOldRetryReturn)
		}
	}()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	h := manager.Start(Spec{
		FileName: "retrying-download.bin", Kind: KindDownload, Direction: "download",
		TotalBytes: 100,
		Retry: func(context.Context) error {
			close(retryStarted)
			<-allowOldRetryReturn
			return nil
		},
	})
	h.Fail(errors.New("temporary download failure"))
	go func() {
		retryDone <- manager.Retry(ctx, h.ID())
	}()
	waitRetryRaceSignal(t, retryStarted, "retry start")
	if !h.BindCancel(cancel) {
		t.Fatal("active retry could not bind its owned cancellation context")
	}
	if err := manager.Cancel(h.ID()); err != nil {
		t.Fatalf("cancel active retry: %v", err)
	}
	if err := h.Finish(StateCancelled, context.Canceled); err != nil {
		t.Fatalf("original I/O owner could not confirm cancellation: %v", err)
	}
	close(allowOldRetryReturn)
	if err := waitRetryRaceResult(t, retryDone, "late retry callback"); err != nil {
		t.Fatalf("late retry returned error=%v, want nil from callback", err)
	}
	_, tasks := manager.Snapshot()
	if len(tasks) != 1 || tasks[0].State != StateCancelled || tasks[0].Cancelable || tasks[0].CompletedAt == nil {
		t.Fatalf("late retry callback overwrote committed cancellation: %+v", tasks)
	}
}
