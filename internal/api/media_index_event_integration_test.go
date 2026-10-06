package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/mediawake"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestMediaIndexerUsesFileCommitWakeupAndFallbackReconcile(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(6)
	sqlDB.SetMaxIdleConns(2)
	defer func() { _ = sqlDB.Close() }()

	if err := resetMediaDerivativeTestSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := mediawake.InstallPostgreSQLTrigger(db); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	listener := mediawake.Listen(ctx, dsn, nil)
	select {
	case <-listener.Ready:
	case <-time.After(5 * time.Second):
		t.Fatal("media index wakeup listener did not become ready")
	}

	scheduler := background.NewScheduler(
		ctx,
		background.Config{
			Capacity: map[background.ResourceClass]int{
				background.ResourceMediaCPU: 1,
			},
			QueueCapacity: map[background.ResourceClass]int{
				background.ResourceMediaCPU: 32,
			},
		},
	)
	defer scheduler.Close()

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		DB:                  db,
		Store:               store,
		Auth:                auth.New("media-index-event-secret", time.Hour),
		RefreshTTL:          24 * time.Hour,
		AllowedOrigin:       "http://localhost",
		MaxUploadBytes:      10 << 20,
		BackgroundScheduler: scheduler,
		MediaIndexWakeups:   listener.Events,
	}
	server.StartMediaIndexer(ctx)
	router := server.Router()

	token := createTestUser(
		t,
		db,
		router,
		"media-index-event-user",
		"password-media-index-event",
	)
	root := requestNode(
		t,
		router,
		http.MethodGet,
		"/api/v1/nodes/root",
		token,
		nil,
		http.StatusOK,
	)

	eventFile := uploadTestFile(
		t,
		router,
		token,
		root.ID,
		"event-indexed.png",
		string(testPNG(t, 11, 7)),
	)
	waitForMediaIndexProjection(
		t,
		db,
		eventFile.ID,
		eventFile.Revision,
		5*time.Second,
	)
	if snapshot := scheduler.Snapshot(); snapshot.Started == 0 {
		t.Fatalf("file commit did not submit scheduler work: %+v", snapshot)
	}

	if err := db.Exec(
		`DROP TRIGGER IF EXISTS xd_files_media_commit_wakeup ON xd_files`,
	).Error; err != nil {
		t.Fatal(err)
	}
	fallbackFile := uploadTestFile(
		t,
		router,
		token,
		root.ID,
		"fallback-indexed.png",
		string(testPNG(t, 9, 5)),
	)

	time.Sleep(150 * time.Millisecond)
	var before meta.MediaMetadata
	err = db.Where("node_id = ?", fallbackFile.ID).First(&before).Error
	if err == nil {
		t.Fatal("fallback file indexed without file-commit trigger or reconcile")
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatal(err)
	}

	server.scheduleStaleMediaOwners(ctx)
	waitForMediaIndexProjection(
		t,
		db,
		fallbackFile.ID,
		fallbackFile.Revision,
		5*time.Second,
	)
}

func waitForMediaIndexProjection(
	t *testing.T,
	db *gorm.DB,
	nodeID, revision uint64,
	timeout time.Duration,
) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	var lastErr error
	for time.Now().Before(deadline) {
		var metadata meta.MediaMetadata
		err := db.Where("node_id = ?", nodeID).First(&metadata).Error
		switch {
		case err == nil &&
			metadata.NodeRevision == revision &&
			metadata.IndexState == meta.MediaIndexStateReady:
			var asset meta.PhotoAsset
			assetErr := db.Where("primary_node_id = ?", nodeID).First(&asset).Error
			if assetErr == nil {
				return
			}
			lastErr = assetErr
		case err == nil:
			lastErr = fmt.Errorf(
				"metadata revision/state=%d/%q want=%d/%q",
				metadata.NodeRevision,
				metadata.IndexState,
				revision,
				meta.MediaIndexStateReady,
			)
		default:
			lastErr = err
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf(
		"media projection for node %d did not become ready: %v",
		nodeID,
		lastErr,
	)
}
