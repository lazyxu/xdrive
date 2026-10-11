package transfer

import (
	"context"
	"errors"
	"testing"
	"time"
)

// A success callback queued by an older transfer phase must not complete a
// transfer after the user has accepted cancellation and its owned transport
// context has been cancelled, before the I/O owner confirms terminalization.
func TestLateSuccessCannotOverridePendingCancellation(t *testing.T) {
	cases := []struct {
		name string
		late func(*Handle) error
	}{
		{
			name: "Complete",
			late: func(h *Handle) error { h.Complete(); return nil },
		},
		{
			name: "FinishCompleted",
			late: func(h *Handle) error { return h.Finish(StateCompleted, nil) },
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			manager := NewManager(8)
			h := manager.Start(Spec{
				FileName: "large-download.bin", Kind: KindDownload,
				Direction: "download", TotalBytes: 4096,
			})
			ownedCtx, ownedCancel := context.WithCancel(context.Background())
			defer ownedCancel()
			if !h.BindCancel(ownedCancel) {
				t.Fatal("download did not bind its Agent-owned transport context")
			}

			queued := make(chan struct{})
			release := make(chan struct{})
			result := make(chan error, 1)
			defer func() {
				select {
				case <-release:
				default:
					close(release)
				}
			}()
			go func() {
				close(queued)
				<-release
				result <- tc.late(h)
			}()
			select {
			case <-queued:
			case <-time.After(10 * time.Second):
				t.Fatal("old completion callback was not queued")
			}

			if err := manager.Cancel(h.ID()); err != nil {
				t.Fatalf("cancel download: %v", err)
			}
			if !errors.Is(ownedCtx.Err(), context.Canceled) {
				t.Fatalf("accepted cancel left owned transport active: %v", ownedCtx.Err())
			}
			beforeRevision, before := manager.Snapshot()
			if len(before) != 1 || before[0].State != StateCancelling || before[0].CompletedAt != nil {
				t.Fatalf("expected pending cancellation before late success: %+v", before)
			}

			close(release)
			select {
			case err := <-result:
				if err != nil {
					t.Fatalf("late completion returned error: %v", err)
				}
			case <-time.After(10 * time.Second):
				t.Fatal("late completion callback did not return")
			}
			afterRevision, after := manager.Snapshot()
			if afterRevision != beforeRevision || len(after) != 1 ||
				after[0].State != StateCancelling || after[0].CompletedAt != nil {
				t.Fatalf("old success committed after cancellation was accepted (revision %d -> %d): before=%+v after=%+v",
					beforeRevision, afterRevision, before, after)
			}

			if err := h.Finish(StateCancelled, context.Canceled); err != nil {
				t.Fatalf("owning I/O could not confirm cancellation: %v", err)
			}
			_, final := manager.Snapshot()
			if len(final) != 1 || final[0].State != StateCancelled || final[0].CompletedAt == nil {
				t.Fatalf("accepted cancellation did not reach terminal cancelled state: %+v", final)
			}
		})
	}
}
