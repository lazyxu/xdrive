package api

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestPhotoIntelligenceDurableReanalyzeIntentRecoversAfterRestart(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	db := openPhotoIntelligenceAPITestDB(t, dsn)

	user := meta.User{
		Username:       "durable-reanalyze-owner",
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}

	persistOnly := &Server{
		DB:              db,
		photoFaceRunner: &fakePhotoFaceOwnerRunner{},
	}
	if err := persistOnly.persistPhotoIntelligenceReanalyzeIntents(
		context.Background(),
		user.ID,
		[]photoIntelligenceTaskKind{photoIntelligenceFace},
		background.TriggerUserAction,
		background.InitiatorUser,
		user.ID,
	); err != nil {
		t.Fatal(err)
	}

	var before meta.PhotoIntelligenceReanalyzeIntent
	if err := db.Where(
		"owner_id = ? AND kind = ?",
		user.ID,
		string(photoIntelligenceFace),
	).First(&before).Error; err != nil {
		t.Fatal(err)
	}
	if before.RequestedEpoch != 1 || before.AppliedEpoch != 0 {
		t.Fatalf("persisted intent before restart=%+v", before)
	}

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
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
	t.Cleanup(scheduler.Close)

	release := make(chan struct{})
	t.Cleanup(func() {
		select {
		case <-release:
		default:
			close(release)
		}
	})
	face := &fakePhotoFaceOwnerRunner{
		started:   make(chan uint64, 1),
		release:   release,
		processed: 0,
	}
	restarted := &Server{
		DB:                      db,
		BackgroundScheduler:     scheduler,
		photoFaceRunner:         face,
		photoIntelligenceOwners: make(map[photoIntelligenceOwnerKey]*photoIntelligenceOwnerState),
	}
	restarted.schedulePendingPhotoIntelligenceReanalyzeIntents(ctx)

	select {
	case ownerID := <-face.started:
		if ownerID != user.ID {
			t.Fatalf("recovered face owner=%d want=%d", ownerID, user.ID)
		}
	case <-time.After(time.Second):
		t.Fatal("durable reanalyze intent was not recovered after restart")
	}

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		var intent meta.PhotoIntelligenceReanalyzeIntent
		if err := db.Where(
			"owner_id = ? AND kind = ?",
			user.ID,
			string(photoIntelligenceFace),
		).First(&intent).Error; err == nil &&
			intent.RequestedEpoch == 1 &&
			intent.AppliedEpoch == 1 &&
			intent.AppliedAt != nil {
			close(release)
			return
		}
		time.Sleep(time.Millisecond)
	}
	var after meta.PhotoIntelligenceReanalyzeIntent
	_ = db.Where(
		"owner_id = ? AND kind = ?",
		user.ID,
		string(photoIntelligenceFace),
	).First(&after).Error
	t.Fatalf("recovered intent was not applied: %+v", after)
}
