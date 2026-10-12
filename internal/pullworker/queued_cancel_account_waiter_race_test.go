package pullworker

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
)

// This is a real account-lease ordering case: a user can cancel one queued
// Source without cancelling the next Source that shares its provider account.
// A cancelled queue head must not leave the next Source permanently deferred.
type queuedAccountCancelHandler struct {
	started chan uint64
}

func (h *queuedAccountCancelHandler) PullSourceConcurrencyKey(context.Context, meta.Source) string {
	return "same-provider-account"
}

func (h *queuedAccountCancelHandler) RunPullSource(_ context.Context, source meta.Source) (client.SyncRun, error) {
	h.started <- source.ID
	return client.SyncRun{
		ID: fmt.Sprintf("run-%d", source.ID), SourceID: source.ID,
		Status: meta.SyncRunStatusCompleted,
	}, nil
}

func TestCancelledQueuedSourceDoesNotStarveNextSharedAccountSource(t *testing.T) {
	parent, cancelParent := context.WithCancel(context.Background())
	scheduler := background.NewScheduler(parent, background.Config{
		Capacity:        map[background.ResourceClass]int{background.ResourceNetwork: 1},
		QueueCapacity:   map[background.ResourceClass]int{background.ResourceNetwork: 8},
		LeaseRetryDelay: 20 * time.Millisecond,
	})
	blockerStarted := make(chan struct{})
	blockerRelease := make(chan struct{})
	var releaseOnce sync.Once
	releaseBlocker := func() { releaseOnce.Do(func() { close(blockerRelease) }) }
	runnerCtx, cancelRunner := context.WithCancel(context.Background())
	runnerExited := make(chan struct{})
	runnerLaunched := false
	t.Cleanup(func() {
		cancelRunner()
		// Cancel all Source tasks before shutting down the shared Scheduler.
		// A failed assertion must not turn this fixture into a nil-DB
		// preflight-recording panic that conceals the actual failure.
		for _, task := range scheduler.TaskSnapshots(nil) {
			if task.Kind == "source.sync" {
				scheduler.Cancel(task.Identity)
			}
		}
		releaseBlocker()
		if runnerLaunched {
			select {
			case <-runnerExited:
			case <-time.After(5 * time.Second):
				t.Error("runSources did not exit during cleanup")
			}
		}
		cancelParent()
		scheduler.Close()
	})

	_, err := scheduler.Submit(background.Task{
		Scope: background.ScopeSystem, Key: "hold-network-worker-for-queued-cancel",
		Trigger: background.TriggerSystemEvent, Initiator: background.InitiatorSystem,
		Priority: background.PriorityP0, Resource: background.ResourceNetwork,
		Run: func(ctx context.Context) error {
			close(blockerStarted)
			select {
			case <-blockerRelease:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-blockerStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("network worker did not start blocker")
	}

	handler := &queuedAccountCancelHandler{started: make(chan uint64, 2)}
	runner := &Runner{
		Scheduler:      scheduler,
		Handlers:       map[string]SourceHandler{"yike_photos": handler},
		MaxConcurrency: 1,
	}
	type outcome struct {
		report RunAllReport
		err    error
	}
	runDone := make(chan outcome, 1)
	runnerLaunched = true
	go func() {
		defer close(runnerExited)
		report, err := runner.runSources(runnerCtx, []meta.Source{
			{ID: 1, OwnerID: 7, Kind: "yike_photos"},
			{ID: 2, OwnerID: 7, Kind: "yike_photos"},
		}, time.Now().UTC())
		runDone <- outcome{report: report, err: err}
	}()

	// Ensure both Source tasks were queued behind an occupied network slot.
	var cancelledIdentity background.Identity
	queued := time.NewTicker(5 * time.Millisecond)
	defer queued.Stop()
	queueDeadline := time.NewTimer(5 * time.Second)
	defer queueDeadline.Stop()
waitQueued:
	for {
		var first, second bool
		for _, item := range scheduler.TaskSnapshots(nil) {
			if item.State != "queued" || item.Kind != "source.sync" {
				continue
			}
			if strings.HasPrefix(item.Identity.Key, "source.sync:1:") {
				first = true
				cancelledIdentity = item.Identity
			}
			if strings.HasPrefix(item.Identity.Key, "source.sync:2:") {
				second = true
			}
		}
		if first && second {
			break waitQueued
		}
		select {
		case <-queued.C:
		case <-queueDeadline.C:
			t.Fatal("both Source tasks did not queue behind the occupied network worker")
		}
	}
	if !scheduler.Cancel(cancelledIdentity) {
		t.Fatal("could not cancel the first, still-queued Source task")
	}
	releaseBlocker()

	// With no active same-account Source and no database lease, deferred
	// acquisition for Source 2 proves a stale cancelled account queue head.
	observed := time.NewTicker(5 * time.Millisecond)
	defer observed.Stop()
	startedDeadline := time.NewTimer(5 * time.Second)
	defer startedDeadline.Stop()
waitSecond:
	for {
		select {
		case id := <-handler.started:
			if id != 2 {
				t.Fatalf("cancelled Source %d executed instead of Source 2", id)
			}
			break waitSecond
		default:
		}
		for _, item := range scheduler.TaskSnapshots(nil) {
			if strings.HasPrefix(item.Identity.Key, "source.sync:2:") && item.LeaseDeferred {
				t.Fatalf("Source 2 was deferred by stale account waiter after queued Source 1 was cancelled: %+v", item)
			}
		}
		select {
		case <-observed.C:
		case <-startedDeadline.C:
			t.Fatal("Source 2 remained blocked after its cancelled predecessor left the scheduler queue")
		}
	}
	select {
	case result := <-runDone:
		if result.report.Eligible != 2 || result.report.Completed != 1 || result.report.Failed != 1 ||
			!errors.Is(result.err, context.Canceled) {
			t.Fatalf("unexpected per-Source cancellation result: report=%+v err=%v", result.report, result.err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("runSources never completed after the cancelled queue head was removed")
	}
}
