package transfer

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// A group Finish publishes terminal status before it completes its cancellation
// callback. ClearHistory may run while that callback is in progress, but must
// not erase the pending cancellation handoff. Account Clear must join it.
func TestAccountClearJoinsConcurrentGroupFinishCancellation(t *testing.T) {
	m := NewManager(8)
	group := m.StartGroup(Spec{
		FileName: "old-account-folder",
		Kind:     KindUpload, Direction: "upload", TotalItems: 1, TotalBytes: 100,
	})
	transportCtx, cancelTransport := context.WithCancel(context.Background())
	defer cancelTransport()
	callbackEntered := make(chan struct{})
	allowCancellation := make(chan struct{})
	var once sync.Once
	release := func() { once.Do(func() { close(allowCancellation) }) }
	defer release()
	if !group.BindGroupCancelContext(transportCtx, func() {
		close(callbackEntered)
		<-allowCancellation
		cancelTransport()
	}) {
		t.Fatal("upload group did not bind its owner cancellation")
	}

	finishDone := make(chan error, 1)
	go func() { finishDone <- group.Finish(StateCompleted, nil) }()
	select {
	case <-callbackEntered:
	case <-time.After(10 * time.Second):
		t.Fatal("normal group Finish never began cancellation")
	}

	historyDone := make(chan struct{})
	go func() { m.ClearHistory(); close(historyDone) }()
	select {
	case <-historyDone:
	case <-time.After(3 * time.Second):
		t.Fatal("ClearHistory blocked on a group Finish cancellation callback")
	}
	_, retained := m.Snapshot()
	if len(retained) != 1 || retained[0].ID != group.ID() {
		t.Fatalf("ClearHistory removed a group before its transport cancel was complete: %+v", retained)
	}

	clearDone := make(chan struct{})
	go func() { m.Clear(); close(clearDone) }()
	select {
	case <-clearDone:
		if !errors.Is(transportCtx.Err(), context.Canceled) {
			t.Fatal("account Clear returned before the pending group Finish cancellation completed")
		}
	case <-time.After(200 * time.Millisecond):
		// Clear joins the same pending cancellation, not an independent state-only reset.
	}
	release()
	select {
	case err := <-finishDone:
		if err != nil {
			t.Fatalf("Finish failed: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("Finish never returned after transport cancellation")
	}
	select {
	case <-clearDone:
	case <-time.After(10 * time.Second):
		t.Fatal("account Clear did not join the pending transport cancellation")
	}
	if !errors.Is(transportCtx.Err(), context.Canceled) {
		t.Fatalf("old group transport remained alive: %v", transportCtx.Err())
	}
	if _, tasks := m.Snapshot(); len(tasks) != 0 {
		t.Fatalf("old account's group survived Clear: %+v", tasks)
	}
}

// Terminal publication and the completion of the group-cancel callback are
// separate transitions. Removing the just-completed root after cancellation
// must advance the revision seen by long-poll consumers.
func TestGroupFinishDeferredTrimPublishesRevision(t *testing.T) {
	manager := NewManager(1)
	finishedGroup := manager.StartGroup(Spec{
		FileName: "finished-folder", Kind: KindUpload, Direction: "upload",
	})
	survivingGroup := manager.StartGroup(Spec{
		FileName: "active-folder", Kind: KindDownload, Direction: "download",
	})
	ownerCtx, cancelOwner := context.WithCancel(context.Background())
	defer cancelOwner()
	callbackEntered := make(chan struct{})
	allowCancel := make(chan struct{})
	defer func() {
		select {
		case <-allowCancel:
		default:
			close(allowCancel)
		}
	}()
	if !finishedGroup.BindGroupCancelContext(ownerCtx, func() {
		close(callbackEntered)
		<-allowCancel
		cancelOwner()
	}) {
		t.Fatal("group cancel callback unavailable")
	}
	finishDone := make(chan error, 1)
	go func() { finishDone <- finishedGroup.Finish(StateCompleted, nil) }()
	select {
	case <-callbackEntered:
	case <-time.After(10 * time.Second):
		t.Fatal("group Finish did not enter the pending callback")
	}
	before, pending := manager.Snapshot()
	if len(pending) != 2 {
		t.Fatalf("pending group was prematurely trimmed: %+v", pending)
	}
	close(allowCancel)
	select {
	case err := <-finishDone:
		if err != nil {
			t.Fatalf("Finish failed: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("group Finish never completed")
	}
	after, tasks := manager.Snapshot()
	if after <= before || len(tasks) != 1 || tasks[0].ID != survivingGroup.ID() {
		t.Fatalf("post-cancel capacity trim was not published: revision %d -> %d, tasks=%+v", before, after, tasks)
	}
}
