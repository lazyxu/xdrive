package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

// TestGalleryRealWebColdFixture100K exposes a real, authenticated Gin +
// PostgreSQL + local CAS fixture to a browser process. It is explicitly
// opt-in and does not change the production server or app entry points.
func TestGalleryRealWebColdFixture100K(t *testing.T) {
	if os.Getenv("XD_GALLERY_REAL_WEB_COLD_PERF") != "1" {
		t.Skip("set XD_GALLERY_REAL_WEB_COLD_PERF=1 for browser HTTP fixture")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	dist := os.Getenv("XD_GALLERY_REAL_WEB_DIST")
	readyFile := os.Getenv("XD_GALLERY_REAL_WEB_READY_FILE")
	if dsn == "" || dist == "" || readyFile == "" {
		t.Fatal("real Web cold fixture requires DB URL, built dist and ready-file path")
	}
	if _, err := os.Stat(filepath.Join(dist, "index.html")); err != nil {
		t.Fatalf("Web production performance bundle unavailable: %v", err)
	}
	gin.SetMode(gin.TestMode)
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{},
		&meta.AuditEvent{}, &meta.Source{}, &meta.SourceItem{},
		&meta.SourceCollection{}, &meta.SourceCollectionItem{},
		&meta.MediaMetadata{}, &meta.MediaDerivedResource{},
		&meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.PhotoAsset{}, &meta.PhotoResource{}, &meta.PhotoMetadata{},
		&meta.PhotoEditRecipe{}, &meta.PhotoCollection{}, &meta.PhotoCollectionAsset{},
	); err != nil {
		t.Fatal(err)
	}
	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	countingStore := &fileExplorerMediaPerfStore{inner: local}
	scheduler := background.NewScheduler(context.Background(), background.Config{
		Capacity: map[background.ResourceClass]int{
			background.ResourceMediaCPU: galleryFirstVisibleThumbnailConcurrency,
		},
		QueueCapacity: map[background.ResourceClass]int{
			background.ResourceMediaCPU: 256,
		},
	})
	defer scheduler.Close()
	server := &Server{
		DB: db, Store: countingStore,
		Auth:                auth.New("gallery-real-web-cold-100k", time.Hour),
		RefreshTTL:          24 * time.Hour,
		AllowedOrigin:       "http://localhost",
		MaxUploadBytes:      16 << 20,
		BackgroundScheduler: scheduler,
	}
	router := server.Router()
	token := createTestUser(t, db, router, "gallery-web-cold-100k", "browser-performance-password")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	folder := requestNode(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID), token,
		strings.NewReader(`{"name":"100k Browser Cold Gallery"}`), http.StatusCreated)
	var ownerRoot meta.Node
	if err := db.First(&ownerRoot, root.ID).Error; err != nil {
		t.Fatal(err)
	}

	started := time.Now()
	mediaGallerySeedFirstOpen100K(t, db, ownerRoot.OwnerID, folder.ID)
	page, err := server.queryMediaItemRange(
		context.Background(), ownerRoot.OwnerID, mediaQueryOptions{}, "", 100, 0,
	)
	if err != nil {
		t.Fatal(err)
	}
	if page.TotalCount != mediaGalleryFirstOpenLogicalCount ||
		len(page.Items) < galleryFirstVisibleViewport {
		t.Fatalf("invalid 100k browser page: total=%d first=%d", page.TotalCount, len(page.Items))
	}
	images, videos, liveCount := galleryFirstVisibleSeedObjects(
		t, db, countingStore, page.Items[:galleryFirstVisibleViewport],
	)
	if len(images) < 12 || len(videos) == 0 || liveCount == 0 {
		t.Fatalf("invalid mixed browser fixture: images=%d videos=%d Live=%d",
			len(images), len(videos), liveCount)
	}
	// A branch-only real-scroll benchmark prewarms the genuine JPEG files
	// outside the measured request window so its +160ms test is about actual
	// HTTP/Go cancellation rather than first-time background JPEG generation.
	viewportCancelMode := os.Getenv("XD_GALLERY_REAL_VIEWPORT_CANCEL_PERF") == "1"
	var viewportProbe *galleryRealWebScrollCancelProbe
	if viewportCancelMode {
		warming := httptest.NewServer(router)
		warmClient := &http.Client{Timeout: 30 * time.Second}
		metrics, warmErr := galleryFirstVisibleFetchThumbnails(
			warmClient, warming.URL, token, images, 6,
		)
		warming.Close()
		if warmErr != nil || metrics.RequestCount != len(images) {
			t.Fatalf("prewarm real viewport JPEGs: count=%d want=%d err=%v",
				metrics.RequestCount, len(images), warmErr)
		}
		viewportProbe = newGalleryRealWebScrollCancelProbe(images)
	}
	foldEnabled := os.Getenv("XD_GALLERY_REAL_WEB_FOLD_PERF") == "1"
	if foldEnabled {
		galleryRealWebFoldSeed100K(t, db, ownerRoot.OwnerID, page.Items)
	}
	seedMS := float64(time.Since(started).Microseconds()) / 1000
	countingStore.Reset()
	stopped := make(chan struct{})
	var once sync.Once
	files := http.FileServer(http.Dir(dist))
	httpHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/__perf/config":
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"token":              token,
				"logical_assets":     mediaGalleryFirstOpenLogicalCount,
				"physical_nodes":     mediaGalleryFirstOpenPhysical,
				"live_photo_groups":  mediaGalleryFirstOpenLivePhotos,
				"seed_ms":            seedMS,
				"fold_enabled":       foldEnabled,
				"fold_groups":        map[bool]int{true: galleryRealWebFoldGroups, false: 0}[foldEnabled],
				"fold_visible_count": map[bool]int{true: galleryRealWebFoldVisible, false: mediaGalleryFirstOpenLogicalCount}[foldEnabled],
			})
		case "/__perf/stats":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(countingStore.Snapshot())
		case "/__perf/viewport-cancel-stats":
			if viewportProbe == nil {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			_ = json.NewEncoder(w).Encode(viewportProbe.snapshot())
		case "/__perf/viewport-cancel-mark":
			if viewportProbe == nil || r.Method != http.MethodPost {
				http.Error(w, "native viewport benchmark only", http.StatusMethodNotAllowed)
				return
			}
			viewportProbe.mark()
			w.WriteHeader(http.StatusNoContent)
		case "/__perf/stop":
			if r.Method != http.MethodPost {
				http.Error(w, "POST required", http.StatusMethodNotAllowed)
				return
			}
			once.Do(func() { close(stopped) })
			w.WriteHeader(http.StatusNoContent)
		default:
			if viewportProbe != nil && r.Method == http.MethodGet &&
				viewportProbe.matches(r.URL.Path) {
				viewportProbe.serve(w, r, router)
				return
			}
			if strings.HasPrefix(r.URL.Path, "/api/") {
				router.ServeHTTP(w, r)
				return
			}
			files.ServeHTTP(w, r)
		}
	})
	httpServer := httptest.NewServer(httpHandler)
	defer httpServer.Close()
	ready := map[string]any{
		"url":                httpServer.URL,
		"seed_ms":            seedMS,
		"first_image_nodes":  len(images),
		"first_video_nodes":  len(videos),
		"first_live_assets":  liveCount,
		"logical_assets":     mediaGalleryFirstOpenLogicalCount,
		"physical_nodes":     mediaGalleryFirstOpenPhysical,
		"fold_enabled":       foldEnabled,
		"fold_groups":        map[bool]int{true: galleryRealWebFoldGroups, false: 0}[foldEnabled],
		"fold_visible_count": map[bool]int{true: galleryRealWebFoldVisible, false: mediaGalleryFirstOpenLogicalCount}[foldEnabled],
	}
	if err := os.MkdirAll(filepath.Dir(readyFile), 0700); err != nil {
		t.Fatal(err)
	}
	contents, err := json.Marshal(ready)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(readyFile, contents, 0600); err != nil {
		t.Fatal(err)
	}
	t.Logf("GALLERY_REAL_WEB_COLD_100K_READY %s", contents)
	select {
	case <-stopped:
		t.Logf("GALLERY_REAL_WEB_COLD_100K_STOP seed_ms=%.3f images=%d videos=%d live=%d",
			seedMS, len(images), len(videos), liveCount)
	case <-time.After(6 * time.Minute):
		t.Fatal("browser did not finish real Web Gallery first-paint workload")
	}
}
