package api

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/background"
)

type fakePhotoFaceOwnerRunner struct {
	owners    []uint64
	started   chan uint64
	release   chan struct{}
	processed int
}

func (r *fakePhotoFaceOwnerRunner) CandidateOwnerIDs(
	context.Context,
	int,
) ([]uint64, error) {
	return append([]uint64(nil), r.owners...), nil
}

func (r *fakePhotoFaceOwnerRunner) RunOwnerBatch(
	ctx context.Context,
	ownerID uint64,
	_ int,
) (int, error) {
	if r.started != nil {
		r.started <- ownerID
	}
	if r.release != nil {
		select {
		case <-ctx.Done():
			return 0, context.Cause(ctx)
		case <-r.release:
		}
	}
	return r.processed, nil
}

type fakePhotoPlaceOwnerRunner struct {
	owners    []uint64
	started   chan uint64
	release   chan struct{}
	processed int
}

func (r *fakePhotoPlaceOwnerRunner) CandidateOwnerIDs(
	context.Context,
	int,
) ([]uint64, error) {
	return append([]uint64(nil), r.owners...), nil
}

func (r *fakePhotoPlaceOwnerRunner) RunOwnerBatch(
	ctx context.Context,
	ownerID uint64,
	_ int,
) (int, error) {
	if r.started != nil {
		r.started <- ownerID
	}
	if r.release != nil {
		select {
		case <-ctx.Done():
			return 0, context.Cause(ctx)
		case <-r.release:
		}
	}
	return r.processed, nil
}

type fakePhotoPersonOwnerRunner struct {
	owners  []uint64
	started chan uint64
	release chan struct{}
}

func (r *fakePhotoPersonOwnerRunner) CandidateOwnerIDs(
	context.Context,
	int,
) ([]uint64, error) {
	return append([]uint64(nil), r.owners...), nil
}

func (r *fakePhotoPersonOwnerRunner) RunOwner(
	ctx context.Context,
	ownerID uint64,
) error {
	if r.started != nil {
		r.started <- ownerID
	}
	if r.release != nil {
		select {
		case <-ctx.Done():
			return context.Cause(ctx)
		case <-r.release:
		}
	}
	return nil
}

