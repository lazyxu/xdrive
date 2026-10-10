package background

import (
	"context"
	"testing"
	"time"
)

// A second Close call must join an in-progress shutdown instead of returning
// while the first caller is still waiting for a running task to exit.
//
// Interleaving: worker enters Run -> first Close cancels it -> worker acknowledges
// cancellation but remains blocked on a finalizer -> second Close -> finalizer
// released. The worker's exit is controlled explicitly, not by a sleep.
func TestSchedulerConcurrentCloseWaitsForRunningTask(t *testing.T) {
	s := NewScheduler(context.Background(), Config{
		Capacity: map[ResourceClass]int{ResourceMediaCPU: 1},
	})
	started := make(chan struct{})
	cancelled := make(chan struct{})
	release := make(chan struct{})
	workerExited := make(chan struct{})
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
		s.Close()
	}()

	h, err := s.Submit(Task{
		Scope: ScopeSystem, Trigger: TriggerSystemEvent,
		Initiator: InitiatorSystem, Key: "concurrent-close-finalizer",
		Priority: PriorityP0, Resource: ResourceMediaCPU,
		Run: func(ctx context.Context) error {
			defer close(workerExited)
			close(started)
			<-ctx.Done()
			close(cancelled)
			<-release
			return context.Cause(ctx)
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	<-started

	firstDone := make(chan struct{})
	go func() {
		s.Close()
		close(firstDone)
	}()

	select {
	case <-cancelled: // First shutdown has cancelled a still-running worker.
	case <-time.After(5 * time.Second):
		t.Fatal("first Close did not cancel running task")
	}

	secondDone := make(chan struct{})
	secondStarted := make(chan struct{})
	go func() {
		close(secondStarted)
		s.Close()
		close(secondDone)
	}()
	<-secondStarted

	// The task cannot exit until release is closed. Returning before that is
	// an actual lifecycle contract violation, not a timing-based assertion.
	premature := false
	select {
	case <-secondDone:
		premature = true
	case <-time.After(300 * time.Millisecond):
		// Correct Close remains blocked on the same worker.
	}
	select {
	case <-firstDone:
		t.Error("first Close returned while finalizer was blocked")
	default:
	}
	select {
	case <-workerExited:
		t.Error("worker exited before its finalizer was released")
	default:
	}

	close(release)
	for name, done := range map[string]<-chan struct{}{
		"first Close": firstDone, "second Close": secondDone,
		"worker exit": workerExited,
	} {
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Errorf("%s never completed after finalizer release", name)
		}
	}
	if err := h.Wait(context.Background()); err == nil {
		t.Error("task should stop with scheduler cancellation")
	}
	if premature {
		t.Fatal("second concurrent Close returned before active worker completed; shutdown join was skipped")
	}
}
