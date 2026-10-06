package api

import (
	"context"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/background"
)

func TestMediaIndexEventPromotesQueuedReconcile(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	scheduler := background.NewScheduler(
		ctx,
		background.Config{
			Capacity: map[background.ResourceClass]int{
				background.ResourceMediaCPU: 1,
			},
			QueueCapacity: map[background.ResourceClass]int{
				background.ResourceMediaCPU: 8,
			},
		},
	)
	defer scheduler.Close()

	blockerStarted := make(chan struct{})
	releaseBlocker := make(chan struct{})
	blocker, err := scheduler.Submit(background.Task{
		Key:       "test:media-index-blocker",
		Scope:     background.ScopeSystem,
		Trigger:   background.TriggerSystemEvent,
		Initiator: background.InitiatorSystem,
		Priority:  background.PriorityP0,
		Resource:  background.ResourceMediaCPU,
		Run: func(ctx context.Context) error {
			close(blockerStarted)
			select {
			case <-ctx.Done():
				return context.Cause(ctx)
			case <-releaseBlocker:
				return nil
			}
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	<-blockerStarted

	server := &Server{
		BackgroundScheduler: scheduler,
		mediaIndexOwners:    make(map[uint64]*mediaIndexOwnerState),
	}
	const ownerID = uint64(42)
	server.requestMediaIndexOwner(
		ownerID,
		background.PriorityP2,
		background.TriggerReconcile,
	)

	deadline := time.Now().Add(time.Second)
	for {
		snapshot := scheduler.Snapshot()
		if snapshot.Queued == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("reconcile task was not queued: %+v", snapshot)
		}
		time.Sleep(time.Millisecond)
	}

	server.requestMediaIndexOwner(
		ownerID,
		background.PriorityP1,
		background.TriggerSystemEvent,
	)

	snapshot := scheduler.Snapshot()
	if snapshot.Promoted != 1 || snapshot.Deduplicated != 1 {
		t.Fatalf("scheduler snapshot=%+v, want one promotion and one dedupe", snapshot)
	}

	server.mediaIndexMu.Lock()
	state := server.mediaIndexOwners[ownerID]
	if state == nil {
		server.mediaIndexMu.Unlock()
		t.Fatal("owner state disappeared")
	}
	if state.currentPriority != background.PriorityP1 ||
		state.currentTrigger != background.TriggerSystemEvent ||
		!state.pending ||
		state.nextPriority != background.PriorityP1 ||
		state.nextTrigger != background.TriggerSystemEvent {
		got := *state
		server.mediaIndexMu.Unlock()
		t.Fatalf("owner state=%+v, want promoted current and pending P1 event", got)
	}
	taskKey := state.currentKey
	server.mediaIndexMu.Unlock()

	if taskKey == "" {
		t.Fatal("owner task key is empty")
	}
	if !scheduler.Cancel(background.Identity{
		Scope:   background.ScopeUser,
		OwnerID: ownerID,
		Key:     taskKey,
	}) {
		t.Fatal("failed to cancel queued media-index task")
	}
	close(releaseBlocker)
	if err := blocker.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestMediaIndexStalledFullBatchWaitsForReconcile(t *testing.T) {
	const ownerID = uint64(7)
	server := &Server{
		mediaIndexOwners: map[uint64]*mediaIndexOwnerState{
			ownerID: {
				running:         true,
				generation:      3,
				currentKey:      "media-index:owner:7:generation:3",
				currentPriority: background.PriorityP1,
				currentTrigger:  background.TriggerSystemEvent,
			},
		},
	}

	server.finishMediaIndexOwner(
		ownerID,
		3,
		mediaIndexOwnerBatchSize,
		0,
		nil,
	)

	server.mediaIndexMu.Lock()
	_, exists := server.mediaIndexOwners[ownerID]
	server.mediaIndexMu.Unlock()
	if exists {
		t.Fatal("stalled full batch was immediately rescheduled instead of waiting for reconcile")
	}
}
