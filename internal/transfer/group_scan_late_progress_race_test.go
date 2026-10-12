package transfer

import (
	"reflect"
	"testing"
	"time"
)

// A scanning callback can be prepared before the last folder item was scanned,
// yet arrive after the producer has already published a complete inventory and
// begun transferring bytes. The late callback must not reopen that same scan.
func TestLateScanProgressCannotReopenCompletedUploadGroup(t *testing.T) {
	manager := NewManager(8)
	group := manager.StartGroup(Spec{
		FileName: "mixed-photo-folder",
		Kind:     KindUpload, Direction: "upload", TotalBytes: 100, TotalItems: 2,
	})

	prepared := make(chan struct{})
	release := make(chan struct{})
	staleDone := make(chan struct{})
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
		select {
		case <-staleDone:
		case <-time.After(5 * time.Second):
			t.Error("stale scanner callback did not exit during cleanup")
		}
	}()

	go func() {
		// This snapshot was computed during scanning, before the producer
		// learned that its inventory was complete.
		stale := GroupProgress{
			Phase: PhaseScanning, ScanComplete: false,
			BytesDone: 0, BytesTotal: 100,
			TotalItems: 2, QueuedItems: 2,
		}
		close(prepared)
		<-release
		group.UpdateGroup(stale)
		close(staleDone)
	}()

	select {
	case <-prepared:
	case <-time.After(5 * time.Second):
		t.Fatal("scanner did not prepare a pending progress notification")
	}

	// The authoritative newer producer finishes scanning and starts transfer.
	group.UpdateGroup(GroupProgress{
		Phase: PhaseTransferring, ScanComplete: true,
		BytesDone: 60, BytesTotal: 100,
		TotalItems: 2, CompletedItems: 1, RunningItems: 1,
	})
	beforeRev, before := manager.Snapshot()
	if len(before) != 1 || before[0].Phase != PhaseTransferring ||
		!before[0].ScanComplete || before[0].BytesDone != 60 {
		t.Fatalf("expected a complete scan with 60 uploaded bytes: %+v", before)
	}

	close(release)
	select {
	case <-staleDone:
	case <-time.After(5 * time.Second):
		t.Fatal("delayed scanning progress did not arrive")
	}
	afterRev, after := manager.Snapshot()
	if afterRev != beforeRev || !reflect.DeepEqual(after, before) {
		t.Fatalf("stale scanning callback reopened completed inventory: revision %d -> %d; before=%+v after=%+v",
			beforeRev, afterRev, before, after)
	}
}
