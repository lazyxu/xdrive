package api

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestRuntimeCancellationIsDurableAndFencesOldGeneration(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	db := openPhotoIntelligenceAPITestDB(t, dsn)
	user := meta.User{
		Username:       "runtime-cancel-owner",
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	state := meta.PhotoPersonClusterState{
		OwnerID:          user.ID,
		AnalyzerVersion:  "cluster-v1",
		InputFingerprint: "input-v1",
		State:            meta.PhotoAnalysisStateRunning,
		Attempt:          1,
	}
	if err := db.Create(&state).Error; err != nil {
		t.Fatal(err)
	}
	reanalyze := meta.PhotoIntelligenceReanalyzeIntent{
		OwnerID:        user.ID,
		Kind:           string(photoIntelligencePersonCluster),
		RequestedEpoch: 2,
		AppliedEpoch:   1,
		Trigger:        string(background.TriggerUserAction),
		Initiator:      string(background.InitiatorUser),
		InitiatorID:    user.ID,
		RequestedAt:    time.Now().UTC(),
	}
	if err := db.Create(&reanalyze).Error; err != nil {
		t.Fatal(err)
	}

	holder := &Server{DB: db}
	requester := &Server{DB: db}
	provider := holder.backgroundOwnerLeaseProvider(
		"photo.person_cluster",
		0,
	)
	lease, acquired, err := provider(
		context.Background(),
		background.Descriptor{
			Scope:   background.ScopeUser,
			OwnerID: user.ID,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if !acquired {
		t.Fatal("failed to acquire simulated running owner lease")
	}
	defer func() {
		if lease.Release != nil {
			_ = lease.Release(context.Background(), nil)
		}
	}()

	ref := backgroundTaskRef{
		domain:  "scheduler",
		scope:   background.ScopeUser,
		ownerID: user.ID,
		kind:    "photo.person_cluster",
	}
	epoch, err := requester.requestBackgroundRuntimeCancellation(
		context.Background(),
		ref,
		background.InitiatorUser,
		user.ID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if epoch != 1 {
		t.Fatalf("cancel epoch=%d want=1", epoch)
	}
	repeated, err := requester.requestBackgroundRuntimeCancellation(
		context.Background(),
		ref,
		background.InitiatorUser,
		user.ID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if repeated != epoch {
		t.Fatalf("repeated pending cancel epoch=%d want=%d", repeated, epoch)
	}

	var pending meta.BackgroundRuntimeCancelIntent
	if err := db.First(
		&pending,
		"owner_id = ? AND kind = ?",
		user.ID,
		ref.kind,
	).Error; err != nil {
		t.Fatal(err)
	}
	if pending.RequestedEpoch != 1 ||
		pending.AppliedEpoch != 0 ||
		pending.PhotoReanalyzeEpoch != 2 {
		t.Fatalf("pending cancel intent=%+v", pending)
	}
	if lease.Heartbeat == nil {
		t.Fatal("simulated owner lease has no heartbeat")
	}
	if err := lease.Heartbeat(context.Background()); !errors.Is(
		err,
		background.ErrCancelRequested,
	) {
		t.Fatalf("lease heartbeat error=%v want cancel requested", err)
	}

	if err := lease.Release(context.Background(), background.ErrCancelRequested); err != nil {
		t.Fatal(err)
	}
	lease.Release = nil
	if err := requester.tryFinalizeIdleBackgroundRuntimeCancellation(
		context.Background(),
		user.ID,
		ref.kind,
	); err != nil {
		t.Fatal(err)
	}

	var applied meta.BackgroundRuntimeCancelIntent
	if err := db.First(
		&applied,
		"owner_id = ? AND kind = ?",
		user.ID,
		ref.kind,
	).Error; err != nil {
		t.Fatal(err)
	}
	if applied.AppliedEpoch != applied.RequestedEpoch ||
		applied.AppliedAt == nil {
		t.Fatalf("applied cancel intent=%+v", applied)
	}
	var recovered meta.PhotoPersonClusterState
	if err := db.First(&recovered, "owner_id = ?", user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if recovered.State != meta.PhotoAnalysisStateStale {
		t.Fatalf("cancelled cluster state=%q want stale", recovered.State)
	}
	var reanalyzeAfter meta.PhotoIntelligenceReanalyzeIntent
	if err := db.First(
		&reanalyzeAfter,
		"owner_id = ? AND kind = ?",
		user.ID,
		string(photoIntelligencePersonCluster),
	).Error; err != nil {
		t.Fatal(err)
	}
	if reanalyzeAfter.AppliedEpoch != 2 {
		t.Fatalf("cancel did not acknowledge captured reanalyze epoch: %+v", reanalyzeAfter)
	}

	if err := requester.prepareBackgroundRuntimeGeneration(
		context.Background(),
		user.ID,
		ref.kind,
		0,
	); !errors.Is(err, background.ErrCancelRequested) {
		t.Fatalf("old generation fence error=%v", err)
	}
	if err := requester.prepareBackgroundRuntimeGeneration(
		context.Background(),
		user.ID,
		ref.kind,
		1,
	); err != nil {
		t.Fatalf("new generation was incorrectly fenced: %v", err)
	}
}
