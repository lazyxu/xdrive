package api

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestBackgroundOwnerCancellationFencesOtherServerGeneration(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(4)
	sqlDB.SetMaxIdleConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(
		&meta.User{},
		&meta.BackgroundOwnerCancellation{},
	); err != nil {
		t.Fatal(err)
	}
	user := meta.User{
		Username:       "cancel-fence-owner-" + time.Now().UTC().Format("150405.000000000"),
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = db.Where("owner_id = ?", user.ID).
			Delete(&meta.BackgroundOwnerCancellation{}).Error
		_ = db.Delete(&user).Error
	})

	serverA := &Server{DB: db}
	serverB := &Server{DB: db}
	baseline, err := serverA.captureBackgroundOwnerCancelEpoch(
		"media.index",
		user.ID,
	)
	if err != nil {
		t.Fatal(err)
	}
	descriptor := background.Descriptor{
		Scope:   background.ScopeUser,
		OwnerID: user.ID,
	}
	lease, acquired, err := serverA.backgroundOwnerLeaseProvider(
		"media.index",
		baseline,
	)(context.Background(), descriptor)
	if err != nil {
		t.Fatal(err)
	}
	if !acquired || lease.Heartbeat == nil || lease.Release == nil {
		t.Fatalf("distributed lease=%+v acquired=%v", lease, acquired)
	}
	remoteRef := backgroundTaskRef{
		domain:  "scheduler",
		scope:   background.ScopeUser,
		ownerID: user.ID,
		kind:    "media.index",
	}
	available, err := serverB.backgroundRuntimeTaskCancellableNow(
		context.Background(),
		remoteRef,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !available {
		t.Fatal("remote running owner lease was not cancellable")
	}

	epoch, err := serverB.requestBackgroundOwnerCancellation(
		context.Background(),
		"media.index",
		user.ID,
		background.InitiatorUser,
		user.ID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if epoch <= baseline {
		t.Fatalf("cancel epoch=%d baseline=%d", epoch, baseline)
	}
	var pending meta.BackgroundOwnerCancellation
	if err := db.First(
		&pending,
		"owner_id = ? AND kind = ?",
		user.ID,
		"media.index",
	).Error; err != nil {
		t.Fatal(err)
	}
	if pending.RequestedEpoch != epoch ||
		pending.AppliedEpoch >= pending.RequestedEpoch {
		t.Fatalf("unexpected pending cancellation row: %+v", pending)
	}
	pendingTasks, err := serverB.backgroundOwnerCancellationTasks(
		context.Background(),
		&user.ID,
		10,
	)
	if err != nil {
		t.Fatal(err)
	}
	pendingTask := backgroundTaskByID(
		pendingTasks,
		fmt.Sprintf("runtime:user:%d:media.index", user.ID),
	)
	if pendingTask == nil || pendingTask.State != "cancel_requested" {
		t.Fatalf("pending cancellation task=%+v", pendingTask)
	}
	if err := lease.Heartbeat(context.Background()); !errors.Is(err, context.Canceled) {
		t.Fatalf("old generation heartbeat error=%v want cancellation", err)
	}
	if err := lease.Release(context.Background(), context.Canceled); err != nil {
		t.Fatal(err)
	}
	serverB.reconcileBackgroundOwnerCancellations(
		context.Background(),
		[]string{"media.index"},
	)
	var applied meta.BackgroundOwnerCancellation
	if err := db.First(
		&applied,
		"owner_id = ? AND kind = ?",
		user.ID,
		"media.index",
	).Error; err != nil {
		t.Fatal(err)
	}
	if applied.AppliedEpoch != applied.RequestedEpoch ||
		applied.AppliedAt == nil {
		t.Fatalf("cancellation did not finalize after lease release: %+v", applied)
	}
	cancelledTasks, err := serverB.backgroundOwnerCancellationTasks(
		context.Background(),
		&user.ID,
		10,
	)
	if err != nil {
		t.Fatal(err)
	}
	cancelledTask := backgroundTaskByID(
		cancelledTasks,
		fmt.Sprintf("runtime:user:%d:media.index", user.ID),
	)
	if cancelledTask == nil || cancelledTask.State != "cancelled" {
		t.Fatalf("cancelled durable task=%+v", cancelledTask)
	}
	available, err = serverB.backgroundRuntimeTaskCancellableNow(
		context.Background(),
		remoteRef,
	)
	if err != nil {
		t.Fatal(err)
	}
	if available {
		t.Fatal("terminal idle cancellation remained cancellable")
	}

	if _, acquired, err := serverA.backgroundOwnerLeaseProvider(
		"media.index",
		baseline,
	)(context.Background(), descriptor); !errors.Is(err, context.Canceled) || acquired {
		t.Fatalf("old queued generation acquired=%v err=%v want durable cancel", acquired, err)
	}

	newBaseline, err := serverA.captureBackgroundOwnerCancelEpoch(
		"media.index",
		user.ID,
	)
	if err != nil {
		t.Fatal(err)
	}
	newLease, acquired, err := serverA.backgroundOwnerLeaseProvider(
		"media.index",
		newBaseline,
	)(context.Background(), descriptor)
	if err != nil {
		t.Fatal(err)
	}
	if !acquired {
		t.Fatal("new generation could not run after cancellation fence")
	}
	if newLease.Release != nil {
		_ = newLease.Release(context.Background(), nil)
	}
}

func TestRollbackPhotoIntelligenceRunningStateAfterCancel(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	db := openPhotoIntelligenceAPITestDB(t, dsn)

	user := meta.User{
		Username:       "cancel-rollback-owner",
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	asset := meta.PhotoAsset{
		OwnerID:       user.ID,
		PrimaryNodeID: root.ID,
		Kind:          meta.PhotoAssetKindImage,
		EvidenceKey:   "cancel-rollback",
	}
	if err := db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{
		meta.PhotoAnalysisKindFaceDetection,
		meta.PhotoAnalysisKindFaceEmbedding,
		meta.PhotoAnalysisKindVisualLabel,
		meta.PhotoAnalysisKindOCRText,
		meta.PhotoAnalysisKindPlaceLabel,
	} {
		if err := db.Create(&meta.PhotoAnalysisState{
			AssetID:          asset.ID,
			Kind:             kind,
			AnalyzerVersion:  "cancel-test",
			InputFingerprint: "cancel-test",
			State:            meta.PhotoAnalysisStateRunning,
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Create(&meta.PhotoPersonClusterState{
		OwnerID:          user.ID,
		AnalyzerVersion:  "cancel-test",
		InputFingerprint: "cancel-test",
		State:            meta.PhotoAnalysisStateRunning,
	}).Error; err != nil {
		t.Fatal(err)
	}

	server := &Server{DB: db}
	for _, kind := range []photoIntelligenceTaskKind{
		photoIntelligenceFace,
		photoIntelligenceSmartSearch,
		photoIntelligencePlace,
		photoIntelligencePersonCluster,
	} {
		if err := server.rollbackPhotoIntelligenceOwnerAfterCancel(kind, user.ID); err != nil {
			t.Fatalf("rollback %s: %v", kind, err)
		}
	}
	var states []meta.PhotoAnalysisState
	if err := db.Where("asset_id = ?", asset.ID).Find(&states).Error; err != nil {
		t.Fatal(err)
	}
	for _, state := range states {
		if state.State != meta.PhotoAnalysisStateStale {
			t.Fatalf("analysis state after cancel=%+v", state)
		}
	}
	var cluster meta.PhotoPersonClusterState
	if err := db.First(&cluster, "owner_id = ?", user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if cluster.State != meta.PhotoAnalysisStateStale {
		t.Fatalf("cluster state after cancel=%+v", cluster)
	}
}
