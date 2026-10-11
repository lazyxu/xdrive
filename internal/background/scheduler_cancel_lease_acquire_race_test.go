package background

import (
	"context"
	"errors"
	"testing"
	"time"
)

// A scheduler-owned cancellation accepted during a slow Lease acquisition
// must not start Task.Run if the provider later returns an acquired Lease.
// The newly acquired Lease must still be released as cancelled.
func TestSchedulerCancelDuringLeaseAcquireDoesNotStartTask(t *testing.T) {
	s := NewScheduler(context.Background(), Config{
		Capacity: map[ResourceClass]int{ResourceNetwork: 1},
	})
	leaseEntered := make(chan struct{})
	releaseLeaseAcquire := make(chan struct{})
	leaseReleased := make(chan error, 1)
	runInvoked := make(chan struct{}, 1)
	defer func() {
		select {
		case <-releaseLeaseAcquire:
		default:
			close(releaseLeaseAcquire)
		}
		s.Close()
	}()

	identity := Identity{Scope: ScopeSystem, Key: "cancel-while-acquiring-lease"}
	handle, err := s.Submit(Task{
		Key:       identity.Key,
		Scope:     identity.Scope,
		Trigger:   TriggerSystemEvent,
		Initiator: InitiatorSystem,
		Priority:  PriorityP1,
		Resource:  ResourceNetwork,
		Lease: func(context.Context, Descriptor) (Lease, bool, error) {
			close(leaseEntered)
			<-releaseLeaseAcquire
			return Lease{
				Release: func(_ context.Context, result error) error {
					leaseReleased <- result
					return nil
				},
			}, true, nil
		},
		Run: func(context.Context) error {
			runInvoked <- struct{}{}
			return nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-leaseEntered:
	case <-time.After(10 * time.Second):
		t.Fatal("scheduler never started acquiring the Lease")
	}

	if !s.Cancel(identity) {
		t.Fatal("scheduler refused to cancel a task while it was acquiring a Lease")
	}
	close(releaseLeaseAcquire)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := handle.Wait(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled task returned %v, want context.Canceled", err)
	}
	select {
	case <-runInvoked:
		t.Fatal("Task.Run started after cancellation was accepted during Lease acquisition")
	default:
	}
	select {
	case releasedWith := <-leaseReleased:
		if !errors.Is(releasedWith, context.Canceled) {
			t.Fatalf("acquired Lease was released as %v, want context.Canceled", releasedWith)
		}
	case <-ctx.Done():
		t.Fatal("Lease was not released after cancellation")
	}
	metrics := s.Snapshot()
	if metrics.Completed != 0 || metrics.Cancelled != 1 {
		t.Fatalf("cancelled task counted as success: completed=%d cancelled=%d",
			metrics.Completed, metrics.Cancelled)
	}
}
