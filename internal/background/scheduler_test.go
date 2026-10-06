package background

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func testScheduler(t *testing.T, capacity map[ResourceClass]int) *Scheduler {
	t.Helper()
	s := NewScheduler(context.Background(), Config{Capacity: capacity})
	t.Cleanup(s.Close)
	return s
}

func TestSchedulerPriorityAndPromotion(t *testing.T) {
	s := testScheduler(t, map[ResourceClass]int{ResourceMediaCPU: 1})
	block := make(chan struct{})
	started := make(chan string, 3)

	first, err := s.Submit(Task{Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem, Key: "block", Priority: PriorityP0, Resource: ResourceMediaCPU, Run: func(context.Context) error {
		started <- "block"
		<-block
		return nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("blocker did not start")
	}

	low, err := s.Submit(Task{Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem, Key: "low", Priority: PriorityP4, Resource: ResourceMediaCPU, Run: func(context.Context) error {
		started <- "low"
		return nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	high, err := s.Submit(Task{Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem, Key: "high", Priority: PriorityP1, Resource: ResourceMediaCPU, Run: func(context.Context) error {
		started <- "high"
		return nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	promoted, err := s.Submit(Task{Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem, Key: "low", Priority: PriorityP0, Resource: ResourceMediaCPU, Run: func(context.Context) error { return errors.New("must dedupe") }})
	if err != nil {
		t.Fatal(err)
	}
	if promoted != low {
		t.Fatal("duplicate submission did not return original handle")
	}

	close(block)
	if err := first.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := <-started; got != "low" {
		t.Fatalf("first queued task=%q, want low after promotion", got)
	}
	if got := <-started; got != "high" {
		t.Fatalf("second queued task=%q, want high", got)
	}
	if err := low.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := high.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}

	snapshot := s.Snapshot()
	if snapshot.Deduplicated != 1 || snapshot.Promoted != 1 {
		t.Fatalf("snapshot=%+v", snapshot)
	}
}

func TestSchedulerOwnerFairnessRoundRobinWithinPriority(t *testing.T) {
	s := testScheduler(t, map[ResourceClass]int{ResourceMediaCPU: 1})
	block := make(chan struct{})
	started := make(chan string, 8)

	blocker, err := s.Submit(Task{
		Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
		Key: "block-fairness", Priority: PriorityP0, Resource: ResourceMediaCPU,
		Run: func(context.Context) error {
			started <- "block"
			<-block
			return nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := <-started; got != "block" {
		t.Fatalf("started=%q want blocker", got)
	}

	type queuedTask struct {
		owner uint64
		key   string
	}
	queued := []queuedTask{
		{owner: 1, key: "a1"},
		{owner: 1, key: "a2"},
		{owner: 1, key: "a3"},
		{owner: 2, key: "b1"},
		{owner: 3, key: "c1"},
	}
	handles := make([]*Handle, 0, len(queued))
	for _, item := range queued {
		item := item
		h, err := s.Submit(Task{
			Scope: ScopeUser, OwnerID: item.owner,
			Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
			Key: item.key, Priority: PriorityP2, Resource: ResourceMediaCPU,
			Run: func(context.Context) error {
				started <- item.key
				return nil
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		handles = append(handles, h)
	}

	close(block)
	if err := blocker.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	want := []string{"a1", "b1", "c1", "a2", "a3"}
	for index, expected := range want {
		select {
		case got := <-started:
			if got != expected {
				t.Fatalf("start[%d]=%q want=%q", index, got, expected)
			}
		case <-time.After(time.Second):
			t.Fatalf("timed out waiting for start[%d]=%q", index, expected)
		}
	}
	for _, handle := range handles {
		if err := handle.Wait(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
}

func TestSchedulerPriorityPrecedesOwnerFairness(t *testing.T) {
	s := testScheduler(t, map[ResourceClass]int{ResourceBackgroundCPU: 1})
	block := make(chan struct{})
	started := make(chan string, 4)

	blocker, err := s.Submit(Task{
		Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
		Key: "block-priority", Priority: PriorityP0, Resource: ResourceBackgroundCPU,
		Run: func(context.Context) error {
			started <- "block"
			<-block
			return nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	<-started

	submit := func(ownerID uint64, key string, priority Priority) *Handle {
		t.Helper()
		h, err := s.Submit(Task{
			Scope: ScopeUser, OwnerID: ownerID,
			Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
			Key: key, Priority: priority, Resource: ResourceBackgroundCPU,
			Run: func(context.Context) error {
				started <- key
				return nil
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		return h
	}

	low := submit(1, "low-a", PriorityP2)
	highB := submit(2, "high-b", PriorityP1)
	highA := submit(1, "high-a", PriorityP1)

	close(block)
	if err := blocker.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	first := <-started
	second := <-started
	third := <-started
	if first == "low-a" || second == "low-a" || third != "low-a" {
		t.Fatalf("start order=%q,%q,%q; P1 tasks must both precede P2", first, second, third)
	}
	for _, handle := range []*Handle{low, highB, highA} {
		if err := handle.Wait(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
}

func TestSchedulerDueRetryReentersPriorityBeforeLaterBacklog(t *testing.T) {
	s := testScheduler(t, map[ResourceClass]int{ResourceBackgroundCPU: 1})
	var attempts atomic.Int32
	firstAttempt := make(chan struct{})
	started := make(chan string, 4)
	backlogRelease := make(chan struct{})

	retry, err := s.Submit(Task{
		Scope: ScopeSystem, Trigger: TriggerReconcile, Initiator: InitiatorSystem,
		Key: "due-retry", Priority: PriorityP0, Resource: ResourceBackgroundCPU,
		Retry: RetryPolicy{
			MaxAttempts: 2,
			Initial:     20 * time.Millisecond,
			Max:         20 * time.Millisecond,
			Jitter:      -1,
		},
		Run: func(context.Context) error {
			if attempts.Add(1) == 1 {
				close(firstAttempt)
				return errors.New("retry me")
			}
			started <- "retry"
			return nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	<-firstAttempt

	deadline := time.Now().Add(time.Second)
	for {
		snapshots := s.TaskSnapshots(nil)
		if len(snapshots) == 1 && snapshots[0].ReadyAt != nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("retry never entered delayed queue: %+v", snapshots)
		}
		time.Sleep(time.Millisecond)
	}

	backlogHandles := make([]*Handle, 0, 3)
	for i := 1; i <= 3; i++ {
		key := string(rune('0' + i))
		h, err := s.Submit(Task{
			Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
			Key: "backlog-" + key, Priority: PriorityP4, Resource: ResourceBackgroundCPU,
			Run: func(context.Context) error {
				started <- "backlog-" + key
				<-backlogRelease
				return nil
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		backlogHandles = append(backlogHandles, h)
	}

	if got := <-started; got != "backlog-1" {
		t.Fatalf("first ready backlog=%q want backlog-1", got)
	}
	time.Sleep(30 * time.Millisecond)
	backlogRelease <- struct{}{}
	if got := <-started; got != "retry" {
		t.Fatalf("next task=%q want due P0 retry before remaining P4 backlog", got)
	}
	backlogRelease <- struct{}{}
	backlogRelease <- struct{}{}

	if err := retry.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, handle := range backlogHandles {
		if err := handle.Wait(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
}

func TestSchedulerResourceCapacity(t *testing.T) {
	s := testScheduler(t, map[ResourceClass]int{ResourceMediaCPU: 2})
	var running atomic.Int32
	var maxRunning atomic.Int32
	release := make(chan struct{})
	handles := make([]*Handle, 0, 4)

	for i := 0; i < 4; i++ {
		h, err := s.Submit(Task{Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem, Key: string(rune('a' + i)), Priority: PriorityP1, Resource: ResourceMediaCPU, Run: func(context.Context) error {
			n := running.Add(1)
			for {
				old := maxRunning.Load()
				if n <= old || maxRunning.CompareAndSwap(old, n) {
					break
				}
			}
			<-release
			running.Add(-1)
			return nil
		}})
		if err != nil {
			t.Fatal(err)
		}
		handles = append(handles, h)
	}

	deadline := time.Now().Add(time.Second)
	for maxRunning.Load() < 2 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if got := maxRunning.Load(); got != 2 {
		t.Fatalf("max running=%d, want 2", got)
	}
	close(release)
	for _, h := range handles {
		if err := h.Wait(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
}

func TestSchedulerRetryBackoff(t *testing.T) {
	s := testScheduler(t, map[ResourceClass]int{ResourceBackgroundCPU: 1})
	var attempts atomic.Int32
	h, err := s.Submit(Task{Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
		Key: "retry", Priority: PriorityP3, Resource: ResourceBackgroundCPU,
		Retry: RetryPolicy{MaxAttempts: 3, Initial: 5 * time.Millisecond, Max: 10 * time.Millisecond},
		Run: func(context.Context) error {
			if attempts.Add(1) < 3 {
				return errors.New("temporary")
			}
			return nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := h.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	if attempts.Load() != 3 {
		t.Fatalf("attempts=%d, want 3", attempts.Load())
	}
	snapshot := s.Snapshot()
	if snapshot.Retried != 2 || snapshot.Completed != 1 {
		t.Fatalf("snapshot=%+v", snapshot)
	}
}

func TestSchedulerCancellation(t *testing.T) {
	s := testScheduler(t, map[ResourceClass]int{ResourceInteractiveIO: 1})
	started := make(chan struct{})
	h, err := s.Submit(Task{Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem, Key: "cancel", Priority: PriorityP0, Resource: ResourceInteractiveIO, Run: func(ctx context.Context) error {
		close(started)
		<-ctx.Done()
		return context.Cause(ctx)
	}})
	if err != nil {
		t.Fatal(err)
	}
	<-started
	if !s.Cancel(Identity{Scope: ScopeSystem, Key: "cancel"}) {
		t.Fatal("cancel returned false")
	}
	if err := h.Wait(context.Background()); !errors.Is(err, context.Canceled) {
		t.Fatalf("wait err=%v", err)
	}
}

func TestSchedulerLeaseHeartbeatAndRelease(t *testing.T) {
	s := testScheduler(t, map[ResourceClass]int{ResourceNetwork: 1})
	var heartbeats atomic.Int32
	var released atomic.Bool
	runStarted := make(chan struct{})
	releaseRun := make(chan struct{})

	h, err := s.Submit(Task{Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
		Key: "leased", Priority: PriorityP2, Resource: ResourceNetwork,
		HeartbeatInterval: 5 * time.Millisecond,
		Lease: func(context.Context, Descriptor) (Lease, bool, error) {
			return Lease{
				Heartbeat: func(context.Context) error { heartbeats.Add(1); return nil },
				Release: func(_ context.Context, runErr error) error {
					if runErr != nil {
						t.Errorf("release runErr=%v", runErr)
					}
					released.Store(true)
					return nil
				},
			}, true, nil
		},
		Run: func(context.Context) error {
			close(runStarted)
			<-releaseRun
			return nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	<-runStarted
	deadline := time.Now().Add(time.Second)
	for heartbeats.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	close(releaseRun)
	if err := h.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	if heartbeats.Load() == 0 {
		t.Fatal("lease heartbeat did not run")
	}
	if !released.Load() {
		t.Fatal("lease release did not run")
	}
}

func TestSchedulerLeaseLossCancelsTask(t *testing.T) {
	s := testScheduler(t, map[ResourceClass]int{ResourceMLCPU: 1})
	var releases atomic.Int32
	h, err := s.Submit(Task{Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
		Key: "lease-lost", Priority: PriorityP2, Resource: ResourceMLCPU,
		HeartbeatInterval: time.Millisecond,
		Lease: func(context.Context, Descriptor) (Lease, bool, error) {
			return Lease{
				Heartbeat: func(context.Context) error { return errors.New("db lease lost") },
				Release:   func(context.Context, error) error { releases.Add(1); return nil },
			}, true, nil
		},
		Run: func(ctx context.Context) error {
			<-ctx.Done()
			return context.Cause(ctx)
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	err = h.Wait(context.Background())
	if !errors.Is(err, ErrLeaseLost) {
		t.Fatalf("wait err=%v, want lease lost", err)
	}
	if releases.Load() != 1 {
		t.Fatalf("releases=%d, want 1", releases.Load())
	}
}

func TestSchedulerMetricsSnapshot(t *testing.T) {
	s := testScheduler(t, map[ResourceClass]int{ResourceMediaCPU: 1})
	gate := make(chan struct{})
	var once sync.Once
	running, _ := s.Submit(Task{Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem, Key: "running", Priority: PriorityP1, Resource: ResourceMediaCPU, Run: func(context.Context) error {
		once.Do(func() { close(gate) })
		<-time.After(20 * time.Millisecond)
		return nil
	}})
	<-gate
	queued, _ := s.Submit(Task{Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem, Key: "queued", Priority: PriorityP2, Resource: ResourceMediaCPU, Run: func(context.Context) error { return nil }})
	snapshot := s.Snapshot()
	if snapshot.Running != 1 || snapshot.Queued != 1 {
		t.Fatalf("snapshot=%+v", snapshot)
	}
	if err := running.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := queued.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestSchedulerParentCancellationCompletesQueuedAndRunning(t *testing.T) {
	ctx, cancel := context.WithCancelCause(context.Background())
	s := NewScheduler(ctx, Config{Capacity: map[ResourceClass]int{ResourceMediaCPU: 1}})
	started := make(chan struct{})
	running, err := s.Submit(Task{Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem, Key: "running-parent", Priority: PriorityP1, Resource: ResourceMediaCPU, Run: func(ctx context.Context) error {
		close(started)
		<-ctx.Done()
		return context.Cause(ctx)
	}})
	if err != nil {
		t.Fatal(err)
	}
	<-started
	queued, err := s.Submit(Task{Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem, Key: "queued-parent", Priority: PriorityP2, Resource: ResourceMediaCPU, Run: func(context.Context) error {
		return errors.New("must not run")
	}})
	if err != nil {
		t.Fatal(err)
	}

	parentErr := errors.New("server stopping")
	cancel(parentErr)
	if err := running.Wait(context.Background()); !errors.Is(err, parentErr) {
		t.Fatalf("running err=%v, want parent cause", err)
	}
	if err := queued.Wait(context.Background()); !errors.Is(err, parentErr) {
		t.Fatalf("queued err=%v, want parent cause", err)
	}
}

func TestSchedulerCloseAndQueuedCancelAreIdempotent(t *testing.T) {
	for i := 0; i < 100; i++ {
		s := NewScheduler(context.Background(), Config{Capacity: map[ResourceClass]int{ResourceMediaCPU: 1}})
		block := make(chan struct{})
		started := make(chan struct{})
		_, err := s.Submit(Task{Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem, Key: "block", Priority: PriorityP0, Resource: ResourceMediaCPU, Run: func(ctx context.Context) error {
			close(started)
			select {
			case <-block:
				return nil
			case <-ctx.Done():
				return context.Cause(ctx)
			}
		}})
		if err != nil {
			t.Fatal(err)
		}
		<-started
		queued, err := s.Submit(Task{Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem, Key: "queued", Priority: PriorityP1, Resource: ResourceMediaCPU, Run: func(context.Context) error {
			return errors.New("must not run")
		}})
		if err != nil {
			t.Fatal(err)
		}

		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			s.Close()
		}()
		go func() {
			defer wg.Done()
			_ = s.Cancel(Identity{Scope: ScopeSystem, Key: "queued"})
		}()
		wg.Wait()
		close(block)
		if err := queued.Wait(context.Background()); err == nil {
			t.Fatal("queued task unexpectedly completed successfully")
		}
	}
}

func TestSchedulerUserScopePreventsCrossOwnerDeduplication(t *testing.T) {
	s := testScheduler(t, map[ResourceClass]int{ResourceMediaCPU: 2})
	release := make(chan struct{})
	var started atomic.Int32

	submit := func(ownerID uint64) *Handle {
		t.Helper()
		h, err := s.Submit(Task{
			Key:         "thumbnail:node-7:r3:512",
			Scope:       ScopeUser,
			OwnerID:     ownerID,
			Trigger:     TriggerUserAction,
			Initiator:   InitiatorUser,
			InitiatorID: ownerID,
			Priority:    PriorityP0,
			Resource:    ResourceMediaCPU,
			Run: func(context.Context) error {
				started.Add(1)
				<-release
				return nil
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		return h
	}

	a := submit(11)
	b := submit(22)
	deadline := time.Now().Add(time.Second)
	for started.Load() < 2 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if started.Load() != 2 {
		t.Fatalf("started=%d, want two independent user-owned tasks", started.Load())
	}
	close(release)
	if err := a.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := b.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	if snapshot := s.Snapshot(); snapshot.Deduplicated != 0 {
		t.Fatalf("snapshot=%+v, cross-owner tasks must not deduplicate", snapshot)
	}
}

func TestSchedulerSameOwnerUserTaskDeduplicatesAndPromotesAttribution(t *testing.T) {
	s := testScheduler(t, map[ResourceClass]int{ResourceMediaCPU: 1})
	block := make(chan struct{})
	started := make(chan struct{})
	_, err := s.Submit(Task{Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem, Key: "block", Priority: PriorityP0, Resource: ResourceMediaCPU, Run: func(context.Context) error {
		close(started)
		<-block
		return nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	<-started

	var descriptor Descriptor
	low, err := s.Submit(Task{
		Key: "thumb:42", Scope: ScopeUser, OwnerID: 7,
		Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
		Priority: PriorityP3, Resource: ResourceMediaCPU,
		Lease: func(_ context.Context, got Descriptor) (Lease, bool, error) {
			descriptor = got
			return Lease{}, true, nil
		},
		Run: func(context.Context) error { return nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	high, err := s.Submit(Task{
		Key: "thumb:42", Scope: ScopeUser, OwnerID: 7,
		Trigger: TriggerUserAction, Initiator: InitiatorUser, InitiatorID: 7,
		Priority: PriorityP0, Resource: ResourceMediaCPU,
		Run: func(context.Context) error { return errors.New("must dedupe") },
	})
	if err != nil {
		t.Fatal(err)
	}
	if low != high {
		t.Fatal("same-owner duplicate did not share handle")
	}
	close(block)
	if err := low.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	if descriptor.Scope != ScopeUser || descriptor.OwnerID != 7 ||
		descriptor.Trigger != TriggerUserAction || descriptor.Initiator != InitiatorUser ||
		descriptor.InitiatorID != 7 || descriptor.Priority != PriorityP0 {
		t.Fatalf("descriptor=%+v", descriptor)
	}
}

func TestSchedulerCancelDoesNotRetryRunningTask(t *testing.T) {
	s := testScheduler(t, map[ResourceClass]int{ResourceBackgroundCPU: 1})
	runStarted := make(chan struct{})
	allowReturn := make(chan struct{})
	var attempts atomic.Int32
	h, err := s.Submit(Task{Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
		Key:      "cancel-retry",
		Priority: PriorityP3,
		Resource: ResourceBackgroundCPU,
		Retry:    RetryPolicy{MaxAttempts: 3, Initial: time.Millisecond, Max: time.Millisecond},
		Run: func(context.Context) error {
			attempts.Add(1)
			close(runStarted)
			<-allowReturn
			return errors.New("temporary")
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	<-runStarted
	if !s.Cancel(Identity{Scope: ScopeSystem, Key: "cancel-retry"}) {
		t.Fatal("cancel returned false")
	}
	close(allowReturn)
	if err := h.Wait(context.Background()); !errors.Is(err, context.Canceled) {
		t.Fatalf("wait err=%v, want cancelled", err)
	}
	time.Sleep(10 * time.Millisecond)
	if attempts.Load() != 1 {
		t.Fatalf("attempts=%d, cancelled task retried", attempts.Load())
	}
}

func TestTaskAttributionValidation(t *testing.T) {
	s := testScheduler(t, map[ResourceClass]int{ResourceMediaCPU: 1})
	tests := []Task{
		{Key: "missing-scope", Trigger: TriggerSystemEvent, Initiator: InitiatorSystem, Resource: ResourceMediaCPU, Run: func(context.Context) error { return nil }},
		{Key: "missing-trigger", Scope: ScopeSystem, Initiator: InitiatorSystem, Resource: ResourceMediaCPU, Run: func(context.Context) error { return nil }},
		{Key: "missing-initiator", Scope: ScopeSystem, Trigger: TriggerSystemEvent, Resource: ResourceMediaCPU, Run: func(context.Context) error { return nil }},
		{Key: "missing-owner", Scope: ScopeUser, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem, Resource: ResourceMediaCPU, Run: func(context.Context) error { return nil }},
		{Key: "system-owner", Scope: ScopeSystem, OwnerID: 1, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem, Resource: ResourceMediaCPU, Run: func(context.Context) error { return nil }},
		{Key: "user-initiator-without-id", Scope: ScopeUser, OwnerID: 1, Trigger: TriggerUserAction, Initiator: InitiatorUser, Resource: ResourceMediaCPU, Run: func(context.Context) error { return nil }},
	}
	for _, task := range tests {
		if _, err := s.Submit(task); !errors.Is(err, ErrInvalidTask) {
			t.Fatalf("task %q err=%v, want invalid task", task.Key, err)
		}
	}
}

func TestSchedulerBoundedQueueKeepsDedupJoinable(t *testing.T) {
	s := NewScheduler(context.Background(), Config{
		Capacity:      map[ResourceClass]int{ResourceMediaCPU: 1},
		QueueCapacity: map[ResourceClass]int{ResourceMediaCPU: 1},
	})
	t.Cleanup(s.Close)

	block := make(chan struct{})
	started := make(chan struct{})
	_, err := s.Submit(Task{
		Key: "running", Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
		Priority: PriorityP0, Resource: ResourceMediaCPU,
		Run: func(context.Context) error { close(started); <-block; return nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	<-started

	queued, err := s.Submit(Task{
		Key: "queued", Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
		Priority: PriorityP2, Resource: ResourceMediaCPU,
		Run: func(context.Context) error { return nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	joined, err := s.Submit(Task{
		Key: "queued", Scope: ScopeSystem, Trigger: TriggerUserAction, Initiator: InitiatorUser, InitiatorID: 7,
		Priority: PriorityP0, Resource: ResourceMediaCPU,
		Run: func(context.Context) error { return errors.New("must dedupe") },
	})
	if err != nil {
		t.Fatal(err)
	}
	if joined != queued {
		t.Fatal("full queue rejected duplicate join")
	}

	_, err = s.Submit(Task{
		Key: "overflow", Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
		Priority: PriorityP3, Resource: ResourceMediaCPU,
		Run: func(context.Context) error { return nil },
	})
	if !errors.Is(err, ErrQueueFull) {
		t.Fatalf("overflow err=%v, want queue full", err)
	}
	close(block)
	if err := queued.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	if snapshot := s.Snapshot(); snapshot.Backpressured != 1 {
		t.Fatalf("snapshot=%+v", snapshot)
	}
}

func TestSchedulerLeaseUnavailableDefersWithoutConsumingAttempt(t *testing.T) {
	s := NewScheduler(context.Background(), Config{
		Capacity:        map[ResourceClass]int{ResourceNetwork: 1},
		QueueCapacity:   map[ResourceClass]int{ResourceNetwork: 4},
		LeaseRetryDelay: 50 * time.Millisecond,
	})
	t.Cleanup(s.Close)

	var leaseCalls atomic.Int32
	var attempts []int
	var mu sync.Mutex
	h, err := s.Submit(Task{
		Key: "lease-defer", Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
		Priority: PriorityP2, Resource: ResourceNetwork,
		Lease: func(_ context.Context, d Descriptor) (Lease, bool, error) {
			mu.Lock()
			attempts = append(attempts, d.Attempt)
			mu.Unlock()
			if leaseCalls.Add(1) == 1 {
				return Lease{}, false, nil
			}
			return Lease{}, true, nil
		},
		Run: func(context.Context) error { return nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	var deferred RuntimeTaskSnapshot
	foundDeferred := false
	for time.Now().Before(deadline) {
		for _, snapshot := range s.TaskSnapshots(nil) {
			if snapshot.Identity.Key == "lease-defer" &&
				snapshot.LeaseDeferred {
				deferred = snapshot
				foundDeferred = true
				break
			}
		}
		if foundDeferred {
			break
		}
		time.Sleep(time.Millisecond)
	}
	if !foundDeferred ||
		deferred.State != "queued" ||
		deferred.ReadyAt == nil {
		t.Fatalf("lease-deferred snapshot=%+v", deferred)
	}
	if err := h.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(attempts) != 2 || attempts[0] != 1 || attempts[1] != 1 {
		t.Fatalf("attempts=%v, lease deferral must not consume attempt", attempts)
	}
	if snapshot := s.Snapshot(); snapshot.LeaseUnavailable != 1 {
		t.Fatalf("snapshot=%+v", snapshot)
	}
}

func TestSchedulerRunTimeout(t *testing.T) {
	s := testScheduler(t, map[ResourceClass]int{ResourceMLCPU: 1})
	h, err := s.Submit(Task{
		Key: "timeout", Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
		Priority: PriorityP2, Resource: ResourceMLCPU, RunTimeout: 5 * time.Millisecond,
		Run: func(ctx context.Context) error { <-ctx.Done(); return context.Cause(ctx) },
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := h.Wait(context.Background()); !errors.Is(err, ErrRunTimeout) {
		t.Fatalf("wait err=%v, want run timeout", err)
	}
}

func TestSchedulerRejectsExpiredTask(t *testing.T) {
	s := testScheduler(t, map[ResourceClass]int{ResourceMediaCPU: 1})
	_, err := s.Submit(Task{
		Key: "expired", Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
		Priority: PriorityP1, Resource: ResourceMediaCPU, NotAfter: time.Now().Add(-time.Second),
		Run: func(context.Context) error { return nil },
	})
	if !errors.Is(err, ErrExpired) {
		t.Fatalf("err=%v, want expired", err)
	}
}

func TestSchedulerSupersedesOlderQueuedRevision(t *testing.T) {
	s := testScheduler(t, map[ResourceClass]int{ResourceMediaCPU: 1})
	block := make(chan struct{})
	started := make(chan struct{})
	_, err := s.Submit(Task{
		Key: "block", Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
		Priority: PriorityP0, Resource: ResourceMediaCPU,
		Run: func(context.Context) error { close(started); <-block; return nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	<-started

	old, err := s.Submit(Task{
		Key: "media:node7:r4", SupersedeKey: "media:node7",
		Scope: ScopeUser, OwnerID: 42, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
		Priority: PriorityP1, Resource: ResourceMediaCPU,
		Run: func(context.Context) error { return errors.New("superseded task ran") },
	})
	if err != nil {
		t.Fatal(err)
	}
	fresh, err := s.Submit(Task{
		Key: "media:node7:r5", SupersedeKey: "media:node7",
		Scope: ScopeUser, OwnerID: 42, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
		Priority: PriorityP1, Resource: ResourceMediaCPU,
		Run: func(context.Context) error { return nil },
	})
	if err != nil {
		t.Fatal(err)
	}

	if err := old.Wait(context.Background()); !errors.Is(err, ErrSuperseded) {
		t.Fatalf("old err=%v, want superseded", err)
	}
	close(block)
	if err := fresh.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	if snapshot := s.Snapshot(); snapshot.Superseded != 1 {
		t.Fatalf("snapshot=%+v", snapshot)
	}
}

func TestRetryDelayUsesBoundedDeterministicJitter(t *testing.T) {
	p := RetryPolicy{Initial: 100 * time.Millisecond, Max: time.Second, Multiplier: 2, Jitter: .20}
	a := p.delay(2, Identity{Scope: ScopeUser, OwnerID: 1, Key: "a"})
	b := p.delay(2, Identity{Scope: ScopeUser, OwnerID: 2, Key: "a"})
	if a < 160*time.Millisecond || a > 240*time.Millisecond ||
		b < 160*time.Millisecond || b > 240*time.Millisecond {
		t.Fatalf("jitter out of bounds: a=%s b=%s", a, b)
	}
	if a == b {
		t.Fatalf("different identities received identical deterministic jitter: %s", a)
	}
}

func TestSchedulerQueueFullDoesNotSupersedeAcceptedTask(t *testing.T) {
	s := NewScheduler(context.Background(), Config{
		Capacity: map[ResourceClass]int{
			ResourceMediaCPU:      1,
			ResourceBackgroundCPU: 1,
		},
		QueueCapacity: map[ResourceClass]int{
			ResourceMediaCPU:      1,
			ResourceBackgroundCPU: 1,
		},
	})
	t.Cleanup(s.Close)

	blockMedia := make(chan struct{})
	mediaStarted := make(chan struct{})
	_, err := s.Submit(Task{
		Key: "media-running", Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
		Priority: PriorityP0, Resource: ResourceMediaCPU,
		Run: func(context.Context) error { close(mediaStarted); <-blockMedia; return nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	<-mediaStarted

	blockBackground := make(chan struct{})
	backgroundStarted := make(chan struct{})
	_, err = s.Submit(Task{
		Key: "background-running", Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
		Priority: PriorityP0, Resource: ResourceBackgroundCPU,
		Run: func(context.Context) error { close(backgroundStarted); <-blockBackground; return nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	<-backgroundStarted

	old, err := s.Submit(Task{
		Key: "old", SupersedeKey: "logical",
		Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
		Priority: PriorityP2, Resource: ResourceBackgroundCPU,
		Run: func(context.Context) error { return nil },
	})
	if err != nil {
		t.Fatal(err)
	}

	_, err = s.Submit(Task{
		Key: "media-queued", Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
		Priority: PriorityP1, Resource: ResourceMediaCPU,
		Run: func(context.Context) error { return nil },
	})
	if err != nil {
		t.Fatal(err)
	}

	_, err = s.Submit(Task{
		Key: "new", SupersedeKey: "logical",
		Scope: ScopeSystem, Trigger: TriggerSystemEvent, Initiator: InitiatorSystem,
		Priority: PriorityP1, Resource: ResourceMediaCPU,
		Run: func(context.Context) error { return nil },
	})
	if !errors.Is(err, ErrQueueFull) {
		t.Fatalf("new err=%v, want queue full", err)
	}

	close(blockBackground)
	if err := old.Wait(context.Background()); err != nil {
		t.Fatalf("old accepted task was lost after rejected superseder: %v", err)
	}
	close(blockMedia)
}

func TestSchedulerRuntimeTaskSnapshotsAndProgress(t *testing.T) {
	s := testScheduler(t, map[ResourceClass]int{ResourceMediaCPU: 2})
	release := make(chan struct{})
	started := make(chan uint64, 2)

	submit := func(ownerID uint64) *Handle {
		t.Helper()
		h, err := s.Submit(Task{
			Key:       "media-index",
			Kind:      "media.index",
			GroupKey:  "media.index",
			Scope:     ScopeUser,
			OwnerID:   ownerID,
			Trigger:   TriggerSystemEvent,
			Initiator: InitiatorSystem,
			Priority:  PriorityP1,
			Resource:  ResourceMediaCPU,
			Run: func(ctx context.Context) error {
				ReportProgress(ctx, TaskProgress{
					Phase:   "indexing",
					Current: 3,
					Total:   10,
					Unit:    "item",
					Message: "IMG_0003.JPG",
				})
				started <- ownerID
				<-release
				return nil
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		return h
	}

	a := submit(11)
	b := submit(22)
	<-started
	<-started

	ownerID := uint64(11)
	snapshots := s.TaskSnapshots(&ownerID)
	if len(snapshots) != 1 {
		t.Fatalf("owner snapshots=%d want=1: %+v", len(snapshots), snapshots)
	}
	got := snapshots[0]
	if got.Identity.OwnerID != ownerID ||
		got.Kind != "media.index" ||
		got.GroupKey != "media.index" ||
		got.State != "running" ||
		got.Progress.Phase != "indexing" ||
		got.Progress.Current != 3 ||
		got.Progress.Total != 10 ||
		got.Progress.Unit != "item" ||
		got.StartedAt == nil ||
		got.SubmittedAt.IsZero() ||
		got.UpdatedAt.IsZero() {
		t.Fatalf("snapshot=%+v", got)
	}

	all := s.TaskSnapshots(nil)
	if len(all) != 2 {
		t.Fatalf("all snapshots=%d want=2: %+v", len(all), all)
	}

	close(release)
	if err := a.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := b.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	if remaining := s.TaskSnapshots(nil); len(remaining) != 0 {
		t.Fatalf("completed tasks remained in runtime snapshot: %+v", remaining)
	}
}
