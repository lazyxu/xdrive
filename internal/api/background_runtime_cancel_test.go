package api

import (
	"context"
	"testing"

	"github.com/lazyxu/xdrive/internal/background"
)

func newRuntimeCancelTestScheduler(
	t *testing.T,
	resource background.ResourceClass,
) (*background.Scheduler, chan struct{}, *background.Handle) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	scheduler := background.NewScheduler(
		ctx,
		background.Config{
			Capacity: map[background.ResourceClass]int{
				resource: 1,
			},
			QueueCapacity: map[background.ResourceClass]int{
				resource: 8,
			},
		},
	)
	t.Cleanup(scheduler.Close)

	started := make(chan struct{})
	release := make(chan struct{})
	blocker, err := scheduler.Submit(background.Task{
		Key:       "test:runtime-cancel-blocker",
		Scope:     background.ScopeSystem,
		Trigger:   background.TriggerSystemEvent,
		Initiator: background.InitiatorSystem,
		Priority:  background.PriorityP0,
		Resource:  resource,
		Run: func(ctx context.Context) error {
			close(started)
			select {
			case <-ctx.Done():
				return context.Cause(ctx)
			case <-release:
				return nil
			}
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	<-started
	return scheduler, release, blocker
}

func TestCancelBackgroundRuntimeMediaIndexInvalidatesOwnerGeneration(t *testing.T) {
	scheduler, release, blocker := newRuntimeCancelTestScheduler(
		t,
		background.ResourceMediaCPU,
	)

	ownerID := uint64(42)
	server := &Server{
		BackgroundScheduler: scheduler,
		mediaIndexOwners:    make(map[uint64]*mediaIndexOwnerState),
	}
	server.requestMediaIndexOwner(
		ownerID,
		background.PriorityP2,
		background.TriggerReconcile,
	)

	server.mediaIndexMu.Lock()
	state := server.mediaIndexOwners[ownerID]
	if state == nil || state.currentKey == "" {
		server.mediaIndexMu.Unlock()
		t.Fatalf("media-index owner state=%+v", state)
	}
	oldKey := state.currentKey
	oldGeneration := state.generation
	server.mediaIndexMu.Unlock()

	cancelled, err := server.cancelBackgroundRuntimeTaskGroup(
		context.Background(),
		backgroundTaskRef{
			domain:  "scheduler",
			scope:   background.ScopeUser,
			ownerID: ownerID,
			kind:    "media.index",
		},
		background.InitiatorUser,
		ownerID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !cancelled {
		t.Fatal("failed to cancel media-index runtime group")
	}

	server.mediaIndexMu.Lock()
	state = server.mediaIndexOwners[ownerID]
	if state == nil ||
		state.running ||
		state.pending ||
		state.currentKey != "" ||
		state.generation != oldGeneration+1 {
		got := mediaIndexOwnerState{}
		if state != nil {
			got = *state
		}
		server.mediaIndexMu.Unlock()
		t.Fatalf("cancelled media-index owner state=%+v", got)
	}
	server.mediaIndexMu.Unlock()
	if snapshots := scheduler.TaskSnapshots(&ownerID); len(snapshots) != 0 {
		t.Fatalf("cancelled media-index tasks still queued: %+v", snapshots)
	}

	server.requestMediaIndexOwner(
		ownerID,
		background.PriorityP1,
		background.TriggerSystemEvent,
	)
	server.mediaIndexMu.Lock()
	state = server.mediaIndexOwners[ownerID]
	if state == nil || !state.running || state.currentKey == "" || state.currentKey == oldKey {
		got := mediaIndexOwnerState{}
		if state != nil {
			got = *state
		}
		server.mediaIndexMu.Unlock()
		t.Fatalf("new media-index generation did not recover after cancel: %+v", got)
	}
	server.mediaIndexMu.Unlock()

	cancelled, err = server.cancelBackgroundRuntimeTaskGroup(
		context.Background(),
		backgroundTaskRef{
			domain:  "scheduler",
			scope:   background.ScopeUser,
			ownerID: ownerID,
			kind:    "media.index",
		},
		background.InitiatorUser,
		ownerID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !cancelled {
		t.Fatal("failed to cancel replacement media-index generation")
	}
	close(release)
	if err := blocker.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestCancelBackgroundRuntimePhotoIntelligenceClearsPendingGeneration(t *testing.T) {
	scheduler, release, blocker := newRuntimeCancelTestScheduler(
		t,
		background.ResourceMLCPU,
	)

	ownerID := uint64(77)
	key := photoIntelligenceOwnerKey{
		OwnerID: ownerID,
		Kind:    photoIntelligenceFace,
	}
	server := &Server{
		BackgroundScheduler:     scheduler,
		photoFaceRunner:         &fakePhotoFaceOwnerRunner{},
		photoIntelligenceOwners: make(map[photoIntelligenceOwnerKey]*photoIntelligenceOwnerState),
	}
	if err := server.requestPhotoIntelligenceOwner(
		photoIntelligenceFace,
		ownerID,
		background.PriorityP2,
		background.TriggerSystemEvent,
		background.InitiatorSystem,
		0,
	); err != nil {
		t.Fatal(err)
	}
	if err := server.requestPhotoIntelligenceOwner(
		photoIntelligenceFace,
		ownerID,
		background.PriorityP1,
		background.TriggerUserAction,
		background.InitiatorUser,
		ownerID,
	); err != nil {
		t.Fatal(err)
	}

	server.photoIntelligenceMu.Lock()
	state := server.photoIntelligenceOwners[key]
	if state == nil || state.currentKey == "" || !state.pending {
		server.photoIntelligenceMu.Unlock()
		t.Fatalf("photo-intelligence owner state=%+v", state)
	}
	oldKey := state.currentKey
	oldGeneration := state.generation
	server.photoIntelligenceMu.Unlock()

	cancelled, err := server.cancelBackgroundRuntimeTaskGroup(
		context.Background(),
		backgroundTaskRef{
			domain:  "scheduler",
			scope:   background.ScopeUser,
			ownerID: ownerID,
			kind:    "photo.face",
		},
		background.InitiatorUser,
		ownerID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !cancelled {
		t.Fatal("failed to cancel photo-intelligence runtime group")
	}

	server.photoIntelligenceMu.Lock()
	state = server.photoIntelligenceOwners[key]
	if state == nil ||
		state.running ||
		state.pending ||
		state.currentKey != "" ||
		state.generation != oldGeneration+1 {
		got := photoIntelligenceOwnerState{}
		if state != nil {
			got = *state
		}
		server.photoIntelligenceMu.Unlock()
		t.Fatalf("cancelled photo-intelligence owner state=%+v", got)
	}
	server.photoIntelligenceMu.Unlock()
	if snapshots := scheduler.TaskSnapshots(&ownerID); len(snapshots) != 0 {
		t.Fatalf("cancelled photo-intelligence tasks still queued: %+v", snapshots)
	}

	if err := server.requestPhotoIntelligenceOwner(
		photoIntelligenceFace,
		ownerID,
		background.PriorityP2,
		background.TriggerUserAction,
		background.InitiatorUser,
		ownerID,
	); err != nil {
		t.Fatal(err)
	}
	server.photoIntelligenceMu.Lock()
	state = server.photoIntelligenceOwners[key]
	if state == nil || !state.running || state.currentKey == "" || state.currentKey == oldKey {
		got := photoIntelligenceOwnerState{}
		if state != nil {
			got = *state
		}
		server.photoIntelligenceMu.Unlock()
		t.Fatalf("new photo-intelligence generation did not recover after cancel: %+v", got)
	}
	server.photoIntelligenceMu.Unlock()

	cancelled, err = server.cancelBackgroundRuntimeTaskGroup(
		context.Background(),
		backgroundTaskRef{
			domain:  "scheduler",
			scope:   background.ScopeUser,
			ownerID: ownerID,
			kind:    "photo.face",
		},
		background.InitiatorUser,
		ownerID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !cancelled {
		t.Fatal("failed to cancel replacement photo-intelligence generation")
	}
	close(release)
	if err := blocker.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestBackgroundRuntimeControlActionsExposeOwnerCancellation(t *testing.T) {
	const ownerID = uint64(42)
	for _, kind := range []string{
		"media.index",
		"photo.face",
		"photo.place",
		"photo.person_cluster",
	} {
		actions := backgroundRuntimeControlActions(
			kind,
			background.ScopeUser,
			ownerID,
			ownerID,
			false,
		)
		if !backgroundTaskActionAllowed(actions, backgroundTaskActionCancel) {
			t.Fatalf("owner actions for %s=%v missing cancel", kind, actions)
		}
	}
	photoActions := backgroundRuntimeControlActions(
		"photo.face",
		background.ScopeUser,
		ownerID,
		ownerID,
		false,
	)
	if !backgroundTaskActionAllowed(photoActions, backgroundTaskActionReanalyze) {
		t.Fatalf("photo actions=%v missing reanalyze", photoActions)
	}
	for _, kind := range []string{"media.thumbnail", "media.analysis_preview"} {
		actions := backgroundRuntimeControlActions(
			kind,
			background.ScopeUser,
			ownerID,
			ownerID,
			false,
		)
		if backgroundTaskActionAllowed(actions, backgroundTaskActionCancel) {
			t.Fatalf("shared derivative %s unexpectedly exposed coarse cancel: %v", kind, actions)
		}
	}
	adminActions := backgroundRuntimeControlActions(
		"media.index",
		background.ScopeUser,
		ownerID,
		999,
		true,
	)
	if !backgroundTaskActionAllowed(adminActions, backgroundTaskActionCancel) {
		t.Fatalf("admin actions=%v missing cross-user runtime cancel", adminActions)
	}
	adminPhotoActions := backgroundRuntimeControlActions(
		"photo.face",
		background.ScopeUser,
		ownerID,
		999,
		true,
	)
	if !backgroundTaskActionAllowed(adminPhotoActions, backgroundTaskActionReanalyze) ||
		!backgroundTaskActionAllowed(adminPhotoActions, backgroundTaskActionCancel) {
		t.Fatalf("admin photo actions=%v want reanalyze and cancel", adminPhotoActions)
	}
}
