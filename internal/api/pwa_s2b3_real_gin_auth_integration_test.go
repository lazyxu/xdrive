//go:build linux

package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
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
	resumeMode := os.Getenv("XD_PWA_S4B2_REAL_RESUME") == "1"
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{},
		&meta.File{}, &meta.FileVersion{}, &meta.ContentBlob{},
		&meta.Share{}, &meta.UploadSession{}, &meta.UploadPart{},
		&meta.DownloadProgress{}, &meta.AuditEvent{},
		&meta.FileOperation{}, &meta.FileRecentAccess{},
		&meta.FileFavorite{}, &meta.FileQuickAccess{},
		&meta.FileTag{}, &meta.FileNodeTag{}, &meta.FileSavedSearch{},
		&meta.Source{}, &meta.SyncRun{}, &meta.SourceItem{},
		&meta.SourceCollection{}, &meta.SourceCollectionItem{},
		&meta.MediaMetadata{}, &meta.MediaDerivedResource{},
		&meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.PhotoAsset{}, &meta.PhotoResource{}, &meta.PhotoMetadata{},
		&meta.PhotoEditRecipe{}, &meta.PhotoAlbumFolder{},
		&meta.PhotoCollection{}, &meta.PhotoCollectionAsset{},
		&meta.PhotoAnalysisState{}, &meta.PhotoVisualLabel{}, &meta.PhotoOCRText{},
		&meta.PhotoPlaceLabel{}, &meta.PhotoPerson{}, &meta.PhotoPersonAsset{},
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
	maxUploadBytes := int64(10 << 20)
	if resumeMode {
		maxUploadBytes = 32 << 20
	}
	srv := &Server{
		DB: db, Store: local,
		Auth:           auth.New("pwa-s2b3-gin-isolated", time.Hour),
		RefreshTTL:     24 * time.Hour,
		AllowedOrigin:  "http://localhost",
		MaxUploadBytes: maxUploadBytes,
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

	// S2B6: a tiny genuine private PNG in Local CAS and the production
	// Gallery's Node/File/Media/PhotoAsset projection. Never export its bytes.
	var owner meta.User
	if err := db.Where("username = ?", ownerName).First(&owner).Error; err != nil {
		t.Fatal(err)
	}
	picture := image.NewRGBA(image.Rect(0, 0, 2, 2))
	picture.Set(0, 0, color.RGBA{R: 20, G: 90, B: 170, A: 255})
	var pngData bytes.Buffer
	if err := png.Encode(&pngData, picture); err != nil {
		t.Fatal(err)
	}
	hash := fmt.Sprintf("%x", sha256.Sum256(pngData.Bytes()))
	casKey, err := storage.ContentAddressedKey(hash)
	if err != nil {
		t.Fatal(err)
	}
	if written, err := local.Put(context.Background(), casKey, bytes.NewReader(pngData.Bytes())); err != nil || written != int64(pngData.Len()) {
		t.Fatalf("S2B6 physical CAS seed failed: written=%d err=%v", written, err)
	}
	picNode := meta.Node{
		ParentID: &folder.ID, Name: "pwa-s2b6-private.png",
		Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1,
	}
	if err := db.Create(&picNode).Error; err != nil {
		t.Fatal(err)
	}
	picSize := int64(pngData.Len())
	if err := db.Create(&meta.ContentBlob{
		SHA256: hash, Size: picSize, StorageKey: casKey,
		RefCount: 1, State: meta.ContentBlobStateReady,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{
		NodeID: picNode.ID, Size: picSize, StorageKey: casKey, SHA256: hash,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.FileVersion{
		NodeID: picNode.ID, Revision: 1, Size: picSize,
		StorageKey: casKey, SHA256: hash,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.MediaMetadata{
		NodeID: picNode.ID, OwnerID: owner.ID, NodeRevision: 1, SHA256: hash,
		MediaKind: meta.MediaKindImage, MIMEType: "image/png",
		Width: 2, Height: 2, IndexState: meta.MediaIndexStateReady,
	}).Error; err != nil {
		t.Fatal(err)
	}
	asset := meta.PhotoAsset{
		OwnerID: owner.ID, PrimaryNodeID: picNode.ID,
		Kind:        meta.PhotoAssetKindImage,
		EvidenceKey: fmt.Sprintf("node:%d", picNode.ID),
	}
	if err := db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.PhotoMetadata{
		AssetID: asset.ID, MediaKind: meta.MediaKindImage,
		MIMEType: "image/png", Width: 2, Height: 2,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.PhotoResource{
		AssetID: asset.ID, ResourceKind: meta.PhotoResourceKindNode,
		NodeID: picNode.ID, Role: meta.PhotoResourceRolePrimary,
		Name: picNode.Name, MediaKind: meta.MediaKindImage,
		MIMEType: "image/png", Size: picSize, SHA256: hash,
	}).Error; err != nil {
		t.Fatal(err)
	}
	// Authoritative owner/foreign/anonymous rules are exercised by Gin.
	request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d", picNode.ID),
		ownerToken, nil, http.StatusOK)
	request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d", picNode.ID),
		foreignToken, nil, http.StatusNotFound)
	request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/media/items/%d", picNode.ID),
		"", nil, http.StatusUnauthorized)
	request(t, router, http.MethodGet,
		"/api/v1/media/items?range=true&offset=0&limit=10",
		ownerToken, nil, http.StatusOK)

	var uploadSessions atomic.Int64
	var chunk0Requests atomic.Int64
	var chunk1Requests atomic.Int64
	var chunk2Requests atomic.Int64
	var injectedNetworkDrops atomic.Int64
	done := make(chan struct{})
	var once sync.Once
	fileServer := http.FileServer(http.Dir(dist))
	mux := http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		switch {
		case resumeMode && request.URL.Path == "/__test/pwa-s4b2/stats":
			if request.Method != http.MethodGet {
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]int64{
				"session_posts": uploadSessions.Load(),
				"chunk0_puts":   chunk0Requests.Load(),
				"chunk1_puts":   chunk1Requests.Load(),
				"chunk2_puts":   chunk2Requests.Load(),
				"tcp_drops":     injectedNetworkDrops.Load(),
			})
			return
		case request.URL.Path == "/__test/pwa-s2b3/finish":
			if request.Method != http.MethodPost {
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			once.Do(func() { close(done) })
			w.WriteHeader(http.StatusNoContent)
		case strings.HasPrefix(request.URL.Path, "/api/"):
			if resumeMode {
				if request.Method == http.MethodPost && request.URL.Path == "/api/v1/uploads" {
					uploadSessions.Add(1)
				}
				if request.Method == http.MethodPut && strings.HasPrefix(request.URL.Path, "/api/v1/uploads/") {
					switch {
					case strings.HasSuffix(request.URL.Path, "/chunks/0"):
						chunk0Requests.Add(1)
					case strings.HasSuffix(request.URL.Path, "/chunks/1"):
						chunk1Requests.Add(1)
						// Browser network stacks can silently replay an idempotent PUT
						// after a dropped socket. Keep the FIRST upload session offline
						// until a user-driven new POST creates session two.
						if uploadSessions.Load() < 2 {
							injectedNetworkDrops.Add(1)
							conn, _, err := w.(http.Hijacker).Hijack()
							if err != nil {
								t.Errorf("S4B2 test-only network interruption failed: %v", err)
								return
							}
							_ = conn.Close() // Real transport loss before this chunk reaches Gin/CAS.
							return
						}
					case strings.HasSuffix(request.URL.Path, "/chunks/2"):
						chunk2Requests.Add(1)
					}
				}
			}
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
		"media_node_id": picNode.ID,
		"real_gin":      true, "postgresql": true, "local_cas": true,
		"intercepted_api": false, "physical_device": false,
	}
	if resumeMode {
		ready["pwa_s4b2_resume"] = true
		ready["upload_name"] = "pwa-s4b2-17m.bin"
		ready["upload_size_bytes"] = int64(17 << 20)
		ready["intercepted_api"] = true // A SINGLE deliberate test-only network drop.
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
		request(t, router, http.MethodGet,
			fmt.Sprintf("/api/v1/media/items/%d", picNode.ID), ownerToken, nil, http.StatusOK)
		t.Logf("PWA_S2B3_REAL_GIN_VERIFIED root=%d target=%d authentic_login=true foreign_404=true", root.ID, folder.ID)
		if resumeMode {
			// The first 8 MiB must remain in the original Server session. The
			// reselected original must reuse it, not upload that chunk twice.
			if uploadSessions.Load() != 2 || chunk0Requests.Load() != 1 ||
				chunk1Requests.Load() < 2 || chunk2Requests.Load() != 1 ||
				injectedNetworkDrops.Load() != chunk1Requests.Load()-1 {
				t.Fatalf("S4B2 HTTP resume was not reused: sessions=%d chunk0=%d chunk1=%d chunk2=%d injectedDrops=%d",
					uploadSessions.Load(), chunk0Requests.Load(), chunk1Requests.Load(),
					chunk2Requests.Load(), injectedNetworkDrops.Load())
			}
			var resumed meta.Node
			if err := db.Where("owner_id = ? AND parent_id = ? AND name = ? AND deleted_at IS NULL",
				owner.ID, folder.ID, "pwa-s4b2-17m.bin").First(&resumed).Error; err != nil {
				t.Fatalf("S4B2 final original file missing: %v", err)
			}
			var file meta.File
			if err := db.Where("node_id = ?", resumed.ID).First(&file).Error; err != nil {
				t.Fatal(err)
			}
			const expectedBytes = int64(17 << 20)
			if file.Size != expectedBytes {
				t.Fatalf("S4B2 finalized file size=%d expected=%d", file.Size, expectedBytes)
			}
			var blob meta.ContentBlob
			if err := db.Where("sha256 = ?", file.SHA256).First(&blob).Error; err != nil {
				t.Fatal(err)
			}
			key, err := storage.ContentAddressedKey(file.SHA256)
			if err != nil || key != blob.StorageKey || blob.RefCount < 1 ||
				blob.State != meta.ContentBlobStateReady || blob.Size != expectedBytes {
				t.Fatalf("S4B2 CAS identity or reference invalid")
			}
			object, err := local.Open(context.Background(), key)
			if err != nil {
				t.Fatal(err)
			}
			actual := sha256.New()
			copied, copyErr := io.Copy(actual, object)
			closeErr := object.Close()
			if copyErr != nil || closeErr != nil || copied != expectedBytes {
				t.Fatalf("S4B2 physical CAS readback invalid: bytes=%d copyErr=%v closeErr=%v",
					copied, copyErr, closeErr)
			}
			wanted := sha256.New()
			buffer := make([]byte, 64<<10)
			for start := int64(0); start < expectedBytes; start += int64(len(buffer)) {
				for index := range buffer {
					i := start + int64(index)
					buffer[index] = byte((i*31 + (i >> 7)) % 251)
				}
				_, _ = wanted.Write(buffer)
			}
			if expected, found := fmt.Sprintf("%x", wanted.Sum(nil)), fmt.Sprintf("%x", actual.Sum(nil)); expected != found || file.SHA256 != expected {
				t.Fatalf("S4B2 complete physical nonzero-file SHA256 mismatch")
			}
			t.Logf("PWA_S4B2_AUTHENTIC_RESUME_VERIFIED bytes=%d sessions=%d reusedFirstChunk=true injectedDrops=%d physicalCAS_SHA256=true",
				expectedBytes, uploadSessions.Load(), injectedNetworkDrops.Load())
		}

	case <-time.After(5 * time.Minute):
		t.Fatal("real Chrome browser did not finish the isolated Gin fixture")
	}
}
