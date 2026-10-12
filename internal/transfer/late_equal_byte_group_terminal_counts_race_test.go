package transfer

import (
	"errors"
	"reflect"
	"sync"
	"testing"
	"time"
)

// Two real upload-group callbacks can snapshot identical cumulative bytes
// around a child completing or failing. The older still-running snapshot must
// never erase the newly published terminal item count for the same attempt.
func TestLateEqualByteGroupProgressCannotRewindTerminalItemCounts(t *testing.T) {
	cases := []struct {
		name   string
		failed bool
	}{
		{name: "completed-child"},
		{name: "failed-child", failed: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := NewManager(16)
			group := m.StartGroup(Spec{
				FileName: "photo-backup", Kind: KindUpload, Direction: "upload",
				Scope: ScopeGroup, Phase: PhaseTransferring, ScanComplete: true,
				TotalBytes: 200, TotalItems: 2,
			})
			first := m.StartChild(group, Spec{
				FileName: "first.jpg", Kind: KindUpload, Direction: "upload", TotalBytes: 100,
			})
			second := m.StartChild(group, Spec{
				FileName: "second.jpg", Kind: KindUpload, Direction: "upload", TotalBytes: 100,
			})
			if first == nil || second == nil {
				t.Fatal("expected two real upload child tasks")
			}
			first.Progress(100, 100)

			prepared := make(chan struct{})
			release := make(chan struct{})
			finished := make(chan struct{})
			var once sync.Once
			unblock := func() { once.Do(func() { close(release) }) }
			t.Cleanup(func() {
				unblock()
				select {
				case <-finished:
				case <-time.After(5 * time.Second):
					t.Error("delayed progress callback did not finish")
				}
			})
			go func() {
				// The snapshot was captured before first.jpg completed, but
				// the transferred bytes were already at 100 of 200.
				old := GroupProgress{
					Phase: PhaseTransferring, ScanComplete: true,
					BytesDone: 100, BytesTotal: 200, TotalItems: 2,
					RunningItems: 2,
				}
				close(prepared)
				<-release
				group.UpdateGroup(old)
				close(finished)
			}()
			select {
			case <-prepared:
			case <-time.After(5 * time.Second):
				t.Fatal("old aggregate callback was not prepared")
			}
			if tc.failed {
				first.Fail(errors.New("first photo checksum failed"))
			} else {
				first.Complete()
			}
			fresh := GroupProgress{
				Phase: PhaseTransferring, ScanComplete: true,
				BytesDone: 100, BytesTotal: 200, TotalItems: 2,
				RunningItems: 1,
			}
			if tc.failed {
				fresh.FailedItems = 1
			} else {
				fresh.CompletedItems = 1
			}
			group.UpdateGroup(fresh)
			beforeRev, before := m.Snapshot()
			var root Task
			found := false
			for _, task := range before {
				if task.ID == group.ID() {
					root = task
					found = true
					break
				}
			}
			if !found || root.BytesDone != 100 || root.State != StateRunning ||
				root.ItemsCompleted != fresh.CompletedItems ||
				root.ItemsFailed != fresh.FailedItems || root.ItemsRunning != 1 {
				t.Fatalf("new terminal child count was not published: %+v", before)
			}
			unblock()
			select {
			case <-finished:
			case <-time.After(5 * time.Second):
				t.Fatal("old callback did not arrive")
			}
			afterRev, after := m.Snapshot()
			if afterRev != beforeRev || !reflect.DeepEqual(before, after) {
				t.Fatalf("old same-byte group callback rewound terminal child counts: revision %d -> %d; before=%+v after=%+v", beforeRev, afterRev, before, after)
			}
		})
	}
}
