package transfer

import (
	"context"
	"errors"
	"testing"
	"time"
)

// An Agent-owned upload group closes its cancellable context on normal
// terminalization. The cancellation callback may synchronously inspect Task
// Center status; calling it while holding Manager.mu must not deadlock Finish.
func TestUploadGroupFinishCancelCallbackCanReenterSnapshot(t *testing.T) {
	manager := NewManager(8)
	group := manager.StartGroup(Spec{
		FileName:   "completed-folder",
		Kind:       KindUpload,
		Direction:  "upload",
		TotalItems: 1,
		TotalBytes: 100,
	})
	transportCtx, cancelTransport := context.WithCancel(context.Background())
	defer cancelTransport()

	callbackEntered := make(chan struct{})
	callbackCompleted := make(chan struct{})
	if !group.BindGroupCancelContext(transportCtx, func() {
		close(callbackEntered)
		// A Context cancellation callback can reenter Task Center to inspect
		// the finished group before it releases the old transport owner.
		manager.Snapshot()
		cancelTransport()
		close(callbackCompleted)
	}) {
		t.Fatal("upload group did not bind its Agent-owned cancel callback")
	}

	finishDone := make(chan error, 1)
	go func() { finishDone <- group.Finish(StateCompleted, nil) }()
	select {
	case <-callbackEntered:
	case <-time.After(10 * time.Second):
		t.Fatal("Finish did not invoke upload group cancellation callback")
	}
	select {
	case err := <-finishDone:
		if err != nil {
			t.Fatalf("Finish failed: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Finish deadlocked: group cancel callback cannot reenter Manager.Snapshot")
	}
	select {
	case <-callbackCompleted:
	default:
		t.Fatal("Finish returned before the group cancellation callback completed")
	}
	if !errors.Is(transportCtx.Err(), context.Canceled) {
		t.Fatalf("Finish left completed group's transport context alive: %v", transportCtx.Err())
	}
	_, tasks := manager.Snapshot()
	if len(tasks) != 1 || tasks[0].State != StateCompleted || tasks[0].Cancelable || tasks[0].CompletedAt == nil {
		t.Fatalf("normal group Finish did not commit its terminal state: %+v", tasks)
	}
}
