package transfer

import (
	"context"
	"reflect"
	"testing"
	"time"
)

func waitCancellingCallback(t *testing.T, signal <-chan struct{}, label string) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(10 * time.Second):
		t.Fatalf("timed out waiting for %s", label)
	}
}

// A queued BeginTransfer callback can arrive after the Agent already accepted
// Cancel, but before the owner confirms the terminal result. The in-flight
// cancelling item must retain its finalizing phase and snapshot revision.
func TestLateBeginPhaseCannotRewindCancellingTransfer(t *testing.T) {
	manager := NewManager(10)
	item := manager.Start(Spec{
		FileName: "queued-download.bin",
		Kind:     KindDownload, Direction: "download",
		Phase: PhaseQueued, TotalBytes: 100,
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if !item.BindCancel(cancel) {
		t.Fatal("queued download did not bind its actual cancellation")
	}

	entered := make(chan struct{})
	release := make(chan struct{})
	done := make(chan struct{})
	t.Cleanup(func() {
		select {
		case <-release:
		default:
			close(release)
		}
	})
	go func() {
		close(entered)
		<-release
		item.SetPhase(PhaseTransferring)
		close(done)
	}()
	waitCancellingCallback(t, entered, "late queued BeginTransfer")
	if err := manager.Cancel(item.ID()); err != nil {
		t.Fatal(err)
	}
	if ctx.Err() != context.Canceled {
		t.Fatalf("real owner context not cancelled: %v", ctx.Err())
	}
	beforeRevision, before := manager.Snapshot()
	if len(before) != 1 || before[0].State != StateCancelling ||
		before[0].Phase != PhaseFinalizing {
		t.Fatalf("unexpected cancellation baseline: %+v", before)
	}
	close(release)
	waitCancellingCallback(t, done, "late BeginTransfer completion")
	afterRevision, after := manager.Snapshot()
	if afterRevision != beforeRevision || !reflect.DeepEqual(before, after) {
		t.Fatalf("late BeginTransfer rewrote an active cancellation: revision %d -> %d; before=%+v after=%+v",
			beforeRevision, afterRevision, before, after)
	}
}

// A folder's pending progress notification can cross an accepted group Cancel.
// While the I/O owner is still unwinding, the folder must not jump backwards
// from finalizing to transferring or accept stale counts and byte progress.
func TestLateGroupProgressCannotRewindCancellingFolder(t *testing.T) {
	manager := NewManager(10)
	group := manager.StartGroup(Spec{
		FileName: "queued-upload-folder",
		Kind:     KindUpload, Direction: "upload",
		TotalBytes: 100, TotalItems: 2,
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if !group.BindGroupCancelContext(ctx, cancel) {
		t.Fatal("upload group did not bind its actual cancellation")
	}
	group.UpdateGroup(GroupProgress{
		Phase: PhaseTransferring, ScanComplete: true,
		BytesDone: 10, BytesTotal: 100, TotalItems: 2,
		RunningItems: 1, QueuedItems: 1,
	})

	entered := make(chan struct{})
	release := make(chan struct{})
	done := make(chan struct{})
	t.Cleanup(func() {
		select {
		case <-release:
		default:
			close(release)
		}
	})
	go func() {
		close(entered)
		<-release
		group.UpdateGroup(GroupProgress{
			Phase: PhaseTransferring, ScanComplete: true,
			BytesDone: 90, BytesTotal: 100, TotalItems: 2,
			CompletedItems: 1, RunningItems: 1,
		})
		close(done)
	}()
	waitCancellingCallback(t, entered, "pending folder progress")
	if err := manager.Cancel(group.ID()); err != nil {
		t.Fatal(err)
	}
	if ctx.Err() != context.Canceled {
		t.Fatalf("real group context not cancelled: %v", ctx.Err())
	}
	beforeRevision, before := manager.Snapshot()
	if len(before) != 1 || before[0].State != StateCancelling ||
		before[0].Phase != PhaseFinalizing || before[0].BytesDone != 10 {
		t.Fatalf("unexpected group cancellation baseline: %+v", before)
	}
	close(release)
	waitCancellingCallback(t, done, "late folder progress completion")
	afterRevision, after := manager.Snapshot()
	if afterRevision != beforeRevision || !reflect.DeepEqual(before, after) {
		t.Fatalf("late progress rewrote an active folder cancellation: revision %d -> %d; before=%+v after=%+v",
			beforeRevision, afterRevision, before, after)
	}
}