func TestPhotoIntelligenceMediaEventSchedulesFaceSmartSemanticPlaceAndCluster(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	scheduler := background.NewScheduler(
		ctx,
		background.Config{
			Capacity: map[background.ResourceClass]int{
				background.ResourceMLCPU:         1,
				background.ResourceBackgroundCPU: 2,
			},
			QueueCapacity: map[background.ResourceClass]int{
				background.ResourceMLCPU:         8,
				background.ResourceBackgroundCPU: 8,
			},
		},
	)
	defer scheduler.Close()

	faceRelease := make(chan struct{})
	smartRelease := make(chan struct{})
	semanticRelease := make(chan struct{})
	placeRelease := make(chan struct{})
	personRelease := make(chan struct{})
	face := &fakePhotoFaceOwnerRunner{
		started:   make(chan uint64, 1),
		release:   faceRelease,
		processed: 1,
	}
	smart := &fakePhotoFaceOwnerRunner{
		started:   make(chan uint64, 1),
		release:   smartRelease,
		processed: 1,
	}
	semantic := &fakePhotoFaceOwnerRunner{
		started:   make(chan uint64, 1),
		release:   semanticRelease,
		processed: 1,
	}
	place := &fakePhotoPlaceOwnerRunner{
		started:   make(chan uint64, 1),
		release:   placeRelease,
		processed: 1,
	}
	person := &fakePhotoPersonOwnerRunner{
		started: make(chan uint64, 1),
		release: personRelease,
	}
	server := &Server{
		BackgroundScheduler:     scheduler,
		photoFaceRunner:         face,
		photoSmartRunner:        smart,
		photoSemanticRunner:     semantic,
		photoPlaceRunner:        place,
		photoPersonRunner:       person,
		photoIntelligenceOwners: make(map[photoIntelligenceOwnerKey]*photoIntelligenceOwnerState),
	}

	const ownerID = uint64(42)
	server.requestPhotoIntelligenceForMedia(ownerID)

	select {
	case got := <-face.started:
		if got != ownerID {
			t.Fatalf("face owner=%d want=%d", got, ownerID)
		}
	case <-time.After(time.Second):
		t.Fatal("face task did not start")
	}
	select {
	case got := <-place.started:
		if got != ownerID {
			t.Fatalf("place owner=%d want=%d", got, ownerID)
		}
	case <-time.After(time.Second):
		t.Fatal("place task did not start")
	}

	owner := ownerID
	snapshots := scheduler.TaskSnapshots(&owner)
	kinds := make(map[string]bool)
	for _, snapshot := range snapshots {
		kinds[snapshot.Kind] = true
		if snapshot.Identity.OwnerID != ownerID {
			t.Fatalf("foreign owner snapshot: %+v", snapshot)
		}
	}
	if !kinds["photo.face"] ||
		!kinds["photo.smart_search"] ||
		!kinds["photo.semantic_search"] ||
		!kinds["photo.place"] {
		t.Fatalf("runtime kinds=%v want face+smart_search+semantic_search+place", kinds)
	}

	close(faceRelease)
	select {
	case got := <-smart.started:
		if got != ownerID {
			t.Fatalf("smart owner=%d want=%d", got, ownerID)
		}
	case <-time.After(time.Second):
		t.Fatal("smart-search task did not start after face released ML CPU")
	}
	close(smartRelease)
	select {
	case got := <-semantic.started:
		if got != ownerID {
			t.Fatalf("semantic owner=%d want=%d", got, ownerID)
		}
	case <-time.After(time.Second):
		t.Fatal("semantic-search task did not start after lexical smart search released ML CPU")
	}
	select {
	case got := <-person.started:
		if got != ownerID {
			t.Fatalf("person owner=%d want=%d", got, ownerID)
		}
	case <-time.After(time.Second):
		t.Fatal("person-cluster task was not triggered by face completion")
	}
	close(semanticRelease)
	close(placeRelease)
	close(personRelease)

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if len(scheduler.TaskSnapshots(&owner)) == 0 {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("photo intelligence tasks did not drain: %+v", scheduler.TaskSnapshots(&owner))
}

func TestPhotoIntelligencePendingRequestPreservesUserAttribution(t *testing.T) {
	state := &photoIntelligenceOwnerState{
		running:          true,
		currentPriority:  background.PriorityP3,
		currentTrigger:   background.TriggerReconcile,
		currentInitiator: background.InitiatorSystem,
	}
	server := &Server{}
	server.mergePendingPhotoIntelligenceRequest(
		state,
		background.PriorityP2,
		background.TriggerUserAction,
		background.InitiatorUser,
		9,
	)
	if !state.pending ||
		state.nextPriority != background.PriorityP2 ||
		state.nextTrigger != background.TriggerUserAction ||
		state.nextInitiator != background.InitiatorUser ||
		state.nextInitiatorID != 9 {
		t.Fatalf("pending state=%+v", state)
	}
}

func TestPhotoIntelligenceFailurePreservesPendingUserRequest(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	scheduler := background.NewScheduler(
		ctx,
		background.Config{
			Capacity: map[background.ResourceClass]int{
				background.ResourceMLCPU: 1,
			},
			QueueCapacity: map[background.ResourceClass]int{
				background.ResourceMLCPU: 8,
			},
		},
	)
	defer scheduler.Close()

	blockerStarted := make(chan struct{})
	releaseBlocker := make(chan struct{})
	blocker, err := scheduler.Submit(background.Task{
		Key:       "test:photo-blocker",
		Scope:     background.ScopeSystem,
		Trigger:   background.TriggerSystemEvent,
		Initiator: background.InitiatorSystem,
		Priority:  background.PriorityP0,
		Resource:  background.ResourceMLCPU,
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

	ownerID := uint64(77)
	key := photoIntelligenceOwnerKey{
		OwnerID: ownerID,
		Kind:    photoIntelligenceFace,
	}
	server := &Server{
		BackgroundScheduler: scheduler,
		photoFaceRunner:     &fakePhotoFaceOwnerRunner{},
		photoIntelligenceOwners: map[photoIntelligenceOwnerKey]*photoIntelligenceOwnerState{
			key: {
				running:         true,
				pending:         true,
				generation:      1,
				currentKey:      "photo-intelligence:face:owner:77:generation:1",
				currentPriority: background.PriorityP2,
				currentTrigger:  background.TriggerSystemEvent,
				nextPriority:    background.PriorityP2,
				nextTrigger:     background.TriggerUserAction,
				nextInitiator:   background.InitiatorUser,
				nextInitiatorID: 77,
			},
		},
	}

	server.finishPhotoIntelligenceOwner(
		key,
		1,
		0,
		errors.New("old generation failed"),
	)

	server.photoIntelligenceMu.Lock()
	state := server.photoIntelligenceOwners[key]
	if state == nil {
		server.photoIntelligenceMu.Unlock()
		t.Fatal("pending user request was discarded")
	}
	got := *state
	server.photoIntelligenceMu.Unlock()
	if !got.running ||
		got.generation != 2 ||
		got.currentTrigger != background.TriggerUserAction ||
		got.currentInitiator != background.InitiatorUser ||
		got.currentInitiatorID != ownerID {
		t.Fatalf("next generation state=%+v", got)
	}

	snapshots := scheduler.TaskSnapshots(&ownerID)
	if len(snapshots) != 1 ||
		snapshots[0].Trigger != background.TriggerUserAction ||
		snapshots[0].Initiator != background.InitiatorUser ||
		snapshots[0].InitiatorID != ownerID {
		t.Fatalf("queued manual generation=%+v", snapshots)
	}

	if !scheduler.Cancel(snapshots[0].Identity) {
		t.Fatal("failed to cancel queued manual generation")
	}
	close(releaseBlocker)
	if err := blocker.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
}
