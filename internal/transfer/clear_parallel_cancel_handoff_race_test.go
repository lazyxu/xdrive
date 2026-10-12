package transfer

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// Clear must dispatch cancellation to every old-account transport without
// waiting for an unrelated cancellation callback to finish first. Its join
// guarantee is separate: Clear still may not return before they all finish.
// Restoring account B's terminal history during that gap must remain safe.
func TestAccountClearFansOutIndependentTransportCancels(t *testing.T) {
	for _, includeGroup := range []bool{false, true} {
		name := "direct-only"
		if includeGroup {
			name = "direct-and-upload-group"
		}
		t.Run(name, func(t *testing.T) {
			const transfers = 8
			manager := NewManager(32)
			entered := make(chan int, transfers)
			releaseCancel := make(chan struct{})
			var releaseOnce sync.Once
			release := func() { releaseOnce.Do(func() { close(releaseCancel) }) }
			t.Cleanup(release)

			transportContexts := make([]context.Context, 0, transfers)
			for i := 0; i < transfers; i++ {
				ctx, cancelTransport := context.WithCancel(context.Background())
				defer cancelTransport()
				transportContexts = append(transportContexts, ctx)
				index := i
				cancelOwnedTransport := func() {
					entered <- index
					<-releaseCancel
					cancelTransport()
				}

				if includeGroup && i == transfers-1 {
					h := manager.StartGroup(Spec{
						FileName: "old-account-upload-folder", Kind: KindUpload, Direction: "upload",
					})
					if !h.BindGroupCancelContext(ctx, cancelOwnedTransport) {
						t.Fatal("could not bind upload group cancellation owner")
					}
					continue
				}
				kind := KindUpload
				if i%2 != 0 {
					kind = KindDownload
				}
				h := manager.Start(Spec{
					FileName: "old-account-direct-transfer", Kind: kind, Direction: kind,
				})
				if !h.BindCancel(cancelOwnedTransport) {
					t.Fatal("could not bind direct transfer cancellation owner")
				}
			}

			// Account B's valid terminal history can be restored as soon as
			// Clear has removed A's records, before all old cancels settle.
			accountB := NewManager(8)
			b := accountB.Start(Spec{
				FileName: "new-account-completed.bin", Kind: KindDownload, Direction: "download",
			})
			b.Complete()
			bHistory := accountB.HistorySnapshot(8)
			if len(bHistory) != 1 {
				t.Fatal("could not prepare account B history")
			}

			clearDone := make(chan struct{})
			go func() {
				manager.Clear()
				close(clearDone)
			}()

			select {
			case <-entered:
			case <-time.After(10 * time.Second):
				t.Fatal("account Clear never entered a transport cancellation")
			}
			if err := manager.RestoreHistory(bHistory); err != nil {
				t.Fatalf("account B history could not be restored during old I/O teardown: %v", err)
			}

			// All independent cancellation callbacks must be invoked while
			// they are still blocked, rather than serially awaiting one slow
			// old I/O teardown before even starting the next cancellation.
			seen := 1
			timer := time.NewTimer(2 * time.Second)
		collect:
			for seen < transfers {
				select {
				case <-entered:
					seen++
				case <-timer.C:
					break collect
				}
			}
			timer.Stop()
			select {
			case <-clearDone:
				t.Error("Clear returned before all original transport callbacks settled")
			default:
			}
			release()
			select {
			case <-clearDone:
			case <-time.After(10 * time.Second):
				t.Fatal("Clear failed to join all cancellation callbacks")
			}
			if seen != transfers {
				t.Errorf("Clear began only %d/%d old-account cancellations while the first callback was blocked", seen, transfers)
			}
			for i, ctx := range transportContexts {
				if !errors.Is(ctx.Err(), context.Canceled) {
					t.Errorf("old account transport %d remained active after Clear: %v", i, ctx.Err())
				}
			}
			_, got := manager.Snapshot()
			if len(got) != 1 || got[0].FileName != bHistory[0].FileName || got[0].State != StateCompleted {
				t.Fatalf("old cancellation callbacks damaged restored account B history: %+v", got)
			}
		})
	}
}
