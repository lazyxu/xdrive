package transfer

import (
	"context"
	"errors"
	"testing"
	"time"
)

func waitLateTerminalRaceSignal(t *testing.T, ch <-chan struct{}, label string) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(10 * time.Second):
		t.Fatalf("timed out waiting for %s", label)
	}
}

// A folder transfer can be cancelled while an old completion notification is
// still pending. A late success callback must not undo its committed cancel.
func TestLateGroupSuccessCannotOverwriteConfirmedCancellation(t *testing.T) {
	manager := NewManager(10)
	group := manager.StartGroup(Spec{
		FileName: "photos", Kind: KindUpload, Direction: "upload",
		TotalItems: 1, TotalBytes: 100,
	})
	groupCtx, groupCancel := context.WithCancel(context.Background())
	defer groupCancel()
	if !group.BindGroupCancelContext(groupCtx, groupCancel) {
		t.Fatal("upload group must own its cancel context")
	}
	child := manager.StartChildByID(group.ID(), Spec{
		FileName: "photo.jpg", Kind: KindUpload, Direction: "upload", TotalBytes: 100,
	})
	if child == nil {
		t.Fatal("missing group child")
	}

	lateReady := make(chan struct{})
	releaseLate := make(chan struct{})
	defer func() {
		select {
		case <-releaseLate:
		default:
			close(releaseLate)
		}
	}()
	lateFinished := make(chan error, 1)
	go func() {
		close(lateReady)
		<-releaseLate
		lateFinished <- group.Finish(StateCompleted, nil)
	}()
	waitLateTerminalRaceSignal(t, lateReady, "delayed group completion callback")

	if err := manager.Cancel(group.ID()); err != nil {
		t.Fatalf("cancel group: %v", err)
	}
	if !errors.Is(groupCtx.Err(), context.Canceled) {
		t.Fatalf("group owner context remained live: %v", groupCtx.Err())
	}
	if err := child.Finish(StateCancelled, context.Canceled); err != nil {
		t.Fatalf("finish child cancellation: %v", err)
	}
	if err := group.Finish(StateCancelled, context.Canceled); err != nil {
		t.Fatalf("commit group cancellation: %v", err)
	}

	close(releaseLate)
	select {
	case err := <-lateFinished:
		if err != nil {
			t.Fatalf("late group completion callback: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("late group completion callback did not return")
	}
	_, tasks := manager.Snapshot()
	byID := make(map[string]Task, len(tasks))
	for _, task := range tasks {
		byID[task.ID] = task
	}
	if got := byID[group.ID()]; got.State != StateCancelled || got.CompletedAt == nil || got.Cancelable {
		t.Fatalf("late group success overwrote confirmed cancellation: %+v", got)
	}
	if got := byID[child.ID()]; got.State != StateCancelled {
		t.Fatalf("cancelled group child changed unexpectedly: %+v", got)
	}
}

// Desktop transfer completion can report an already-queued skip after its
// in-flight operation was cancelled and confirmed. It must remain cancelled.
func TestLateSkippedCompletionCannotOverwriteCancelledItem(t *testing.T) {
	manager := NewManager(10)
	item := manager.Start(Spec{
		FileName: "document.bin", Kind: KindDownload, Direction: "download", TotalBytes: 200,
	})
	ownedCtx, ownedCancel := context.WithCancel(context.Background())
	defer ownedCancel()
	if !item.BindCancel(ownedCancel) {
		t.Fatal("download must bind its owned cancellation context")
	}

	lateReady := make(chan struct{})
	releaseLate := make(chan struct{})
	defer func() {
		select {
		case <-releaseLate:
		default:
			close(releaseLate)
		}
	}()
	lateFinished := make(chan struct{})
	go func() {
		close(lateReady)
		<-releaseLate
		item.CompleteSkipped()
		close(lateFinished)
	}()
	waitLateTerminalRaceSignal(t, lateReady, "delayed skip completion callback")

	if err := manager.Cancel(item.ID()); err != nil {
		t.Fatalf("cancel download: %v", err)
	}
	if !errors.Is(ownedCtx.Err(), context.Canceled) {
		t.Fatalf("download owned context remained live: %v", ownedCtx.Err())
	}
	if err := item.Finish(StateCancelled, context.Canceled); err != nil {
		t.Fatalf("confirm download cancellation: %v", err)
	}
	close(releaseLate)
	waitLateTerminalRaceSignal(t, lateFinished, "delayed skip completion callback return")

	_, tasks := manager.Snapshot()
	if len(tasks) != 1 || tasks[0].State != StateCancelled ||
		tasks[0].ItemsCompleted != 0 || tasks[0].Percent == 100 ||
		tasks[0].Cancelable || tasks[0].CompletedAt == nil {
		t.Fatalf("late skip completion overwrote cancelled download: %+v", tasks)
	}
}
