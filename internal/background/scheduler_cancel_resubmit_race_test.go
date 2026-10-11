package background

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// A cancelled run can remain active while its I/O finalizer exits. A new user
// submission under the same identity must queue as a fresh run rather than
// deduplicating onto the already-cancelled handle.
func TestSchedulerCancelledRunDoesNotAbsorbImmediateResubmission(t *testing.T) {
	s := testScheduler(t, map[ResourceClass]int{ResourceNetwork: 1})

	firstStarted := make(chan struct{})
	firstCancelled := make(chan struct{})
	releaseFirst := make(chan struct{})
	var firstOnce sync.Once
	unblockFirst := func() { firstOnce.Do(func() { close(releaseFirst) }) }
	defer unblockFirst()

	identity := Identity{Scope: ScopeSystem, Key: "replace-after-cancel"}
	first, err := s.Submit(Task{
		Key: identity.Key, Scope: identity.Scope,
		Trigger: TriggerUserAction, Initiator: InitiatorSystem,
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
		t.Fatal("first run never started")
	}
	if !s.Cancel(identity) {
		t.Fatal("scheduler refused to cancel its running task")
	}
	select {
	case <-firstCancelled:
	case <-time.After(10 * time.Second):
		t.Fatal("first run never observed cancellation")
	}

	secondStarted := make(chan struct{})
	releaseSecond := make(chan struct{})
	var secondOnce sync.Once
	unblockSecond := func() { secondOnce.Do(func() { close(releaseSecond) }) }
	defer unblockSecond()
	second, err := s.Submit(Task{
		Key: identity.Key, Scope: identity.Scope,
		Trigger: TriggerUserAction, Initiator: InitiatorSystem,
		Priority: PriorityP1, Resource: ResourceNetwork,
		Run: func(context.Context) error {
			close(secondStarted)
			<-releaseSecond
			return nil
		},
	})
	if err != nil {
		t.Fatalf("new submission after accepted cancel failed: %v", err)
	}
	if second == first {
		t.Fatal("new submission was deduplicated onto the cancelled run's old handle")
	}
	unblockFirst()

	waitCtx, cancelWait := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelWait()
	if err := first.Wait(waitCtx); !errors.Is(err, context.Canceled) {
		t.Fatalf("first run ended as %v, want cancellation", err)
	}
	select {
	case <-secondStarted:
	case <-waitCtx.Done():
		t.Fatal("fresh submission never started after cancelled run exited")
	}
	live := s.TaskSnapshots(nil)
	if len(live) != 1 || live[0].Identity != identity || live[0].State != "running" {
		t.Fatalf("old run completion removed the new run's identity: %+v", live)
	}
	unblockSecond()
	if err := second.Wait(waitCtx); err != nil {
		t.Fatalf("fresh submission unexpectedly failed: %v", err)
	}
	metrics := s.Snapshot()
	if metrics.Submitted != 2 || metrics.Deduplicated != 0 ||
		metrics.Completed != 1 || metrics.Cancelled != 1 {
		t.Fatalf("resubmission metrics: %+v", metrics)
	}
}
