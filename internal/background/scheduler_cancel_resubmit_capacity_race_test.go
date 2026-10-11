package background

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// With multiple network workers, a replacement of an already-cancelled task
// must not start until the old run finishes releasing its resources.
func TestSchedulerCancelledReplacementWaitsForOldFinalizerWithSpareCapacity(t *testing.T) {
	s := testScheduler(t, map[ResourceClass]int{ResourceNetwork: 2})
	firstStarted := make(chan struct{})
	firstCancelled := make(chan struct{})
	releaseFirst := make(chan struct{})
	var firstOnce sync.Once
	unblockFirst := func() { firstOnce.Do(func() { close(releaseFirst) }) }
	defer unblockFirst()

	identity := Identity{Scope: ScopeSystem, Key: "same-id-spare-workers"}
	first, err := s.Submit(Task{
		Key: identity.Key, Scope: identity.Scope,
		Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
		Priority: PriorityP1, Resource: ResourceNetwork,
		Run: func(ctx context.Context) error {
			close(firstStarted)
			<-ctx.Done()
			close(firstCancelled)
			<-releaseFirst
			return context.Cause(ctx)
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-firstStarted:
	case <-time.After(10 * time.Second):
		t.Fatal("old run never started")
	}
	if !s.Cancel(identity) {
		t.Fatal("old run was not cancelled")
	}
	select {
	case <-firstCancelled:
	case <-time.After(10 * time.Second):
		t.Fatal("old run did not observe cancellation")
	}

	secondStarted := make(chan struct{})
	releaseSecond := make(chan struct{})
	var secondOnce sync.Once
	unblockSecond := func() { secondOnce.Do(func() { close(releaseSecond) }) }
	defer unblockSecond()
	second, err := s.Submit(Task{
		Key: identity.Key, Scope: identity.Scope,
		Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
		Priority: PriorityP1, Resource: ResourceNetwork,
		Run: func(context.Context) error {
			close(secondStarted)
			<-releaseSecond
			return nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if first == second {
		t.Fatal("fresh submission reused the cancelled handle")
	}
	select {
	case <-secondStarted:
		t.Fatal("new run overlapped old cancelled finalizer with spare capacity")
	case <-time.After(250 * time.Millisecond):
		// Two workers are available but identical live executions are serialized.
	}
	unblockFirst()
	ctx, cancelWait := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelWait()
	if err := first.Wait(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("old task ended as %v, want cancelled", err)
	}
	select {
	case <-secondStarted:
	case <-ctx.Done():
		t.Fatal("fresh task did not start when predecessor finished")
	}
	unblockSecond()
	if err := second.Wait(ctx); err != nil {
		t.Fatalf("fresh task failed: %v", err)
	}
}
