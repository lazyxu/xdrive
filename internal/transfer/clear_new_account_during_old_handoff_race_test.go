package transfer

import (
	"context"
	"errors"
	"reflect"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// A new account can restore history and start I/O while the previous account's
// Clear is still joining its cancellation callback. A second Clear must also
// clear the *new* account's work, not return after joining A's old teardown.
func TestSecondClearDuringOldHandoffAlsoCancelsNewAccount(t *testing.T) {
	for _, grouped := range []bool{false, true} {
		name := "direct-downloads"
		if grouped {
			name = "upload-groups"
		}
		t.Run(name, func(t *testing.T) {
			m := NewManager(16)
			oldCtx, cancelOld := context.WithCancel(context.Background())
			defer cancelOld()
			oldEntered := make(chan struct{})
			oldRelease := make(chan struct{})
			var oldReleaseOnce sync.Once
			release := func() { oldReleaseOnce.Do(func() { close(oldRelease) }) }
			t.Cleanup(release)
			var oldCalls atomic.Int32
			oldCancel := func() {
				oldCalls.Add(1)
				close(oldEntered)
				<-oldRelease
				cancelOld()
			}
			var old *Handle
			var oldObserver func(int64)
			if grouped {
				old = m.StartGroup(Spec{
					FileName: "account-a-folder", Kind: KindUpload, Direction: "upload",
				})
				if !old.BindGroupCancelContext(oldCtx, oldCancel) {
					t.Fatal("old account upload group could not bind cancel owner")
				}
			} else {
				old = m.Start(Spec{
					FileName: "account-a-download.bin", Kind: KindDownload, Direction: "download",
				})
				if !old.BindCancel(oldCancel) {
					t.Fatal("old account download could not bind cancel owner")
				}
				oldObserver = old.NetworkProgressObserver()
				if oldObserver == nil {
					t.Fatal("old account network observer was not created")
				}
			}
			firstDone := make(chan struct{})
			go func() { m.Clear(); close(firstDone) }()
			select {
			case <-oldEntered:
			case <-time.After(10 * time.Second):
				t.Fatal("first Clear never entered old account I/O cancellation")
			}
			if oldCtx.Err() != nil {
				t.Fatal("old account I/O was cancelled before the release signal")
			}

			// Independent account B restores a historical task with the same
			// transfer-1 ID as A; late callbacks must not touch that record.
			other := NewManager(8)
			restored := other.Start(Spec{
				FileName: "account-b-history.bin", Kind: KindDownload, Direction: "download",
			})
			restored.Complete()
			if restored.ID() != old.ID() {
				t.Fatalf("expected overlapping account IDs, old=%q new=%q", old.ID(), restored.ID())
			}
			history := other.HistorySnapshot(8)
			if err := m.RestoreHistory(history); err != nil {
				t.Fatalf("account B history restore failed: %v", err)
			}
			beforeRev, before := m.Snapshot()
			if grouped {
				old.UpdateGroup(GroupProgress{TotalItems: 99, BytesDone: 99, BytesTotal: 100})
			} else {
				old.Progress(99, 100)
				oldObserver(99)
				old.AllowLocalReveal()
			}
			afterRev, after := m.Snapshot()
			if beforeRev != afterRev || !reflect.DeepEqual(before, after) {
				t.Fatalf("account A callbacks modified B's restored history: %d -> %d, before=%+v after=%+v",
					beforeRev, afterRev, before, after)
			}

			newCtx, cancelNew := context.WithCancel(context.Background())
			defer cancelNew()
			var newCalls atomic.Int32
			newCancel := func() {
				newCalls.Add(1)
				cancelNew()
			}
			if grouped {
				newGroup := m.StartGroup(Spec{
					FileName: "account-b-active-folder", Kind: KindUpload, Direction: "upload",
				})
				if !newGroup.BindGroupCancelContext(newCtx, newCancel) {
					t.Fatal("account B upload group could not bind cancel owner")
				}
			} else {
				newFile := m.Start(Spec{
					FileName: "account-b-active-download.bin", Kind: KindDownload, Direction: "download",
				})
				if !newFile.BindCancel(newCancel) {
					t.Fatal("account B download could not bind cancel owner")
				}
			}
			secondDone := make(chan struct{})
			go func() { m.Clear(); close(secondDone) }()
			deadline := time.After(10 * time.Second)
			for {
				m.mu.Lock()
				seenSecond := m.generation >= 2
				m.mu.Unlock()
				if seenSecond {
					break
				}
				select {
				case <-deadline:
					t.Fatal("second Clear never entered the Manager")
				default:
					runtime.Gosched()
				}
			}
			select {
			case <-secondDone:
				t.Error("second Clear returned before old account cancellation settled")
			default:
			}

			release()
			for _, result := range []struct {
				name string
				done <-chan struct{}
			}{{"first Clear", firstDone}, {"second Clear", secondDone}} {
				select {
				case <-result.done:
				case <-time.After(10 * time.Second):
					t.Fatalf("%s failed to finish", result.name)
				}
			}
			if !errors.Is(oldCtx.Err(), context.Canceled) {
				t.Errorf("old account transport survived first Clear: %v", oldCtx.Err())
			}
			if !errors.Is(newCtx.Err(), context.Canceled) {
				t.Errorf("second Clear left account B's actual transport running: %v", newCtx.Err())
			}
			if oldCalls.Load() != 1 || newCalls.Load() != 1 {
				t.Errorf("cancel callbacks called old=%d new=%d; want both exactly once",
					oldCalls.Load(), newCalls.Load())
			}
			if _, entries := m.Snapshot(); len(entries) != 0 {
				t.Errorf("second Clear retained account B tasks: %+v", entries)
			}
		})
	}
}
