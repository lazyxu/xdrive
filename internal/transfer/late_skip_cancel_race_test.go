package transfer

import (
	"context"
	"errors"
	"testing"
	"time"
)

// A dedup/skipped notification queued before cancellation must not commit
// completion after the Agent has begun aborting the owning transfer.
func TestLateSkippedCompletionCannotOverridePendingCancellation(t *testing.T) {
	manager := NewManager(8)
	h := manager.Start(Spec{
		FileName:  "queued-skip.bin",
		Kind:      KindUpload,
		Direction: "upload",
		Phase:     PhaseQueued,
	})
	transportCtx, cancelTransport := context.WithCancel(context.Background())
	defer cancelTransport()
	if !h.BindCancel(cancelTransport) {
		t.Fatal("queued upload did not accept its owning cancellation context")
	}

	queued := make(chan struct{})
	release := make(chan struct{})
	callbackDone := make(chan struct{})
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
		h.CompleteSkipped()
		close(callbackDone)
	}()
	select {
	case <-queued:
	case <-time.After(10 * time.Second):
		t.Fatal("skipped-completion callback not queued")
	}

	if err := manager.Cancel(h.ID()); err != nil {
		t.Fatalf("cancel queued upload: %v", err)
	}
	if !errors.Is(transportCtx.Err(), context.Canceled) {
		t.Fatalf("cancel did not abort owning transport: %v", transportCtx.Err())
	}
	beforeRevision, before := manager.Snapshot()
	if len(before) != 1 || before[0].State != StateCancelling || before[0].CompletedAt != nil {
		t.Fatalf("cancel did not enter pending state: %+v", before)
	}
	close(release)
	select {
	case <-callbackDone:
	case <-time.After(10 * time.Second):
		t.Fatal("late skipped-completion callback did not finish")
	}
	lateRevision, late := manager.Snapshot()
	if lateRevision != beforeRevision || len(late) != 1 || late[0].State != StateCancelling || late[0].CompletedAt != nil {
		t.Fatalf("late skipped-completion overwrote pending cancellation (%d -> %d): %+v", beforeRevision, lateRevision, late)
	}
	if err := h.Finish(StateCancelled, context.Canceled); err != nil {
		t.Fatalf("owning transport failed to confirm cancellation: %v", err)
	}
	_, final := manager.Snapshot()
	if len(final) != 1 || final[0].State != StateCancelled || final[0].CompletedAt == nil {
		t.Fatalf("late skipped-completion prevented real cancellation: %+v", final)
	}
}
