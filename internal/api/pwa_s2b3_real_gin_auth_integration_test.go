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
	// CR-02b3 isolated real Go 429/503 faults; never enabled in production.
	transientMode := os.Getenv("XD_PWA_CR02B3_TRANSIENT") == "1"
	// CR04 is an opt-in, isolated real Gin/PWA concurrency fixture only.
	cr04Mode := os.Getenv("XD_PWA_CR04_RANGE_REVOKE") == "1"
	nativeDownloadMode := os.Getenv("XD_PWA_S4C3_NATIVE_DOWNLOAD") == "1"
	nativeCancelMode := os.Getenv("XD_PWA_S4C3_CANCEL") == "1"
	wakeMode := os.Getenv("XD_PWA_S4D2_WAKE") == "1"
	durableMode := os.Getenv("XD_PWA_S4D3_DURABLE") == "1"
	cancelDurableMode := os.Getenv("XD_PWA_CR01B4_CANCEL_DURABLE") == "1"
	if cancelDurableMode && !durableMode {
		t.Fatal("CR01b4 requires genuine S4D3 durable worker")
	}
	resumeMode := os.Getenv("XD_PWA_S4B2_REAL_RESUME") == "1"
	largeResumeMode := os.Getenv("XD_PWA_S4B2_LARGE_RESUME") == "1"
	folderResumeMode := os.Getenv("XD_PWA_S4B3_REAL_FOLDER") == "1"
	if nativeDownloadMode && (resumeMode || largeResumeMode || folderResumeMode) {
		t.Fatal("S4C3 native-download fixture cannot alter S4B2 upload fault mode")
	}
	if wakeMode && (nativeDownloadMode || resumeMode || largeResumeMode || folderResumeMode || durableMode) {
		t.Fatal("S4D2 wake fixture must remain independent from native downloads, durable worker and uploads")
	}
	if durableMode && (nativeDownloadMode || resumeMode || largeResumeMode || folderResumeMode) {
		t.Fatal("S4D3 durable worker fixture must not change native transfers or upload fault modes")
	}
	if nativeCancelMode && !nativeDownloadMode {
		t.Fatal("S4C3 cancellation requires native download mode")
	}
	if folderResumeMode && (!resumeMode || largeResumeMode) {
		t.Fatal("B3B folder fault requires standalone isolated 17 MiB resume mode")
	}
	if largeResumeMode && !resumeMode {
		t.Fatal("1 GiB upload fault requires the isolated S4B2 resume fixture")
	}
	resumeFileName := "pwa-s4b2-17m.bin"
	resumeExpectedBytes := int64(17 << 20)
	resumeExpectedChunks := int64(3)
	if folderResumeMode {
		resumeFileName = "pwa-b3b-dynamic-child"
	}
	if largeResumeMode {
		resumeFileName = "pwa-s4b2-1gib.bin"
		resumeExpectedBytes = 1 << 30
		resumeExpectedChunks = 128
	}
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
	if largeResumeMode {
		// Only this private test fixture lifts its per-file limit.
		maxUploadBytes = 2 << 30
	}
	srv := &Server{
		DB: db, Store: local,
		Auth:           auth.New("pwa-s2b3-gin-isolated", time.Hour),
		RefreshTTL:     24 * time.Hour,
		AllowedOrigin:  "http://localhost",
		MaxUploadBytes: maxUploadBytes,
	}
	// CR-02b1 only: persist a genuine installation identity through the
	// production PostgreSQL meta helper before building the real Gin Router.
	// Keep legacy S2B3 fixture behavior unchanged without this explicit switch.
	if os.Getenv("XD_PWA_CR02B1_REAL_ACL") == "1" || transientMode || cr04Mode {
		if err := db.AutoMigrate(&meta.PWAOfflineInstance{}); err != nil {
			t.Fatal(err)
		}
		instanceID, err := meta.EnsurePWAOfflineInstanceID(db)
		if err != nil {
			t.Fatal(err)
		}
		srv.PWAOfflineInstanceID = instanceID
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
	var wakeFixture *pwaS4D2WakeFixture
	var durableFixture *pwaS4D3DurableFixture
	if wakeMode || durableMode {
		var foreign meta.User
		if err := db.Where("username = ?", foreignName).First(&foreign).Error; err != nil {
			t.Fatal(err)
		}
		if wakeMode {
			wakeFixture = pwaS4D2Prepare(t, db, owner.ID, foreign.ID)
		}
		if durableMode {
			durableFixture = pwaS4D3Prepare(
				t, srv, db, router, ownerToken, foreignToken, owner.ID, foreign.ID, folder.ID,
			)
		}
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

	// S4C3-B1: a real, physically allocated, independently SHA-verified
	// encrypted synthetic CAS fixture, never user media or a sparse file.
	var nativeSeed pwaS4C3NativeSeed
	if nativeDownloadMode {
		sizeGiB := int64(1)
		if requested := strings.TrimSpace(os.Getenv("XD_PWA_S4C3_SIZE_GIB")); requested != "" {
			switch requested {
			case "1":
				sizeGiB = 1
			case "4":
				sizeGiB = 4
			default:
				t.Fatal("S4C3 native download fixture accepts only 1 or 4 GiB")
			}
		}
		nativeSeed = pwaS4C3SeedNativeFile(t, db, local, owner.ID, folder.ID, sizeGiB)
	}
	var uploadSessions atomic.Int64
	var chunk0Requests atomic.Int64
	var chunk1Requests atomic.Int64
	var chunk2Requests atomic.Int64
	var lastChunkRequests atomic.Int64
	var totalChunkRequests atomic.Int64
	var injectedNetworkDrops atomic.Int64
	var cr02b3Armed atomic.Bool
	var cr02b3Target atomic.Int64
	var cr02b3Me503 atomic.Bool
	var cr02b3Node429 atomic.Bool
	var cr02b3Range503 atomic.Bool
	var cr01b4Probe pwaCR01b4ReadProbe
	// Real authenticated one-row Range is paced only after CR04 explicitly arms
	// the exact Owner-scoped directory. Other API requests are unchanged.
	var cr04Probe pwaCR01b4ReadProbe
	var cr04Armed atomic.Bool
	var cr04Node atomic.Int64
	var cr04SWB atomic.Bool
	var nativeFirstDownloadPaced atomic.Bool
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
				"session_posts":    uploadSessions.Load(),
				"chunk0_puts":      chunk0Requests.Load(),
				"chunk1_puts":      chunk1Requests.Load(),
				"chunk2_puts":      chunk2Requests.Load(),
				"last_chunk_puts":  lastChunkRequests.Load(),
				"total_chunk_puts": totalChunkRequests.Load(),
				"tcp_drops":        injectedNetworkDrops.Load(),
			})
			return
		case transientMode && request.URL.Path == "/__test/pwa-cr02b3/arm":
			if request.Method != http.MethodPost {
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			var id int64
			if n, err := fmt.Sscan(request.URL.Query().Get("node_id"), &id); err != nil || n != 1 || id <= 0 {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			cr02b3Target.Store(id)
			cr02b3Armed.Store(true)
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusNoContent)
			return
		case cr04Mode && request.URL.Path == "/__test/pwa-cr04/arm":
			if request.Method != http.MethodPost {
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			var nodeID int64
			if n, err := fmt.Sscan(request.URL.Query().Get("node_id"), &nodeID); err != nil || n != 1 || nodeID <= 0 {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			var checked meta.Node
			if err := db.Where("owner_id = ? AND id = ? AND type = ? AND deleted_at IS NULL",
				owner.ID, nodeID, "dir").First(&checked).Error; err != nil {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			if cr04Armed.Load() || cr04Probe.started.Load() {
				w.WriteHeader(http.StatusConflict)
				return
			}
			cr04Node.Store(nodeID)
			cr04Armed.Store(true)
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusNoContent)
			return
		case cr04Mode && request.URL.Path == "/__test/pwa-cr04/release-b":
			if request.Method != http.MethodPost {
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			if !cr04Probe.started.Load() || cr04Probe.handlerExited.Load() {
				w.WriteHeader(http.StatusConflict)
				return
			}
			cr04SWB.Store(true)
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusNoContent)
			return
		case cr04Mode && request.URL.Path == "/__test/pwa-cr04/proof":
			if request.Method != http.MethodGet {
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]bool{
				"read_started":           cr04Probe.started.Load(),
				"read_context_cancelled": cr04Probe.cancelled.Load(),
				"read_handler_exited":    cr04Probe.handlerExited.Load(),
				"sw_b_published":         cr04SWB.Load(),
			})
			return
		case cr04Mode && cr04SWB.Load() && request.URL.Path == "/sw.js":
			// Only in an explicitly gated test fixture: exact built production SW
			// plus an inert release marker. Do not mock its install/fetch/activate.
			if request.Method != http.MethodGet && request.Method != http.MethodHead {
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			original, err := os.ReadFile(filepath.Join(dist, "sw.js"))
			if err != nil {
				http.NotFound(w, request)
				return
			}
			publicB := append(original, []byte("\n// CR04 isolated real public SW release B\n")...)
			w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
			w.Header().Set("Cache-Control", "no-cache, must-revalidate")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			if request.Method == http.MethodGet {
				_, _ = w.Write(publicB)
			}
			return
		case cancelDurableMode && request.URL.Path == "/__test/pwa-cr01b4/proof":
			if request.Method != http.MethodGet {
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]bool{
				"read_started":           cr01b4Probe.started.Load(),
				"read_context_cancelled": cr01b4Probe.cancelled.Load(),
				"read_handler_exited":    cr01b4Probe.handlerExited.Load(),
			})
			return
		case wakeMode && request.URL.Path == "/__test/pwa-s4d2/advance":
			wakeFixture.advance(w, request, db)
			return
		case durableMode && request.URL.Path == "/__test/pwa-s4d3/start-worker":
			durableFixture.startWorker(w, request, srv)
			return
		case request.URL.Path == "/__test/pwa-s2b3/finish":
			if request.Method != http.MethodPost {
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			once.Do(func() { close(done) })
			w.WriteHeader(http.StatusNoContent)
		case strings.HasPrefix(request.URL.Path, "/api/"):
			if cr04Mode && request.Method == http.MethodGet &&
				request.URL.Path == fmt.Sprintf("/api/v1/nodes/%d/children", cr04Node.Load()) &&
				cr04Armed.CompareAndSwap(true, false) {
				writer := &pwaCR01b4PacedWriter{ResponseWriter: w, request: request, probe: &cr04Probe}
				router.ServeHTTP(writer, request) // unchanged production Gin + Owner ACL
				cr04Probe.handlerExited.Store(true)
				return
			}
			// CR01b4: the real authenticated Gin Handler starts its normal
			// bounded read, writes genuine Go JSON, and pauses ONLY at a test-
			// controlled ResponseWriter. Browser abort must propagate to the
			// request Context; the Server worker uses a different lifetime.
			if cancelDurableMode && request.Method == http.MethodGet &&
				request.URL.Path == fmt.Sprintf("/api/v1/nodes/%d/children", folder.ID) &&
				request.Header.Get("X-PWA-CR01B4-Slow-Read") == "real-go-context" {
				writer := &pwaCR01b4PacedWriter{ResponseWriter: w, request: request, probe: &cr01b4Probe}
				router.ServeHTTP(writer, request)
				cr01b4Probe.handlerExited.Store(true)
				return
			}
			// Genuine Gin fixture returns real HTTP 503/429 only AFTER the
			// test explicitly arms it; all successful follow-ups reach the
			// unchanged production auth/ACL Gin Router. No API interception in Chrome.
			if transientMode && cr02b3Armed.Load() && request.Method == http.MethodGet {
				uri := request.URL.Path
				node := fmt.Sprintf("/api/v1/nodes/%d", cr02b3Target.Load())
				status := 0
				switch {
				case uri == "/api/v1/me" && cr02b3Me503.CompareAndSwap(false, true):
					status = http.StatusServiceUnavailable
				case uri == node && cr02b3Node429.CompareAndSwap(false, true):
					status = http.StatusTooManyRequests
				case uri == node+"/children" && cr02b3Range503.CompareAndSwap(false, true):
					status = http.StatusServiceUnavailable
				}
				if status != 0 {
					w.Header().Set("Cache-Control", "no-store")
					w.Header().Set("Retry-After", "0")
					w.WriteHeader(status)
					return
				}
			}
			if request.Method != http.MethodGet && request.Method != http.MethodHead &&
				(strings.Contains(request.URL.Path, "/background-tasks/control") ||
					strings.HasPrefix(request.URL.Path, "/api/v1/uploads") ||
					strings.HasPrefix(request.URL.Path, "/api/v1/file-operations")) {
				if wakeMode {
					wakeFixture.mutations.Add(1)
				}
				if durableMode {
					durableFixture.mutations.Add(1)
				}
			}
			// Test-only pacing on the FIRST genuine signed HTTP response.
			if nativeCancelMode && request.Method == http.MethodGet &&
				request.URL.Path == fmt.Sprintf("/api/v1/file-download/%d", nativeSeed.nodeID) &&
				request.URL.Query().Has("ticket") && nativeFirstDownloadPaced.CompareAndSwap(false, true) {
				router.ServeHTTP(&pwaS4C3PacedWriter{ResponseWriter: w}, request)
				return
			}
			if resumeMode {
				if request.Method == http.MethodPost && request.URL.Path == "/api/v1/uploads" {
					uploadSessions.Add(1)
				}
				if request.Method == http.MethodPut && strings.HasPrefix(request.URL.Path, "/api/v1/uploads/") {
					totalChunkRequests.Add(1)
					switch {
					case strings.HasSuffix(request.URL.Path, "/chunks/0"):
						chunk0Requests.Add(1)
					case strings.HasSuffix(request.URL.Path, "/chunks/1"):
						chunk1Requests.Add(1)
						// Real browsers can retry dropped PUTs. The folder workflow lets
						// the first actual FileList child finish, fails only session 2,
						// and accepts a user-reselected session 3. No filename sorting.
						faultRecoverySession := int64(2)
						if folderResumeMode {
							faultRecoverySession = 3 // The first browser-enumerated child was committed.
						}
						if uploadSessions.Load() < faultRecoverySession &&
							(!folderResumeMode || uploadSessions.Load() == faultRecoverySession-1) {
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
					case largeResumeMode && strings.HasSuffix(request.URL.Path, "/chunks/127"):
						lastChunkRequests.Add(1)
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
			// Go FileServer redirects literal /index.html to "./" (301).
			// The real production SW precache requests /index.html with
			// redirect:error, so this local Gin fixture must serve that
			// public file directly, without weakening SW MIME/redirect checks.
			if request.URL.Path == "/index.html" {
				file, err := os.Open(filepath.Join(dist, "index.html"))
				if err != nil {
					http.NotFound(w, request)
					return
				}
				defer file.Close()
				info, err := file.Stat()
				if err != nil || !info.Mode().IsRegular() {
					http.NotFound(w, request)
					return
				}
				w.Header().Set("Cache-Control", "no-cache, must-revalidate")
				http.ServeContent(w, request, "index.html", info.ModTime(), file)
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
	if wakeMode {
		ready["pwa_s4d2_wake"] = true
		ready["wake_task_id"] = "sync-run:" + wakeFixture.ownerRunID
	}
	if cr04Mode {
		ready["pwa_cr04_range_revoke"] = true
	}
	if cancelDurableMode {
		ready["pwa_cr01b4_cancel_durable"] = true
	}
	if durableMode {
		ready["pwa_s4d3_durable"] = true
		ready["durable_task_id"] = "file-operation:" + durableFixture.operationID
	}
	if nativeDownloadMode {
		ready["pwa_s4c3_native_download"] = true
		ready["pwa_s4c3_cancel"] = nativeCancelMode
		ready["native_download_node_id"] = nativeSeed.nodeID
		ready["native_download_name"] = nativeSeed.name
		ready["native_download_size_bytes"] = nativeSeed.size
		ready["native_download_sha256"] = nativeSeed.sha
		ready["native_download_physically_allocated"] = nativeSeed.allocated >= nativeSeed.size*98/100
	}
	if resumeMode {
		ready["pwa_s4b2_resume"] = true
		ready["upload_name"] = resumeFileName
		ready["upload_size_bytes"] = resumeExpectedBytes
		ready["expected_chunks"] = resumeExpectedChunks
		ready["pwa_s4b2_large_resume"] = largeResumeMode
		ready["pwa_s4b3_folder"] = folderResumeMode
		ready["intercepted_api"] = true // Private TCP interruption, never an API mock.
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
		if wakeMode {
			wakeFixture.verify(t, db, router, ownerToken, foreignToken)
		}
		if durableMode {
			durableFixture.verify(t, srv, db, router, ownerToken, foreignToken)
		}
		if cr04Mode && (!cr04Probe.started.Load() || !cr04Probe.cancelled.Load() ||
			!cr04Probe.handlerExited.Load() || !cr04SWB.Load()) {
			t.Fatal("CR04 authentic paced Range, cancellation, exit or SW release B missing")
		}
		if cr04Mode {
			var revoked meta.Node
			if err := db.Unscoped().Where("owner_id = ? AND id = ?", owner.ID, cr04Node.Load()).First(&revoked).Error; err != nil {
				t.Fatal("CR04 real revoked Owner Node missing from durable PostgreSQL")
			}
			if revoked.DeletedAt == nil {
				t.Fatal("CR04 in-flight Go response never overlapped a genuine SQL soft deletion")
			}
			request(t, router, http.MethodGet,
				fmt.Sprintf("/api/v1/nodes/%d", cr04Node.Load()), ownerToken, nil, http.StatusNotFound)
		}
		if cancelDurableMode && (!cr01b4Probe.started.Load() ||
			!cr01b4Probe.cancelled.Load() || !cr01b4Probe.handlerExited.Load()) {
			t.Fatal("CR01b4 real Go read Context cancellation and handler exit not established")
		}
		if nativeDownloadMode {
			pwaS4C3VerifyPhysicalCAS(t, db, local, nativeSeed)
			if nativeCancelMode {
				pwaS4C3VerifyNativeCancelRetry(t, db, owner.ID, nativeSeed.size)
			}
		}
		if resumeMode {
			// The first 8 MiB must remain in the original Server session. The
			// reselected original must reuse it, not upload that chunk twice.
			expectedSessions := int64(2)
			expectedChunk0 := int64(1)
			expectedChunk2 := int64(1)
			expectedAcceptedChunk1 := int64(1)
			if folderResumeMode {
				expectedSessions = 3
				expectedChunk0 = 2
				expectedChunk2 = 2
				expectedAcceptedChunk1 = 2
			}
			if uploadSessions.Load() != expectedSessions || chunk0Requests.Load() != expectedChunk0 ||
				chunk1Requests.Load() < expectedAcceptedChunk1+1 || chunk2Requests.Load() != expectedChunk2 ||
				injectedNetworkDrops.Load() != chunk1Requests.Load()-expectedAcceptedChunk1 {
				t.Fatalf("S4B2 HTTP resume was not reused: sessions=%d chunk0=%d chunk1=%d chunk2=%d injectedDrops=%d",
					uploadSessions.Load(), chunk0Requests.Load(), chunk1Requests.Load(),
					chunk2Requests.Load(), injectedNetworkDrops.Load())
			}
			if largeResumeMode && (lastChunkRequests.Load() != 1 ||
				totalChunkRequests.Load() < resumeExpectedChunks+injectedNetworkDrops.Load()) {
				t.Fatal("S4B2 1GiB last chunk or distinct chunk PUT coverage missing")
			}
			expectedParentID := folder.ID
			if folderResumeMode {
				// Server-side postflight reads full actual CAS for every committed
				// file, independent of OS folder enumeration order.
				var album, nested meta.Node
				if err := db.Where("owner_id = ? AND parent_id = ? AND name = ? AND deleted_at IS NULL",
					owner.ID, folder.ID, "pwa-b3b-album").First(&album).Error; err != nil {
					t.Fatalf("B3B album target folder missing: %v", err)
				}
				if err := db.Where("owner_id = ? AND parent_id = ? AND name = ? AND deleted_at IS NULL",
					owner.ID, album.ID, "nested").First(&nested).Error; err != nil {
					t.Fatalf("B3B nested directory missing: %v", err)
				}
				request(t, router, http.MethodGet,
					fmt.Sprintf("/api/v1/nodes/%d", album.ID), foreignToken, nil, http.StatusNotFound)
				type folderCandidate struct {
					name   string
					nested bool
					seed   int64
				}
				candidates := []folderCandidate{
					{name: "00-root-a.bin", seed: 1},
					{name: "10-root-b.mov", seed: 2},
					{name: "20-nested-c.bin", nested: true, seed: 3},
				}
				committedCount, missingCount := 0, 0
				for _, spec := range candidates {
					parentID := album.ID
					if spec.nested {
						parentID = nested.ID
					}
					var present int64
					if err := db.Model(&meta.Node{}).
						Where("owner_id = ? AND parent_id = ? AND name = ? AND deleted_at IS NULL",
							owner.ID, parentID, spec.name).Count(&present).Error; err != nil {
						t.Fatal(err)
					}
					if present == 0 {
						missingCount++
						continue
					}
					if present != 1 {
						t.Fatal("B3B committed child identity not unique")
					}
					committedCount++
					var node meta.Node
					if err := db.Where("owner_id = ? AND parent_id = ? AND name = ? AND deleted_at IS NULL",
						owner.ID, parentID, spec.name).First(&node).Error; err != nil {
						t.Fatal(err)
					}
					request(t, router, http.MethodGet,
						fmt.Sprintf("/api/v1/nodes/%d", node.ID), foreignToken, nil, http.StatusNotFound)
					var file meta.File
					if err := db.Where("node_id = ?", node.ID).First(&file).Error; err != nil {
						t.Fatal(err)
					}
					if file.Size != resumeExpectedBytes {
						t.Fatal("B3B committed child size mismatch")
					}
					wanted := sha256.New()
					buffer := make([]byte, 64<<10)
					for offset := int64(0); offset < resumeExpectedBytes; offset += int64(len(buffer)) {
						for index := range buffer {
							n := offset + int64(index)
							buffer[index] = byte((n*31 + (n >> 7) + spec.seed*13) % 251)
						}
						_, _ = wanted.Write(buffer)
					}
					expectedHash := fmt.Sprintf("%x", wanted.Sum(nil))
					if file.SHA256 != expectedHash {
						t.Fatal("B3B committed child independent SHA256 mismatch")
					}
					var blob meta.ContentBlob
					if err := db.Where("sha256 = ?", file.SHA256).First(&blob).Error; err != nil {
						t.Fatal(err)
					}
					key, keyErr := storage.ContentAddressedKey(expectedHash)
					if keyErr != nil || key != file.StorageKey || key != blob.StorageKey ||
						blob.RefCount < 1 || blob.State != meta.ContentBlobStateReady ||
						blob.Size != resumeExpectedBytes {
						t.Fatal("B3B committed child physical CAS reference mismatch")
					}
					object, openErr := local.Open(context.Background(), key)
					if openErr != nil {
						t.Fatal(openErr)
					}
					actual := sha256.New()
					copied, copyErr := io.Copy(actual, object)
					closeErr := object.Close()
					if copyErr != nil || closeErr != nil || copied != resumeExpectedBytes ||
						fmt.Sprintf("%x", actual.Sum(nil)) != expectedHash {
						t.Fatal("B3B committed child physical CAS bytes mismatch")
					}
				}
				if committedCount != 2 || missingCount != 1 {
					t.Fatal("B3B expected exactly two physical CAS child files and one cancelled sibling")
				}
				t.Log("PWA_S4B3_AUTHENTIC_FOLDER_VERIFIED actualFileListOrderIndependent=true twoPhysicalCAS_SHA256=true cancelledSiblingAbsent=true")
				return
			}
			var resumed meta.Node
			if err := db.Where("owner_id = ? AND parent_id = ? AND name = ? AND deleted_at IS NULL",
				owner.ID, expectedParentID, resumeFileName).First(&resumed).Error; err != nil {
				t.Fatalf("S4B2 final original file missing: %v", err)
			}
			var file meta.File
			if err := db.Where("node_id = ?", resumed.ID).First(&file).Error; err != nil {
				t.Fatal(err)
			}
			const expectedBytes = int64(17 << 20)
			verifiedBytes := expectedBytes
			if largeResumeMode {
				verifiedBytes = resumeExpectedBytes
			}
			if file.Size != verifiedBytes {
				t.Fatalf("S4B2 finalized file size=%d expected=%d", file.Size, verifiedBytes)
			}
			var blob meta.ContentBlob
			if err := db.Where("sha256 = ?", file.SHA256).First(&blob).Error; err != nil {
				t.Fatal(err)
			}
			key, err := storage.ContentAddressedKey(file.SHA256)
			if err != nil || key != blob.StorageKey || blob.RefCount < 1 ||
				blob.State != meta.ContentBlobStateReady || blob.Size != verifiedBytes {
				t.Fatalf("S4B2 CAS identity or reference invalid")
			}
			object, err := local.Open(context.Background(), key)
			if err != nil {
				t.Fatal(err)
			}
			actual := sha256.New()
			copied, copyErr := io.Copy(actual, object)
			closeErr := object.Close()
			if copyErr != nil || closeErr != nil || copied != verifiedBytes {
				t.Fatalf("S4B2 physical CAS readback invalid: bytes=%d copyErr=%v closeErr=%v",
					copied, copyErr, closeErr)
			}
			wanted := sha256.New()
			buffer := make([]byte, 64<<10)
			for start := int64(0); start < verifiedBytes; start += int64(len(buffer)) {
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
				verifiedBytes, uploadSessions.Load(), injectedNetworkDrops.Load())
			if folderResumeMode {
				t.Log("PWA_S4B3_AUTHENTIC_FOLDER_VERIFIED completedChildCAS=true recoveredChildCAS=true unstartedSiblingAbsent=true")
			}
		}

	case <-time.After(func() time.Duration {
		if nativeDownloadMode {
			return 24 * time.Minute
		}
		if largeResumeMode {
			return 15 * time.Minute
		}
		return 5 * time.Minute
	}()):
		t.Fatal("real Chrome browser did not finish the isolated Gin fixture")
	}
}
