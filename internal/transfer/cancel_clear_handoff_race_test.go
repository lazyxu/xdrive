package transfer

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// An explicit Cancel hands the transport cancel callback out of the Manager lock.
// If an account Clear begins while that callback is still in flight, Clear must
// not return while the old account's transport remains uncancelled.
func TestConcurrentCancelAndAccountClearWaitForTransportCancellation(t *testing.T) {
	manager := NewManager(8)
	handle := manager.Start(Spec{
		FileName: "old-account-upload.bin",
		Kind:     KindUpload, Direction: "upload",
	})
	transportCtx, cancelTransport := context.WithCancel(context.Background())
	defer cancelTransport()

	cancelEntered := make(chan struct{})
	releaseCancellation := make(chan struct{})
	var enteredOnce sync.Once
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(releaseCancellation) }) }
	defer release()
	if !handle.BindCancel(func() {
		enteredOnce.Do(func() { close(cancelEntered) })
		<-releaseCancellation
		cancelTransport()
	}) {
		t.Fatal("old account upload did not bind its transport cancellation")
	}

	cancelDone := make(chan error, 1)
	go func() { cancelDone <- manager.Cancel(handle.ID()) }()
	select {
	case <-cancelEntered:
	case <-time.After(10 * time.Second):
		t.Fatal("Cancel did not enter the real transport callback")
	}

	clearStarted := make(chan struct{})
	clearDone := make(chan struct{})
	go func() {
		close(clearStarted)
		manager.Clear()
		close(clearDone)
	}()
	<-clearStarted

	// Cancellation is intentionally held in its actual callback, after
	// Cancel released the Manager lock. With a correct handoff, Clear must
	// join or independently invoke that callback before returning.
	returnedWithoutCancelling := false
	select {
	case <-clearDone:
		returnedWithoutCancelling = !errors.Is(transportCtx.Err(), context.Canceled)
	case <-time.After(300 * time.Millisecond):
		// Clear is still waiting for the pending cancellation to finish.
	}
	release()
	select {
	case <-clearDone:
	case <-time.After(10 * time.Second):
		t.Fatal("account Clear did not finish after transport cancellation")
	}
	select {
	case err := <-cancelDone:
		if err != nil {
			t.Fatalf("Cancel returned %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("concurrent Cancel did not finish")
	}
	if returnedWithoutCancelling {
		t.Fatal("Clear returned while old account transport was still alive: Cancel detached its callback before invoking it")
	}
	if err := transportCtx.Err(); !errors.Is(err, context.Canceled) {
		t.Fatalf("old account upload transport was not cancelled: %v", err)
	}
	if _, tasks := manager.Snapshot(); len(tasks) != 0 {
		t.Fatalf("Clear left old account tasks visible: %+v", tasks)
	}
}
