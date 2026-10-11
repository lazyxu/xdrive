package background

import (
	"context"
	"errors"
	"testing"
	"time"
)

// A task that acknowledges parent cancellation by stopping cleanly may return
// nil. Its handle and lease release still must report cancellation, not success.
func TestSchedulerParentCancelCleanReturnCannotCommitSuccess(t *testing.T) {
	parent, stopParent := context.WithCancel(context.Background())
	s := NewScheduler(parent, Config{
		Capacity: map[ResourceClass]int{ResourceBackgroundCPU: 1},
	})
	defer s.Close()

	started := make(chan struct{})
	leaseResult := make(chan error, 1)
	h, err := s.Submit(Task{
		Key:       "parent-cancel-clean-exit",
		Scope:     ScopeSystem,
		Trigger:   TriggerSystemEvent,
		Initiator: InitiatorSystem,
		Priority:  PriorityP1,
		Resource:  ResourceBackgroundCPU,
		Lease: func(context.Context, Descriptor) (Lease, bool, error) {
			return Lease{
				Release: func(_ context.Context, outcome error) error {
					leaseResult <- outcome
					return nil
				},
			}, true, nil
		},
		Run: func(ctx context.Context) error {
			close(started)
			<-ctx.Done()
			// A clean resource finalizer does not mean the cancelled task succeeded.
			return nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(10 * time.Second):
		t.Fatal("scheduled task never started")
	}
	stopParent()

	waitCtx, cancelWait := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelWait()
	result := h.Wait(waitCtx)
	if !errors.Is(result, context.Canceled) {
		t.Fatalf("parent-cancelled task reported success/incorrect result: %v, want context.Canceled", result)
	}
	select {
	case released := <-leaseResult:
		if !errors.Is(released, context.Canceled) {
			t.Fatalf("lease Release saw success/incorrect result after cancellation: %v", released)
		}
	case <-waitCtx.Done():
		t.Fatal("lease Release not observed after parent cancellation")
	}
	metrics := s.Snapshot()
	if metrics.Completed != 0 || metrics.Cancelled != 1 {
		t.Fatalf("parent-cancelled task was counted as successful: completed=%d cancelled=%d", metrics.Completed, metrics.Cancelled)
	}
}
