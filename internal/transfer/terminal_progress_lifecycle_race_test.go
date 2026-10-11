package transfer

import (
	"context"
	"reflect"
	"sync"
	"testing"
	"time"
)

func waitTerminalProgressRace(t *testing.T, signal <-chan struct{}, label string) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(10 * time.Second):
		t.Fatalf("timed out waiting for %s", label)
	}
}

// A folder can finish cancellation while an older upload callback is still
// queued in another goroutine. That callback cannot rewrite the authoritative
// terminal folder snapshot or emit a new progress revision.
func TestLateGroupProgressCannotRewriteCancelledFolder(t *testing.T) {
	manager := NewManager(20)
	group := manager.StartGroup(Spec{
		FileName: "photos", Kind: KindUpload, Direction: "upload",
		TotalBytes: 100, TotalItems: 1,
	})
	ownerCtx, ownerCancel := context.WithCancel(context.Background())
	defer ownerCancel()
	if !group.BindGroupCancelContext(ownerCtx, ownerCancel) {
		t.Fatal("upload group cancellation owner was not bound")
	}
	child := manager.StartChildByID(group.ID(), Spec{
		FileName: "photo.jpg", Kind: KindUpload, Direction: "upload", TotalBytes: 100,
	})
	if child == nil {
		t.Fatal("missing upload child")
	}

	callbackReady := make(chan struct{})
	releaseCallback := make(chan struct{})
	callbackDone := make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(releaseCallback) }) }
	defer release()
	go func() {
		close(callbackReady)
		<-releaseCallback
		group.UpdateGroup(GroupProgress{
			Phase: PhaseTransferring, ScanComplete: true,
			BytesDone: 100, BytesTotal: 100, TotalItems: 1,
			CompletedItems: 1, RunningItems: 1,
		})
		close(callbackDone)
	}()
	waitTerminalProgressRace(t, callbackReady, "old upload progress callback")

	if err := manager.Cancel(group.ID()); err != nil {
		t.Fatalf("cancel upload folder: %v", err)
	}
	if err := child.Finish(StateCancelled, context.Canceled); err != nil {
		t.Fatalf("cancel child: %v", err)
	}
	if err := group.Finish(StateCancelled, context.Canceled); err != nil {
		t.Fatalf("confirm cancelled folder: %v", err)
	}
	revisionBefore, before := manager.Snapshot()
	release()
	waitTerminalProgressRace(t, callbackDone, "late upload group progress")
	revisionAfter, after := manager.Snapshot()
	if revisionAfter != revisionBefore || !reflect.DeepEqual(before, after) {
		t.Fatalf("late group progress changed confirmed cancellation: revision %d -> %d; before=%+v after=%+v",
			revisionBefore, revisionAfter, before, after)
	}
}

// A child may finish and its transfer owner may finish the cancelled group
// before a queued child+group aggregate progress callback is delivered.
func TestLateChildAggregateProgressCannotRewriteCancelledFolder(t *testing.T) {
	manager := NewManager(20)
	group := manager.StartGroup(Spec{
		FileName: "folder-download", Kind: KindDownload, Direction: "download",
		TotalBytes: 200, TotalItems: 1,
	})
	ownerCtx, ownerCancel := context.WithCancel(context.Background())
	defer ownerCancel()
	if !group.BindCancel(ownerCancel) {
		t.Fatal("download group cancellation owner was not bound")
	}
	child := manager.StartChildByID(group.ID(), Spec{
		FileName: "document.bin", Kind: KindDownload, Direction: "download", TotalBytes: 200,
	})
	if child == nil {
		t.Fatal("missing download child")
	}
	child.ProgressAndUpdateGroup(group, 30, 200, GroupProgress{
		Phase: PhaseTransferring, ScanComplete: true,
		BytesDone: 30, BytesTotal: 200, TotalItems: 1, RunningItems: 1,
	})

	callbackReady := make(chan struct{})
	releaseCallback := make(chan struct{})
	callbackDone := make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(releaseCallback) }) }
	defer release()
	go func() {
		close(callbackReady)
		<-releaseCallback
		child.ProgressAndUpdateGroup(group, 200, 200, GroupProgress{
			Phase: PhaseTransferring, ScanComplete: true,
			BytesDone: 200, BytesTotal: 200, TotalItems: 1,
			CompletedItems: 1, RunningItems: 1,
		})
		close(callbackDone)
	}()
	waitTerminalProgressRace(t, callbackReady, "old child+group progress callback")

	if err := manager.Cancel(group.ID()); err != nil {
		t.Fatalf("cancel download folder: %v", err)
	}
	if ownerCtx.Err() != context.Canceled {
		t.Fatalf("cancel did not abort folder owner context: %v", ownerCtx.Err())
	}
	if err := child.Finish(StateCancelled, context.Canceled); err != nil {
		t.Fatalf("confirm child cancel: %v", err)
	}
	if err := group.Finish(StateCancelled, context.Canceled); err != nil {
		t.Fatalf("confirm group cancel: %v", err)
	}
	revisionBefore, before := manager.Snapshot()
	release()
	waitTerminalProgressRace(t, callbackDone, "late child+group aggregate progress")
	revisionAfter, after := manager.Snapshot()
	if revisionAfter != revisionBefore || !reflect.DeepEqual(before, after) {
		t.Fatalf("late child aggregate changed confirmed cancellation: revision %d -> %d; before=%+v after=%+v",
			revisionBefore, revisionAfter, before, after)
	}
}

// A queued BeginTransfer IPC may arrive after the original I/O owner
// has confirmed cancellation. It must not rewrite the finalizing phase.
func TestLateBeginTransferPhaseCannotRewriteCancelledItem(t *testing.T) {
	manager := NewManager(20)
	item := manager.Start(Spec{
		FileName: "cancelled.bin", Kind: KindDownload, Direction: "download",
		Phase: PhaseQueued, TotalBytes: 100,
	})
	ownerCtx, ownerCancel := context.WithCancel(context.Background())
	defer ownerCancel()
	if !item.BindCancel(ownerCancel) {
		t.Fatal("download owner was not bound")
	}

	callbackReady := make(chan struct{})
	releaseCallback := make(chan struct{})
	callbackDone := make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(releaseCallback) }) }
	defer release()
	go func() {
		close(callbackReady)
		<-releaseCallback
		item.SetPhase(PhaseTransferring)
		close(callbackDone)
	}()
	waitTerminalProgressRace(t, callbackReady, "old BeginTransfer callback")

	if err := manager.Cancel(item.ID()); err != nil {
		t.Fatalf("cancel queued transfer: %v", err)
	}
	if ownerCtx.Err() != context.Canceled {
		t.Fatalf("cancel did not abort owner context: %v", ownerCtx.Err())
	}
	if err := item.Finish(StateCancelled, context.Canceled); err != nil {
		t.Fatalf("confirm cancellation: %v", err)
	}
	revisionBefore, before := manager.Snapshot()
	release()
	waitTerminalProgressRace(t, callbackDone, "late BeginTransfer callback")
	revisionAfter, after := manager.Snapshot()
	if revisionAfter != revisionBefore || !reflect.DeepEqual(before, after) ||
		len(after) != 1 || after[0].Phase != PhaseFinalizing || after[0].State != StateCancelled {
		t.Fatalf("late BeginTransfer changed confirmed cancellation: revision %d -> %d; before=%+v after=%+v",
			revisionBefore, revisionAfter, before, after)
	}
}
