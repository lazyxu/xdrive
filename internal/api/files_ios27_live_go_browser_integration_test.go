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

// TestIOS27FilesLiveGoFixture serves the actual production Gin Router, a
// private PostgreSQL schema and physical Local CAS to a built-Web browser.
// No /api/v1 response is mocked. The /__test endpoint only stops the fixture.
func TestIOS27FilesLiveGoFixture(t *testing.T) {
	if os.Getenv("XD_FILES_IOS27_LIVE_GO") != "1" {
		t.Skip("explicit live-Go browser acceptance only")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	readyPath := os.Getenv("XD_FILES_IOS27_READY_FILE")
	dist := os.Getenv("XD_FILES_IOS27_DIST")
	if dsn == "" || readyPath == "" || dist == "" {
		t.Fatal("PostgreSQL DSN, private ready path and built Web dist are required")
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
	for _, index := range []string{
		"CREATE UNIQUE INDEX idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL",
		"CREATE UNIQUE INDEX idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL",
		"CREATE INDEX idx_xd_nodes_children_name ON xd_nodes(owner_id, parent_id, type, lower(name), id) WHERE parent_id IS NOT NULL AND deleted_at IS NULL",
	} {
		if err := db.Exec(index).Error; err != nil {
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
	router := (&Server{
		DB: db, Store: local,
		Auth:           auth.New("files-ios27-real-go-isolated", time.Hour),
		RefreshTTL:     24 * time.Hour,
		AllowedOrigin:  "http://localhost",
		MaxUploadBytes: 10 << 20,
	}).Router()
	username := "ios27-files-owner"
	token := createTestUser(t, db, router, username, "test-only-owner-password")
	foreignToken := createTestUser(t, db, router, "ios27-files-other", "test-only-other-password")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	file := uploadTestFile(t, router, token, root.ID, "document-001.txt", "actual PostgreSQL/CAS document")
	occupied := uploadTestFile(t, router, token, root.ID, "occupied.txt", "immutable collision sentinel")
	// Cross-owner responses are the genuine product's 404 semantics, NOT the
	// synthetic 403 used by the earlier intercepted-HTTP Chrome matrix.
	request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/nodes/%d", file.ID), foreignToken, nil, http.StatusNotFound)
	requestWithHeaders(t, router, http.MethodPatch,
		fmt.Sprintf("/api/v1/nodes/%d", file.ID), foreignToken,
		strings.NewReader("{\"name\":\"foreign-rewrite.txt\"}"), http.StatusNotFound,
		map[string]string{"If-Match": fmt.Sprintf("\"%d\"", file.Revision)})

	stopped := make(chan struct{})
	var stopOnce sync.Once
	fileServer := http.FileServer(http.Dir(dist))
	mux := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/__test/files/finish" {
			if r.Method != http.MethodPost {
				http.Error(w, "POST required", http.StatusMethodNotAllowed)
				return
			}
			stopOnce.Do(func() { close(stopped) })
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			router.ServeHTTP(w, r)
			return
		}
		fileServer.ServeHTTP(w, r)
	})
	peer := httptest.NewServer(mux)
	defer peer.Close()
	// Only a private, non-artifact runner file contains the real JWTs.
	ready := map[string]any{
		"url":             peer.URL,
		"username":        username,
		"token":           token,
		"foreign_token":   foreignToken,
		"root_id":         root.ID,
		"node_id":         file.ID,
		"node_revision":   file.Revision,
		"collision_id":    occupied.ID,
		"postgresql":      true,
		"real_gin":        true,
		"intercepted_api": false,
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
	t.Logf("IOS27_FILES_LIVE_GO_READY url=%s root=%d node=%d revision=%d",
		peer.URL, root.ID, file.ID, file.Revision)

	select {
	case <-stopped:
		var after, collision meta.Node
		if err := db.First(&after, file.ID).Error; err != nil {
			t.Fatal(err)
		}
		if after.Name != "wide-accepted.txt" || after.Revision != file.Revision+2 ||
			after.ID != file.ID || after.OwnerID == 0 {
			t.Fatalf("live UI rename did not preserve Node ID, owner and two revisions: %+v", after)
		}
		if err := db.First(&collision, occupied.ID).Error; err != nil {
			t.Fatal(err)
		}
		if collision.Name != "occupied.txt" || collision.Revision != occupied.Revision {
			t.Fatalf("failed rename changed collision sentinel: %+v", collision)
		}
		t.Logf("IOS27_FILES_LIVE_GO_VERIFIED id=%d revision=%d name=%s owner=%d",
			after.ID, after.Revision, after.Name, after.OwnerID)
	case <-time.After(4 * time.Minute):
		t.Fatal("live browser did not finish the real Gin/PostgreSQL fixture")
	}
}
