package background

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

func awaitStaleProgressSignal(t *testing.T, signal <-chan struct{}, label string) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(10 * time.Second):
		t.Fatalf("timed out waiting for %s", label)
	}
}

// A callback started by an old task may arrive after its handle has completed
// and a new submission has reused the same logical identity. That callback
// must never modify the new task's live progress.
func TestSchedulerCompletedRunLateProgressCannotOverwriteNewRun(t *testing.T) {
	s := testScheduler(t, map[ResourceClass]int{ResourceBackgroundCPU: 1})
	fireOldCallback := make(chan struct{})
	oldCallbackDone := make(chan struct{})
	defer func() {
		select {
		case <-fireOldCallback:
		default:
			close(fireOldCallback)
		}
	}()

	base := Task{
		Key: "same-progress-identity", Scope: ScopeSystem,
		Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
		Priority: PriorityP1, Resource: ResourceBackgroundCPU,
	}
	firstTask := base
	firstTask.Run = func(ctx context.Context) error {
		ReportProgress(ctx, TaskProgress{Phase: "first-run", Current: 1, Total: 10})
		go func() {
			<-fireOldCallback
			ReportProgress(ctx, TaskProgress{Phase: "stale-completed-run", Current: 99, Total: 100})
			close(oldCallbackDone)
		}()
		return nil
	}
	first, err := s.Submit(firstTask)
	if err != nil {
		t.Fatal(err)
	}
	waitCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := first.Wait(waitCtx); err != nil {
		t.Fatalf("first task did not finish: %v", err)
	}

	secondStarted := make(chan struct{})
	releaseSecond := make(chan struct{})
	defer close(releaseSecond)
	secondTask := base
	secondTask.Run = func(ctx context.Context) error {
		ReportProgress(ctx, TaskProgress{Phase: "new-run", Current: 4, Total: 10})
		close(secondStarted)
		<-releaseSecond
		return nil
	}
	second, err := s.Submit(secondTask)
	if err != nil {
		t.Fatal(err)
	}
	if second == first {
		t.Fatal("completed identity was not resubmitted as a fresh task")
	}
	awaitStaleProgressSignal(t, secondStarted, "new task start")
	close(fireOldCallback)
	awaitStaleProgressSignal(t, oldCallbackDone, "old completed task's late callback")

	live := s.TaskSnapshots(nil)
	if len(live) != 1 || live[0].Progress.Phase != "new-run" || live[0].Progress.Current != 4 {
		t.Fatalf("completed task's stale progress corrupted a newer submission: %+v", live)
	}
}

// An automatic retry reuses the task entry and identity but begins a new
// execution attempt. Progress emitted by the previous attempt after it fails
// must not regress the active retry.
func TestSchedulerFailedAttemptLateProgressCannotOverwriteRetry(t *testing.T) {
	s := testScheduler(t, map[ResourceClass]int{ResourceBackgroundCPU: 1})
	fireOldCallback := make(chan struct{})
	oldCallbackDone := make(chan struct{})
	defer func() {
		select {
		case <-fireOldCallback:
		default:
			close(fireOldCallback)
		}
	}()
	secondStarted := make(chan struct{})
	releaseSecond := make(chan struct{})
	defer close(releaseSecond)

	var attempts atomic.Int32
	_, err := s.Submit(Task{
		Key: "same-retry-progress", Scope: ScopeSystem,
		Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
		Priority: PriorityP1, Resource: ResourceBackgroundCPU,
		Retry: RetryPolicy{
			MaxAttempts: 2, Initial: time.Millisecond, Max: time.Millisecond, Jitter: -1,
		},
		Run: func(ctx context.Context) error {
			if attempts.Add(1) == 1 {
				go func() {
					<-fireOldCallback
					ReportProgress(ctx, TaskProgress{Phase: "stale-first-attempt", Current: 99, Total: 100})
					close(oldCallbackDone)
				}()
				return errors.New("retry first attempt")
			}
			ReportProgress(ctx, TaskProgress{Phase: "active-retry", Current: 3, Total: 10})
			close(secondStarted)
			<-releaseSecond
			return nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	awaitStaleProgressSignal(t, secondStarted, "second retry attempt")
	close(fireOldCallback)
	awaitStaleProgressSignal(t, oldCallbackDone, "previous attempt's late callback")

	live := s.TaskSnapshots(nil)
	if len(live) != 1 || live[0].Attempt != 2 ||
		live[0].Progress.Phase != "active-retry" || live[0].Progress.Current != 3 {
		t.Fatalf("old attempt's stale progress corrupted the active retry: %+v", live)
	}
}
