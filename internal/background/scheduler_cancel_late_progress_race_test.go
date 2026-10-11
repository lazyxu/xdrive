package background

import (
	"context"
	"errors"
	"testing"
	"time"
)

// Once cancellation is accepted, a running task may still be cleaning up.
// Progress from that old task must not change its cancelling snapshot.
func TestSchedulerCancelledRunCannotPublishLateProgress(t *testing.T) {
	s := testScheduler(t, map[ResourceClass]int{ResourceBackgroundCPU: 1})
	initialReported := make(chan struct{})
	lateReported := make(chan struct{})
	allowExit := make(chan struct{})
	defer func() {
		select {
		case <-allowExit:
		default:
			close(allowExit)
		}
	}()

	identity := Identity{Scope: ScopeSystem, Key: "cancel-fences-progress"}
	h, err := s.Submit(Task{
		Key: identity.Key, Scope: identity.Scope,
		Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
		Priority: PriorityP1, Resource: ResourceBackgroundCPU,
		Run: func(ctx context.Context) error {
			ReportProgress(ctx, TaskProgress{Phase: "transferring", Current: 10, Total: 100})
			close(initialReported)
			<-ctx.Done()
			// A worker may report a buffered observation while unwinding.
			ReportProgress(ctx, TaskProgress{Phase: "late-after-cancel", Current: 90, Total: 100})
			close(lateReported)
			<-allowExit
			return context.Cause(ctx)
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-initialReported:
	case <-time.After(10 * time.Second):
		t.Fatal("task never published its initial progress")
	}
	if !s.Cancel(identity) {
		t.Fatal("scheduler refused cancellation of running task")
	}
	select {
	case <-lateReported:
	case <-time.After(10 * time.Second):
		t.Fatal("cancelled worker never reported its late progress")
	}
	live := s.TaskSnapshots(nil)
	if len(live) != 1 || live[0].Identity != identity || live[0].State != "cancelling" ||
		live[0].Progress.Phase != "transferring" || live[0].Progress.Current != 10 {
		t.Fatalf("late progress changed a cancelling task snapshot: %+v", live)
	}
	close(allowExit)
	waitCtx, stop := context.WithTimeout(context.Background(), 10*time.Second)
	defer stop()
	if err := h.Wait(waitCtx); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled run reported %v, want context.Canceled", err)
	}
}
