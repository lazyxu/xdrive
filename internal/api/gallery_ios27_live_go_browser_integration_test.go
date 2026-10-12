//go:build linux

package api

import (
	"bytes"
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

// TestIOS27GalleryLiveGoFixture hosts the built production Web and the real
// authenticated Gin/PostgreSQL17 Gallery. This 10k fixture is metadata-only:
// not physical CAS bytes, codec decode, or iOS 27 Safari acceptance.
func TestIOS27GalleryLiveGoFixture(t *testing.T) {
	if os.Getenv("XD_GALLERY_IOS27_LIVE_GO") != "1" {
		t.Skip("opt-in real Chromium to PostgreSQL Gallery acceptance")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	readyPath := os.Getenv("XD_GALLERY_IOS27_READY_FILE")
	dist := os.Getenv("XD_GALLERY_IOS27_DIST")
	if dsn == "" || readyPath == "" || dist == "" {
		t.Fatal("real PostgreSQL DSN, private ready path and Web build required")
	}
	if _, err := os.Stat(filepath.Join(dist, "index.html")); err != nil {
		t.Fatal(err)
	}

	gin.SetMode(gin.TestMode)
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{},
		&meta.Node{}, &meta.File{}, &meta.FileVersion{}, &meta.ContentBlob{},
		&meta.AuditEvent{}, &meta.Share{},
		&meta.UploadSession{}, &meta.UploadPart{}, &meta.FileOperation{},
		&meta.Source{}, &meta.SyncRun{}, &meta.SourceItem{}, &meta.SourceCollection{}, &meta.SourceCollectionItem{},
		&meta.MediaMetadata{}, &meta.MediaDerivedResource{},
		&meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.PhotoAsset{}, &meta.PhotoResource{}, &meta.PhotoMetadata{},
		&meta.PhotoEditRecipe{}, &meta.PhotoCollection{}, &meta.PhotoCollectionAsset{},
		&meta.PhotoAnalysisState{}, &meta.PhotoFace{},
		&meta.PhotoPersonCluster{}, &meta.PhotoPersonClusterFace{},
		&meta.PhotoPersonClusterState{}, &meta.PhotoPerson{}, &meta.PhotoPersonAsset{},
		&meta.PhotoPersonSuggestionReview{}, &meta.PhotoVisualLabel{}, &meta.PhotoPlaceLabel{},
		&meta.FileFavorite{}, &meta.FileTag{}, &meta.FileNodeTag{},
		&meta.PhotoIntelligenceReanalyzeIntent{}, &meta.BackgroundOwnerCancellation{},
		&meta.ArchivePrepareRun{},
	); err != nil {
		t.Fatal(err)
	}
	if err := meta.InstallNodeChangeJournal(db); err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	router := (&Server{
		DB: db, Store: store,
		Auth:           auth.New("ios27-gallery-real-go-isolated", time.Hour),
		RefreshTTL:     24 * time.Hour,
		AllowedOrigin:  "http://localhost",
		MaxUploadBytes: 10 << 20,
	}).Router()
	token := createTestUser(t, db, router, "gallery-live-owner", "test-only-gallery-owner-password")
	foreignToken := createTestUser(t, db, router, "gallery-live-foreign", "test-only-gallery-foreign-password")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	folder := requestNode(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID), token,
		strings.NewReader("{\"name\":\"ios27-gallery-ten-thousand\"}"), http.StatusCreated)
	var ownerRoot meta.Node
	if err := db.First(&ownerRoot, root.ID).Error; err != nil {
		t.Fatal(err)
	}
	// Existing production-shaped 70/15/15 photo/video/Live projection seed.
	// No duplicate Gallery list implementation and no fake browser response.
	mediaGallerySeedFirstOpenScaled(t, db, ownerRoot.OwnerID, folder.ID, 10_000)

	const rangePath = "/api/v1/media/items?range=true&limit=100&offset=0&sort_by=captured&sort_dir=asc&time_zone=UTC"
	readRange := func(jwt string) mediaItemRangeDTO {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, rangePath, nil)
		req.Header.Set("Authorization", "Bearer "+jwt)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("real Gin range=%d body=%s", rec.Code, rec.Body.String())
		}
		if rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("Gallery Range cache header=%q", rec.Header().Get("Cache-Control"))
		}
		var page mediaItemRangeDTO
		if err := json.NewDecoder(bytes.NewReader(rec.Body.Bytes())).Decode(&page); err != nil {
			t.Fatal(err)
		}
		return page
	}
	owned := readRange(token)
	if owned.TotalCount != 10_000 || len(owned.Items) != 100 {
		t.Fatalf("owner Gallery: total=%d firstRange=%d", owned.TotalCount, len(owned.Items))
	}
	foreign := readRange(foreignToken)
	if foreign.TotalCount != 0 || len(foreign.Items) != 0 {
		t.Fatalf("foreign Gallery revealed assets: total=%d items=%d", foreign.TotalCount, len(foreign.Items))
	}
	request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d", owned.Items[0].Node.ID),
		foreignToken, nil, http.StatusNotFound)

	stopped := make(chan struct{})
	var stopOnce sync.Once
	static := http.FileServer(http.Dir(dist))
	mux := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/__test/gallery/finish" {
			if r.Method != http.MethodPost {
				http.Error(w, "POST only", http.StatusMethodNotAllowed)
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
		static.ServeHTTP(w, r)
	})
	peer := httptest.NewServer(mux)
	defer peer.Close()

	// JWTs appear only in the private 0600 ready file, never CI artifacts.
	ready := map[string]any{
		"url": peer.URL, "token": token, "foreign_token": foreignToken,
		"username": "gallery-live-owner", "expected_total": 10_000,
		"expected_first_node_id": owned.Items[0].Node.ID,
		"real_gin":               true, "postgresql": true,
		"intercepted_api": false, "metadata_only": true,
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
	t.Logf("IOS27_GALLERY_LIVE_GO_READY logical=10000 owner=%d", ownerRoot.OwnerID)
	select {
	case <-stopped:
		var remaining int64
		if err := db.Model(&meta.PhotoAsset{}).
			Where("owner_id = ?", ownerRoot.OwnerID).Count(&remaining).Error; err != nil {
			t.Fatal(err)
		}
		if remaining != 10_000 {
			t.Fatalf("browser corrupted logical PhotoAssets: count=%d", remaining)
		}
		t.Log("IOS27_GALLERY_LIVE_GO_VERIFIED logical=10000 metadata_only=true")
	case <-time.After(5 * time.Minute):
		t.Fatal("real native browser did not finish the Gin/PostgreSQL fixture")
	}
}
