package background

import (
	"context"
	"errors"
	"testing"
	"time"
)

// A Cancel accepted while Lease.Release is still outstanding must not allow
// a successful lease settlement and an independently cancelled Handle result.
func TestSchedulerCancelDuringLeaseReleaseHasConsistentOutcome(t *testing.T) {
	s := NewScheduler(context.Background(), Config{
		Capacity: map[ResourceClass]int{ResourceNetwork: 1},
	})
	releaseEntered := make(chan error, 1)
	allowRelease := make(chan struct{})
	defer func() {
		select {
		case <-allowRelease:
		default:
			close(allowRelease)
		}
		s.Close()
	}()
	identity := Identity{Scope: ScopeSystem, Key: "cancel-during-lease-release"}
	h, err := s.Submit(Task{
		Key: identity.Key, Scope: identity.Scope,
		Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
		Priority: PriorityP1, Resource: ResourceNetwork,
		Lease: func(context.Context, Descriptor) (Lease, bool, error) {
			return Lease{Release: func(_ context.Context, result error) error {
				releaseEntered <- result
				<-allowRelease
				return nil
			}}, true, nil
		},
		Run: func(context.Context) error { return nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-releaseEntered:
	case <-time.After(10 * time.Second):
		t.Fatal("Lease.Release was never entered")
	}
	// The Scheduler still advertises this as a running cancellable task,
	// even though the lease has begun settling the successful result.
	accepted := s.Cancel(identity)
	close(allowRelease)
	ctx, stop := context.WithTimeout(context.Background(), 10*time.Second)
	defer stop()
	result := h.Wait(ctx)
	if accepted && errors.Is(result, context.Canceled) {
		t.Fatal("Cancel returned success after Lease.Release began settling success, causing handle cancellation to disagree with lease settlement")
	}
}
