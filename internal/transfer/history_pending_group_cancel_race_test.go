package transfer

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// A terminal group cannot be durable history while its owned cancellation
// callback is still running. The writer may consume an early notification
// before the callback settles, so it must receive another event afterward.
func TestHistorySnapshotWaitsForGroupCancellationHandoff(t *testing.T) {
	cases := []struct {
		name  string
		state string
		err   error
	}{
		{name: "completed", state: StateCompleted},
		{name: "failed", state: StateFailed, err: errors.New("upload failed")},
		{name: "cancelled", state: StateCancelled, err: context.Canceled},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := NewManager(8)
			group := m.StartGroup(Spec{
				FileName: "old-account-upload-folder", Kind: KindUpload, Direction: "upload",
				TotalItems: 1, TotalBytes: 100,
			})
			ctx, cancelTransport := context.WithCancel(context.Background())
			defer cancelTransport()
			entered := make(chan struct{})
			gate := make(chan struct{})
			var once sync.Once
			release := func() { once.Do(func() { close(gate) }) }
			finished := make(chan struct{})
			var finishErr error
			t.Cleanup(func() {
				release()
				select {
				case <-finished:
				case <-time.After(10 * time.Second):
					t.Error("group Finish did not exit during cleanup")
				}
			})
			if !group.BindGroupCancelContext(ctx, func() {
				close(entered)
				<-gate
				cancelTransport()
			}) {
				t.Fatal("group cancellation owner was not bound")
			}
			go func() {
				finishErr = group.Finish(tc.state, tc.err)
				close(finished)
			}()
			select {
			case <-entered:
			case <-time.After(10 * time.Second):
				t.Fatal("group Finish did not enter its cancellation callback")
			}
			if ctx.Err() != nil {
				t.Fatal("group transport was cancelled before the callback was released")
			}
			_, visible := m.Snapshot()
			if len(visible) != 1 || visible[0].State != tc.state {
				t.Fatalf("terminal state was not published: %+v", visible)
			}
			if premature := m.HistorySnapshot(10); len(premature) != 0 {
				t.Fatalf("group persisted before its transport cancellation settled: %+v", premature)
			}
			// Simulate a history writer draining a notification while teardown
			// is still pending; it must be woken up again after the handoff.
			select {
			case <-m.HistoryEvents():
			default:
			}
			release()
			select {
			case <-finished:
			case <-time.After(10 * time.Second):
				t.Fatal("group Finish did not return after releasing cancellation")
			}
			if finishErr != nil || !errors.Is(ctx.Err(), context.Canceled) {
				t.Fatalf("terminal callback failed to settle: Finish=%v transport=%v", finishErr, ctx.Err())
			}
			history := m.HistorySnapshot(10)
			if len(history) != 1 || history[0].ID != group.ID() || history[0].State != tc.state {
				t.Fatalf("settled group missing from durable history: %+v", history)
			}
			select {
			case <-m.HistoryEvents():
			default:
				t.Fatal("history writer was not re-notified after cancellation completed")
			}
		})
	}
}
