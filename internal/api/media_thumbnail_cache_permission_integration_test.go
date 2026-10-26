package api

import (
	"bytes"
	"context"
	"fmt"
	"image/jpeg"
	"net/http"
	"os"
	"path/filepath"
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

// A real authenticated Owner thumbnail HTTP request must recover from a
// root-to-user migration's read-only cache parents. Server readiness alone
// cannot detect this: Local.Ready only probes storage root/upload staging.
// The normal storage-init repair is exercised separately in cmd/server tests.
func TestMediaThumbnailColdCachePermissionFailureAndRetry(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("requires a non-root Server UID to reproduce cache EACCES")
	}
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

	filesRoot := t.TempDir()
	store, err := storage.NewLocal(filesRoot)
	if err != nil {
		t.Fatal(err)
	}
	scheduler := background.NewScheduler(
		context.Background(),
		background.Config{
			Capacity: map[background.ResourceClass]int{
				background.ResourceMediaCPU: 1,
			},
			QueueCapacity: map[background.ResourceClass]int{
				background.ResourceMediaCPU: 2,
			},
		},
	)
	defer scheduler.Close()
	server := &Server{
		DB:                  db,
		Store:               store,
		Auth:                auth.New("media-cache-permission-regression-secret", time.Hour),
		RefreshTTL:          24 * time.Hour,
		AllowedOrigin:       "http://localhost",
		MaxUploadBytes:      10 << 20,
		BackgroundScheduler: scheduler,
	}
	router := server.Router()
	token := createTestUser(t, db, router, "cache-permission-regression-owner", "password-cache-permission")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	uploaded := uploadTestFile(t, router, token, root.ID, "photo.png", string(testPNG(t, 16, 12)))
	// Materialize the authoritative MIME/SHA used for the deterministic key.
	request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d", uploaded.ID), token, nil, http.StatusOK)
	var node meta.Node
	if err := db.Preload("File").First(&node, uploaded.ID).Error; err != nil {
		t.Fatal(err)
	}
	var metadata meta.MediaMetadata
	if err := db.Where("node_id = ?", uploaded.ID).First(&metadata).Error; err != nil {
		t.Fatal(err)
	}
	key := mediaThumbnailStorageKey(node, metadata)
	cacheRoot := filepath.Join(filesRoot, ".xdrive-media")
	shard := filepath.Join(filesRoot, filepath.FromSlash(filepath.Dir(key)))
	if err := os.MkdirAll(shard, 0o700); err != nil {
		t.Fatal(err)
	}
	// A read-only cache ROOT can still permit writes to an existing writable
	// shard (it needs only +x for traversal). Reproduce the actual cold PUT
	// denial by locking the leaf SHARD that owns os.CreateTemp. This was the
	// exact source of the previous CI false negative (200 rather than 500).
	if err := os.Chmod(cacheRoot, 0o100); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(shard, 0o100); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = os.Chmod(cacheRoot, 0o700)
		_ = os.Chmod(shard, 0o700)
	})
	// Make the fixture independent of whether other upload/index flows have
	// already warmed this exact deterministic versioned thumbnail.
	fullKey := filepath.Join(filesRoot, filepath.FromSlash(key))
	if err := os.Remove(fullKey); err != nil && !os.IsNotExist(err) {
		// The unreadable shard may deny unlinking; restore only to evict the
		// fixture, then lock it again before the HTTP reproduction.
		if err := os.Chmod(shard, 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.Remove(fullKey); err != nil && !os.IsNotExist(err) {
			t.Fatal(err)
		}
		if err := os.Chmod(shard, 0o100); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.Open(context.Background(), key); err == nil {
		t.Fatal("fixture unexpectedly kept a previously cached derivative")
	}
	// Negative-control: prove Local.Put itself is denied under this exact
	// UID/mount, rather than asserting a 500 on a platform with bypass ACLs.
	if _, err := store.Put(context.Background(), key, bytes.NewReader([]byte("probe"))); err == nil {
		t.Skip("runtime can write a mode-0100 shard; cannot reproduce EACCES here")
	}
	if err := store.Ready(context.Background()); err != nil {
		t.Fatalf("ordinary storage readiness unexpectedly caught inaccessible derivative cache: %v", err)
	}

	url := fmt.Sprintf("/api/v1/media/items/%d/thumbnail?revision=%d", uploaded.ID, uploaded.Revision)
	failed := request(t, router, http.MethodGet, url, token, nil, http.StatusInternalServerError)
	if got := failed.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("cold cache EACCES response must not poison the browser cache: %q", got)
	}
	if err := os.Chmod(cacheRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(shard, 0o700); err != nil {
		t.Fatal(err)
	}
	// Repeating the same versioned authenticated GET must render on demand,
	// without deleting canonical originals or resetting image metadata.
	recovered := request(t, router, http.MethodGet, url, token, nil, http.StatusOK)
	if recovered.Header().Get("Content-Type") != "image/jpeg" {
		t.Fatalf("recovered thumbnail Content-Type=%q", recovered.Header().Get("Content-Type"))
	}
	cfg, err := jpeg.DecodeConfig(bytes.NewReader(recovered.Body.Bytes()))
	if err != nil || cfg.Width != 16 || cfg.Height != 12 {
		t.Fatalf("recovered image decode config=%+v err=%v", cfg, err)
	}
	if recovered.Header().Get("Content-Length") != fmt.Sprint(recovered.Body.Len()) {
		t.Fatalf("recovered thumbnail content length mismatch")
	}

	// Old root-owned caches may leave individual files unreadable even after
	// parents are repaired. The existing thumbnail generator must atomically
	// replace such a file, not return a permanently broken response.
	if err := os.Chmod(fullKey, 0o000); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(fullKey, 0o600) })
	again := request(t, router, http.MethodGet, url, token, nil, http.StatusOK)
	if _, err := jpeg.DecodeConfig(bytes.NewReader(again.Body.Bytes())); err != nil {
		t.Fatalf("regenerated unreadable derivative failed to decode: %v", err)
	}
}
