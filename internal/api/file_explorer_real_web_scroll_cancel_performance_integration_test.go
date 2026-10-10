package api

import (
	"bytes"
	"context"
	"crypto/sha256"
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
	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

// TestFileExplorerRealWebScrollCancelFixture100K supplies actual signed
// FileExplorer children and image-thumbnail routes to a mounted Web renderer.
// The 1.5s response writer and statistics endpoints are entirely test-only.
func TestFileExplorerRealWebScrollCancelFixture100K(t *testing.T) {
	if os.Getenv("XD_FILEEXPLORER_REAL_WEB_SCROLL_100K_PERF") != "1" {
		t.Skip("opt-in native 100k FileExplorer real-scroll performance fixture")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	dist := os.Getenv("XD_FILEEXPLORER_REAL_WEB_DIST")
	readyPath := os.Getenv("XD_FILEEXPLORER_REAL_WEB_READY_FILE")
	if dsn == "" || dist == "" || readyPath == "" {
		t.Fatal("native PostgreSQL, built Web dist and ready-file path are required")
	}
	if _, err := os.Stat(filepath.Join(dist, "index.html")); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(&meta.User{}, &meta.RefreshToken{}, &meta.Node{},
		&meta.File{}, &meta.AuditEvent{}, &meta.MediaMetadata{}); err != nil {
		t.Fatal(err)
	}

	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	store := &fileExplorerMediaPerfStore{inner: local}
	scheduler := background.NewScheduler(context.Background(), background.Config{
		Capacity: map[background.ResourceClass]int{background.ResourceMediaCPU: 6},
		QueueCapacity: map[background.ResourceClass]int{
			background.ResourceMediaCPU: 256,
		},
	})
	defer scheduler.Close()
	srv := &Server{
		DB: db, Store: store,
		Auth:       auth.New("file-explorer-real-scroll-perf-secret", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost",
		MaxUploadBytes: 16 << 20, BackgroundScheduler: scheduler,
	}
	router := srv.Router()
	token := createTestUser(t, db, router, "file-explorer-real-scroll-perf", "password")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	folder := requestNode(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID), token,
		strings.NewReader(`{"name":"100k Images"}`), http.StatusCreated)
	var ownerRoot meta.Node
	if err := db.First(&ownerRoot, root.ID).Error; err != nil {
		t.Fatal(err)
	}

	const logicalCount = 100000
	const distinctPhysicalImages = 16
	seedStarted := time.Now()
	if err := db.Exec(`CREATE TABLE file_explorer_real_scroll_variants (
		variant INTEGER PRIMARY KEY, sha256 TEXT NOT NULL,
		storage_key TEXT NOT NULL, size BIGINT NOT NULL
	)`).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < distinctPhysicalImages; i++ {
		data := fileExplorerMediaPerfJPEG(t, i)
		hash := fmt.Sprintf("%x", sha256.Sum256(data))
		key, keyErr := storage.ContentAddressedKey(hash)
		if keyErr != nil {
			t.Fatal(keyErr)
		}
		written, putErr := store.Put(context.Background(), key, bytes.NewReader(data))
		if putErr != nil || written != int64(len(data)) {
			t.Fatalf("variant %d put=%d expected=%d err=%v", i, written, len(data), putErr)
		}
		if err := db.Exec(`INSERT INTO file_explorer_real_scroll_variants
			(variant, sha256, storage_key, size) VALUES (?, ?, ?, ?)`,
			i, hash, key, len(data)).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Exec(`INSERT INTO xd_nodes
		(parent_id, name, type, owner_id, revision, created_at, updated_at)
		SELECT ?, 'image-' || lpad(gs::text, 6, '0') || '.jpg',
		'file', ?, 1, NOW(), NOW() FROM generate_series(1, ?) AS gs`,
		folder.ID, ownerRoot.OwnerID, logicalCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`INSERT INTO xd_files
		(node_id, size, storage_key, sha256, created_at, updated_at)
		SELECT n.id, v.size, v.storage_key, v.sha256, NOW(), NOW()
		FROM xd_nodes AS n
		JOIN file_explorer_real_scroll_variants AS v
		ON v.variant = ((substring(n.name from 7 for 6)::integer - 1) % ?)
		WHERE n.owner_id = ? AND n.parent_id = ? AND n.deleted_at IS NULL`,
		distinctPhysicalImages, ownerRoot.OwnerID, folder.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`INSERT INTO xd_media_metadata
		(node_id, owner_id, node_revision, sha256, media_kind, mime_type,
		relation_evidence_version, width, height, orientation, index_state,
		created_at, updated_at)
		SELECT n.id, n.owner_id, n.revision, f.sha256, ?, 'image/jpeg',
		?, 800, 600, 1, ?, NOW(), NOW()
		FROM xd_nodes AS n JOIN xd_files AS f ON f.node_id = n.id
		WHERE n.owner_id = ? AND n.parent_id = ? AND n.deleted_at IS NULL`,
		meta.MediaKindImage, mediapkg.RelationEvidenceVersion,
		meta.MediaIndexStateReady, ownerRoot.OwnerID, folder.ID).Error; err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		`CREATE UNIQUE INDEX idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`,
		`CREATE UNIQUE INDEX idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`,
		`CREATE INDEX idx_xd_nodes_children_name ON xd_nodes(owner_id, parent_id, type, lower(name), id) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`,
		`CREATE INDEX idx_xd_nodes_children_updated ON xd_nodes(owner_id, parent_id, type, updated_at, id) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`,
		`CREATE INDEX idx_xd_files_size_node ON xd_files(size, node_id)`,
	} {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, table := range []string{"xd_nodes", "xd_files", "xd_media_metadata"} {
		if err := db.Exec("ANALYZE " + table).Error; err != nil {
			t.Fatal(err)
		}
	}
	var firstIDs []uint64
	if err := db.Model(&meta.Node{}).Where("parent_id = ?", folder.ID).
		Order("name ASC").Limit(6).Pluck("id", &firstIDs).Error; err != nil {
		t.Fatal(err)
	}
	if len(firstIDs) != 6 {
		t.Fatalf("first visible real JPEG identities=%d", len(firstIDs))
	}
	warming := httptest.NewServer(router)
	warmClient := &http.Client{Timeout: 60 * time.Second}
	warmResult, warmErr := fileExplorerMediaPerfFetchThumbnails(
		warmClient, warming.URL, token, firstIDs, 6)
	warming.Close()
	if warmErr != nil || warmResult.RequestCount != 6 {
		t.Fatalf("prewarm 6 real JPEGs: result=%+v err=%v", warmResult, warmErr)
	}
	seedMS := float64(time.Since(seedStarted).Microseconds()) / 1000
	store.Reset()
	probe := newGalleryRealWebScrollCancelProbe(firstIDs) // shared test-only native writer

	stopped := make(chan struct{})
	var once sync.Once
	static := http.FileServer(http.Dir(dist))
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/__perf/config":
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"token": token, "folder_id": folder.ID,
				"logical_count": logicalCount, "physical_images": distinctPhysicalImages,
				"seed_ms": seedMS,
			})
		case "/__perf/viewport-cancel-stats":
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			_ = json.NewEncoder(w).Encode(probe.snapshot())
		case "/__perf/viewport-cancel-mark":
			if r.Method != http.MethodPost {
				http.Error(w, "POST required", http.StatusMethodNotAllowed)
				return
			}
			probe.mark()
			w.WriteHeader(http.StatusNoContent)
		case "/__perf/stop":
			if r.Method != http.MethodPost {
				http.Error(w, "POST required", http.StatusMethodNotAllowed)
				return
			}
			once.Do(func() { close(stopped) })
			w.WriteHeader(http.StatusNoContent)
		default:
			if r.Method == http.MethodGet && probe.matches(r.URL.Path) {
				probe.serve(w, r, router)
				return
			}
			if strings.HasPrefix(r.URL.Path, "/api/") {
				router.ServeHTTP(w, r)
				return
			}
			static.ServeHTTP(w, r)
		}
	})
	service := httptest.NewServer(handler)
	defer service.Close()
	ready := map[string]any{
		"url": service.URL, "folder_id": folder.ID, "logical_count": logicalCount,
		"physical_images": distinctPhysicalImages, "seed_ms": seedMS,
		"first_image_nodes": firstIDs,
	}
	contents, err := json.Marshal(ready)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(readyPath), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(readyPath, contents, 0600); err != nil {
		t.Fatal(err)
	}
	t.Logf("FILEEXPLORER_REAL_WEB_SCROLL_100K_READY %s", contents)
	select {
	case <-stopped:
		t.Logf("FILEEXPLORER_REAL_WEB_SCROLL_100K_STOP seed_ms=%.3f", seedMS)
	case <-time.After(8 * time.Minute):
		t.Fatal("browser did not finish FileExplorer mounted scroll fixture")
	}
}
