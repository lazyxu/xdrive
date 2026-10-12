package transfer

import (
	"reflect"
	"sync"
	"testing"
	"time"
)

// The same Agent upload child can have an older cumulative progress callback
// already prepared when a newer callback is delivered. Both child and group
// counters belong to one transfer attempt, so an old callback must not undo
// already-published bytes or emit a spurious revision.
func TestLateChildAndGroupProgressCannotRewindTransferredBytes(t *testing.T) {
	manager := NewManager(16)
	group := manager.StartGroup(Spec{
		FileName: "group-images",
		Kind:     KindUpload, Direction: "upload", Phase: PhaseTransferring,
		ScanComplete: true, TotalBytes: 100, TotalItems: 1,
	})
	child := manager.StartChild(group, Spec{
		FileName: "image-01.jpg", Kind: KindUpload, Direction: "upload",
		TotalBytes: 100,
	})
	if child == nil {
		t.Fatal("real upload child was not started")
	}

	prepared := make(chan struct{})
	release := make(chan struct{})
	done := make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	t.Cleanup(func() {
		unblock()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Error("delayed upload callback did not exit during cleanup")
		}
	})
	go func() {
		stale := GroupProgress{
			Phase: PhaseTransferring, ScanComplete: true,
			BytesDone: 20, BytesTotal: 100, TotalItems: 1,
			RunningItems: 1,
		}
		close(prepared)
		<-release
		child.ProgressAndUpdateGroup(group, 20, 100, stale)
		close(done)
	}()
	select {
	case <-prepared:
	case <-time.After(5 * time.Second):
		t.Fatal("older callback was not prepared")
	}

	child.ProgressAndUpdateGroup(group, 80, 100, GroupProgress{
		Phase: PhaseTransferring, ScanComplete: true,
		BytesDone: 80, BytesTotal: 100, TotalItems: 1,
		RunningItems: 1,
	})
	beforeRevision, before := manager.Snapshot()
	if len(before) != 2 {
		t.Fatalf("expected a group and its child, got %+v", before)
	}
	for _, item := range before {
		if item.BytesDone != 80 || item.BytesTotal != 100 ||
			item.Percent != 80 || item.State != StateRunning {
			t.Fatalf("newer progress was not accepted for %s: %+v", item.ID, item)
		}
	}

	unblock()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("older progress callback did not finish")
	}
	afterRevision, after := manager.Snapshot()
	if afterRevision != beforeRevision || !reflect.DeepEqual(after, before) {
		t.Fatalf(
			"stale child/group progress rewound a live upload: revision %d -> %d; before=%+v after=%+v",
			beforeRevision, afterRevision, before, after,
		)
	}
}
