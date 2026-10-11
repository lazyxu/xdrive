package transfer

import (
	"context"
	"errors"
	"testing"
	"time"
)

// A bound cancellation callback may synchronously inspect Task Center state.
// Clearing an account must not invoke that callback while holding Manager.mu,
// because the callback must be allowed to enter Snapshot before Clear returns.
func TestAccountClearBoundCancelCallbackCanReadSnapshot(t *testing.T) {
	manager := NewManager(8)
	handle := manager.Start(Spec{
		FileName:  "old-account-upload.bin",
		Kind:      KindUpload,
		Direction: "upload",
	})
	transportCtx, cancelTransport := context.WithCancel(context.Background())
	defer cancelTransport()

	callbackEntered := make(chan struct{})
	callbackCompleted := make(chan struct{})
	if !handle.BindCancel(func() {
		close(callbackEntered)
		// A cancellation callback may update status based on Manager state.
		// Calling Snapshot synchronously must not deadlock Clear.
		manager.Snapshot()
		cancelTransport()
		close(callbackCompleted)
	}) {
		t.Fatal("Agent-owned upload did not bind its cancellation callback")
	}

	clearCompleted := make(chan struct{})
	go func() {
		manager.Clear()
		close(clearCompleted)
	}()
	select {
	case <-callbackEntered:
	case <-time.After(10 * time.Second):
		t.Fatal("account Clear never invoked the bound cancellation callback")
	}
	select {
	case <-clearCompleted:
	case <-time.After(3 * time.Second):
		t.Fatal("account Clear deadlocked: cancellation callback cannot read Manager Snapshot")
	}
	select {
	case <-callbackCompleted:
	default:
		t.Fatal("Clear returned before its bound cancellation callback completed")
	}
	if !errors.Is(transportCtx.Err(), context.Canceled) {
		t.Fatalf("Clear did not cancel old-account transport: %v", transportCtx.Err())
	}
	if _, tasks := manager.Snapshot(); len(tasks) != 0 {
		t.Fatalf("old account tasks survived Clear: %+v", tasks)
	}
}
