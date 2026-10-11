package background

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// A running task may still execute a buffered ReportProgress callback after
// its own context has been cancelled by a parent, a lost lease, or a deadline.
// The callback must not change the last live snapshot during finalization.
func TestSchedulerExternalCancellationRejectsLateProgress(t *testing.T) {
	cases := []struct {
		name string
		want error
	}{
		{name: "parent", want: context.Canceled},
		{name: "lease-heartbeat", want: ErrLeaseLost},
		{name: "run-timeout", want: ErrRunTimeout},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			parent, cancelParent := context.WithCancel(context.Background())
			s := NewScheduler(parent, Config{
				Capacity: map[ResourceClass]int{ResourceBackgroundCPU: 1},
			})
			initialReported := make(chan struct{})
			lateReported := make(chan struct{})
			allowExit := make(chan struct{})
			var releaseOnce sync.Once
			unblock := func() { releaseOnce.Do(func() { close(allowExit) }) }
			t.Cleanup(func() {
				unblock()
				cancelParent()
				s.Close()
			})

			identity := Identity{Scope: ScopeSystem, Key: "external-cancel-late-" + tc.name}
			task := Task{
				Key:       identity.Key,
				Scope:     identity.Scope,
				Trigger:   TriggerSystemEvent,
				Initiator: InitiatorSystem,
				Priority:  PriorityP1,
				Resource:  ResourceBackgroundCPU,
				Run: func(ctx context.Context) error {
					ReportProgress(ctx, TaskProgress{Phase: "active", Current: 10, Total: 100})
					close(initialReported)
					<-ctx.Done()
					ReportProgress(ctx, TaskProgress{Phase: "stale-after-external-cancel", Current: 90, Total: 100})
					close(lateReported)
					<-allowExit
					return context.Cause(ctx)
				},
			}
			switch tc.name {
			case "lease-heartbeat":
				task.HeartbeatInterval = time.Millisecond
				task.Lease = func(context.Context, Descriptor) (Lease, bool, error) {
					return Lease{
						Heartbeat: func(context.Context) error {
							<-initialReported
							return errors.New("lease heartbeat failed")
						},
					}, true, nil
				}
			case "run-timeout":
				task.RunTimeout = 250 * time.Millisecond
			}
			h, err := s.Submit(task)
			if err != nil {
				t.Fatal(err)
			}
			select {
			case <-initialReported:
			case <-time.After(10 * time.Second):
				t.Fatal("run did not publish initial progress")
			}
			if tc.name == "parent" {
				cancelParent()
			}
			select {
			case <-lateReported:
			case <-time.After(10 * time.Second):
				t.Fatal("run never observed external cancellation and attempted late progress")
			}
			snapshots := s.TaskSnapshots(nil)
			if len(snapshots) != 1 || snapshots[0].Identity != identity ||
				snapshots[0].Progress.Phase != "active" || snapshots[0].Progress.Current != 10 {
				t.Fatalf("%s cancellation allowed stale progress to overwrite live snapshot: %+v", tc.name, snapshots)
			}
			unblock()
			waitCtx, cancelWait := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancelWait()
			if err := h.Wait(waitCtx); !errors.Is(err, tc.want) {
				t.Fatalf("%s final result = %v, want %v", tc.name, err, tc.want)
			}
		})
	}
}
