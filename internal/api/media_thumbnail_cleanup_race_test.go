package api

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Pause only after a genuine Local.Put has atomically published the thumbnail.
// This preserves the real filesystem and DB behavior on both sides of the race.
type mediaCleanupPausedWriteStore struct {
	*storage.Local
	published chan struct{}
	release   chan struct{}
}

func (s *mediaCleanupPausedWriteStore) Put(ctx context.Context, key string, reader io.Reader) (int64, error) {
	count, err := s.Local.Put(ctx, key, reader)
	if err != nil || storageInventoryCategory(key) != storageCleanupThumbnail {
		return count, err
	}
	close(s.published)
	select {
	case <-s.release:
		return count, nil
	case <-ctx.Done():
		return 0, ctx.Err()
	}
}

// R-MEDIA-001: a generation that physically writes a thumbnail before an
// administrator's cleanup can finish its DB publication after that cleanup.
// A durable metadata cache pointer must never refer to the deleted derivative.
func TestThumbnailCleanupDoesNotResurrectRemovedDerivativeMetadata(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
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
	sqlDB.SetMaxOpenConns(4)
	sqlDB.SetMaxIdleConns(0)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := resetMediaDerivativeTestSchema(db); err != nil {
		t.Fatal(err)
	}

	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	store := &mediaCleanupPausedWriteStore{
		Local: local, published: make(chan struct{}), release: make(chan struct{}),
	}
	var once sync.Once
	unblock := func() { once.Do(func() { close(store.release) }) }
	defer unblock()
	server := &Server{
		DB: db, Store: store,
		Auth:       auth.New("media-cache-cleanup-race-secret", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost",
		MaxUploadBytes: 10 << 20,
	}
	router := server.Router()
	token := createTestUser(t, db, router, "media-cleanup-race-user", "password-media-cleanup-race")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	file := uploadTestFile(t, router, token, root.ID, "cleanup-image.png", string(testPNG(t, 24, 18)))
	request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/media/items/%d", file.ID), token, nil, http.StatusOK)

	var node meta.Node
	if err := db.Preload("File").First(&node, file.ID).Error; err != nil {
		t.Fatal(err)
	}
	var metadata meta.MediaMetadata
	if err := db.Where("node_id = ?", file.ID).First(&metadata).Error; err != nil {
		t.Fatal(err)
	}
	key, edge, _, err := mediaDerivativeIdentity(node, metadata, mediaDerivativeThumbnail)
	if err != nil {
		t.Fatal(err)
	}
	if storageInventoryCategory(key) != storageCleanupThumbnail {
		t.Fatalf("generated key %q is not a managed thumbnail", key)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	generationDone := make(chan error, 1)
	go func() {
		generationDone <- server.generateMediaDerivative(ctx, node, metadata, mediaDerivativeThumbnail, key, edge)
	}()
	select {
	case <-store.published:
	case <-time.After(15 * time.Second):
		t.Fatal("actual local derivative PUT did not publish")
	}
	physicalReader, err := store.Open(ctx, key)
	if err != nil {
		t.Fatalf("producer never published physical derivative: %v", err)
	}
	_ = physicalReader.Close()

	// A correct cache fence may serialize cleanup behind its in-flight writer.
	// The first-red path is instead strictly ordered: actual cleanup finishes
	// before the delayed writer is released. Never reject valid serialization.
	type cleanupResult struct {
		result storageCacheCleanupDTO
		err    error
	}
	cleanupDone := make(chan cleanupResult, 1)
	go func() {
		result, err := server.cleanupStorageCache(ctx, storageCleanupThumbnail)
		cleanupDone <- cleanupResult{result: result, err: err}
	}()
	var finishedCleanup *cleanupResult
	select {
	case got := <-cleanupDone:
		finishedCleanup = &got
	case <-time.After(3 * time.Second):
		// A serializer can validly keep cleanup behind the producer.
	}
	unblock()
	select {
	case err := <-generationDone:
		if err != nil && !errors.Is(err, background.ErrSuperseded) {
			t.Fatalf("late genuine derivative producer failed unexpectedly: %v", err)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("late derivative producer never finished")
	}
	if finishedCleanup == nil {
		select {
		case got := <-cleanupDone:
			finishedCleanup = &got
		case <-time.After(15 * time.Second):
			t.Fatal("real admin cleanup never finished")
		}
	}
	if finishedCleanup.err != nil {
		t.Fatalf("real admin cache cleanup failed: %v", finishedCleanup.err)
	}
	if finishedCleanup.result.DeletedFiles != 1 || finishedCleanup.result.FailedFiles != 0 {
		t.Fatalf("cleanup did not evict actual derivative: %+v", finishedCleanup.result)
	}
	var persisted meta.MediaMetadata
	if err := db.Where("node_id = ?", file.ID).First(&persisted).Error; err != nil {
		t.Fatal(err)
	}
	if missingReader, err := store.Open(ctx, key); err == nil {
		_ = missingReader.Close()
		t.Fatalf("unexpected derivative recreated after cleanup: key=%q", key)
	} else if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("reader returned unexpected error: %v", err)
	}
	if persisted.ThumbnailKey != "" || persisted.ThumbnailMIMEType != "" ||
		persisted.ThumbnailWidth != 0 || persisted.ThumbnailHeight != 0 {
		t.Fatalf("stale generation re-published a deleted cache pointer after admin cleanup: key=%q persisted=%+v", key, persisted)
	}
}
