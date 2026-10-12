//go:build linux

package api

import (
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
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

// TestPWAS2B3RealGinAuthFixture is opt-in and isolated: genuine Gin login,
// owner-scoped node reads, a private PostgreSQL schema and physical Local CAS.
// The built Web is served without API mocks. No JWT is exported in the ready
// file or CI artifacts. Physical installed-mode behavior is NOT verified.
func TestPWAS2B3RealGinAuthFixture(t *testing.T) {
	if os.Getenv("XD_PWA_S2B3_REAL_GIN") != "1" {
		t.Skip("explicit PWA S2B3 real Gin/Chromium acceptance only")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	readyPath := os.Getenv("XD_PWA_S2B3_READY_FILE")
	dist := os.Getenv("XD_PWA_S2B3_DIST")
	if dsn == "" || readyPath == "" || dist == "" {
		t.Fatal("isolated PostgreSQL DSN, private ready path and production Web dist required")
	}
	if _, err := os.Stat(filepath.Join(dist, "index.html")); err != nil {
		t.Fatal(err)
	}

	gin.SetMode(gin.TestMode)
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{},
		&meta.File{}, &meta.FileVersion{}, &meta.ContentBlob{},
		&meta.Share{}, &meta.UploadSession{}, &meta.UploadPart{},
		&meta.DownloadProgress{}, &meta.AuditEvent{},
		&meta.FileOperation{}, &meta.FileRecentAccess{},
		&meta.FileFavorite{}, &meta.FileQuickAccess{},
		&meta.FileTag{}, &meta.FileNodeTag{}, &meta.FileSavedSearch{},
		&meta.Source{}, &meta.SyncRun{},
		&meta.PhotoIntelligenceReanalyzeIntent{},
		&meta.BackgroundOwnerCancellation{}, &meta.ArchivePrepareRun{},
	); err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		"CREATE UNIQUE INDEX idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL",
		"CREATE UNIQUE INDEX idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL",
		"CREATE INDEX idx_xd_nodes_children_name ON xd_nodes(owner_id, parent_id, type, lower(name), id) WHERE parent_id IS NOT NULL AND deleted_at IS NULL",
	} {
		if err := db.Exec(sql).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := meta.InstallNodeChangeJournal(db); err != nil {
		t.Fatal(err)
	}
	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	srv := &Server{
		DB: db, Store: local,
		Auth:           auth.New("pwa-s2b3-gin-isolated", time.Hour),
		RefreshTTL:     24 * time.Hour,
		AllowedOrigin:  "http://localhost",
		MaxUploadBytes: 10 << 20,
	}
	router := srv.Router()
	const ownerName = "pwa-s2b3-owner"
	const ownerPassword = "PwaRealGin-TestOnly_2026!"
	const foreignName = "pwa-s2b3-foreign"
	const foreignPassword = "PwaRealGin-Foreign_2026!"
	ownerToken := createTestUser(t, db, router, ownerName, ownerPassword)
	foreignToken := createTestUser(t, db, router, foreignName, foreignPassword)
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", ownerToken, nil, http.StatusOK)
	folder := requestNode(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID),
		ownerToken, strings.NewReader(`{"name":"PWA S2B3 route target"}`), http.StatusCreated)
	request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/nodes/%d", folder.ID), foreignToken, nil, http.StatusNotFound)
	request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/nodes/%d", folder.ID), "", nil, http.StatusUnauthorized)

	done := make(chan struct{})
	var once sync.Once
	fileServer := http.FileServer(http.Dir(dist))
	mux := http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		switch {
		case request.URL.Path == "/__test/pwa-s2b3/finish":
			if request.Method != http.MethodPost {
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			once.Do(func() { close(done) })
			w.WriteHeader(http.StatusNoContent)
		case strings.HasPrefix(request.URL.Path, "/api/"):
			router.ServeHTTP(w, request)
		default:
			// Private API and signed downloads never fall back to index.html.
			// The product Service Worker itself remains public-offline-only.
			if request.Method != http.MethodGet && request.Method != http.MethodHead {
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			if request.URL.Path == "/sw.js" ||
				request.URL.Path == "/offline.html" ||
				request.URL.Path == "/site.webmanifest" {
				w.Header().Set("Cache-Control", "no-cache, must-revalidate")
			}
			fileServer.ServeHTTP(w, request)
		}
	})
	peer := httptest.NewServer(mux)
	defer peer.Close()

	// The private ready-file has no JWT, password, refresh token or CAS bytes.
	ready := map[string]any{
		"url": peer.URL, "username": ownerName, "foreign_username": foreignName,
		"root_id": root.ID, "target_id": folder.ID, "target_name": folder.Name,
		"real_gin": true, "postgresql": true, "local_cas": true,
		"intercepted_api": false, "physical_device": false,
	}
	payload, err := json.Marshal(ready)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(readyPath), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(readyPath, payload, 0600); err != nil {
		t.Fatal(err)
	}
	defer os.Remove(readyPath)

	select {
	case <-done:
		// Browser tests cannot mutate/cross owners; recheck production data.
		ownerRead := requestNode(t, router, http.MethodGet,
			fmt.Sprintf("/api/v1/nodes/%d", folder.ID), ownerToken, nil, http.StatusOK)
		if ownerRead.ID != folder.ID || ownerRead.ParentID == nil || *ownerRead.ParentID != root.ID {
			t.Fatalf("owner route Node changed unexpectedly: %+v", ownerRead)
		}
		request(t, router, http.MethodGet,
			fmt.Sprintf("/api/v1/nodes/%d", folder.ID), foreignToken, nil, http.StatusNotFound)
		t.Logf("PWA_S2B3_REAL_GIN_VERIFIED root=%d target=%d authentic_login=true foreign_404=true", root.ID, folder.ID)
	case <-time.After(2 * time.Minute):
		t.Fatal("real Chrome browser did not finish the isolated Gin fixture")
	}
}
