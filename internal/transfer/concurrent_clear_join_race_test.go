package transfer

import (
	"context"
	"errors"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// Two account clears may overlap after the first has removed all records but
// before its Agent-owned cancellation callback has finished. Both callers
// must join that same teardown, not claim the old I/O is gone prematurely.
func TestConcurrentAccountClearsJoinPendingOldTransport(t *testing.T) {
	for _, grouped := range []bool{false, true} {
		name := "direct-download"
		if grouped {
			name = "upload-group"
		}
		t.Run(name, func(t *testing.T) {
			manager := NewManager(8)
			transportCtx, cancelTransport := context.WithCancel(context.Background())
			defer cancelTransport()
			entered := make(chan struct{})
			releaseCancel := make(chan struct{})
			var releaseOnce sync.Once
			release := func() { releaseOnce.Do(func() { close(releaseCancel) }) }
			t.Cleanup(release)
			var callbackCount atomic.Int32
			cancelOwned := func() {
				callbackCount.Add(1)
				close(entered)
				<-releaseCancel
				cancelTransport()
			}
			if grouped {
				h := manager.StartGroup(Spec{
					FileName: "account-a-folder", Kind: KindUpload, Direction: "upload",
				})
				if !h.BindGroupCancelContext(transportCtx, cancelOwned) {
					t.Fatal("failed to bind old account upload group owner")
				}
			} else {
				h := manager.Start(Spec{
					FileName: "account-a-download.bin", Kind: KindDownload, Direction: "download",
				})
				if !h.BindCancel(cancelOwned) {
					t.Fatal("failed to bind old account direct I/O owner")
				}
			}

			firstDone := make(chan struct{})
			go func() {
				manager.Clear()
				close(firstDone)
			}()
			select {
			case <-entered:
			case <-time.After(10 * time.Second):
				t.Fatal("first account Clear did not enter its I/O cancellation callback")
			}
			// The old records have already been removed; the actual transport
			// is still live because its callback is deliberately blocked.
			if _, items := manager.Snapshot(); len(items) != 0 {
				t.Fatalf("first Clear did not publish empty account state: %+v", items)
			}
			if transportCtx.Err() != nil {
				t.Fatal("transport cancelled before its callback was released")
			}

			secondDone := make(chan struct{})
			go func() {
				manager.Clear()
				close(secondDone)
			}()
			// Synchronize with the second Clear reaching the Manager mutex:
			// each Clear must increment generation even when entries are empty.
			deadline := time.After(10 * time.Second)
			for {
				manager.mu.Lock()
				generation := manager.generation
				manager.mu.Unlock()
				if generation >= 2 {
					break
				}
				select {
				case <-deadline:
					t.Fatal("second account Clear never reached the Manager")
				default:
					runtime.Gosched()
				}
			}
			select {
			case <-secondDone:
				t.Error("second Clear returned while first Clear's original I/O was still running")
			case <-time.After(150 * time.Millisecond):
				// Both Clear callers are joining the same pending callback.
			}

			// After the old table is empty, account B can restore history
			// even while both old teardown callers still wait to finish.
			other := NewManager(8)
			newRecord := other.Start(Spec{
				FileName: "account-b-completed.bin", Kind: KindDownload, Direction: "download",
			})
			newRecord.Complete()
			history := other.HistorySnapshot(8)
			if len(history) != 1 {
				t.Fatal("failed to prepare account B history")
			}
			if err := manager.RestoreHistory(history); err != nil {
				t.Fatalf("account B history restore failed: %v", err)
			}

			release()
			for _, result := range []struct {
				name string
				done <-chan struct{}
			}{{"first Clear", firstDone}, {"second Clear", secondDone}} {
				select {
				case <-result.done:
				case <-time.After(10 * time.Second):
					t.Fatalf("%s did not join old I/O cancellation", result.name)
				}
			}
			if !errors.Is(transportCtx.Err(), context.Canceled) {
				t.Fatalf("old account transport survived concurrent Clear: %v", transportCtx.Err())
			}
			if callbackCount.Load() != 1 {
				t.Errorf("old cancellation callback ran %d times, want exactly 1", callbackCount.Load())
			}
			if _, items := manager.Snapshot(); len(items) != 1 ||
				items[0].FileName != history[0].FileName || items[0].State != StateCompleted {
				t.Fatalf("old Clear callback damaged restored account B history: %+v", items)
			}
		})
	}
}
