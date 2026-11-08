//go:build linux

package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"github.com/lazyxu/xdrive/internal/version"
)

// Opt-in real production Web App and real Gin Owner/Cells HTTP test fixture.
// The signed image and all BD09 metadata are synthetic. No provider requests,
// production server, user photo, live account or private credentials are used.
func TestDesktopPlacesProductionWebRestartFixture(t *testing.T) {
	if os.Getenv("XD_DESKTOP_PLACES_PRODUCTION_E2E") != "1" {
		t.Skip("dedicated production Desktop Main + real Web/Gin/Postgres/Agent test only")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	dist := os.Getenv("XD_DESKTOP_PLACES_WEB_DIST")
	ready := os.Getenv("XD_DESKTOP_PLACES_READY_FILE")
	stop := os.Getenv("XD_DESKTOP_PLACES_STOP_FILE")
	certPath := os.Getenv("XD_DESKTOP_PLACES_CERT_FILE")
	keyPath := os.Getenv("XD_DESKTOP_PLACES_KEY_FILE")
	ip := os.Getenv("XD_DESKTOP_PLACES_IP")
	if dsn == "" || dist == "" || ready == "" || stop == "" ||
		certPath == "" || keyPath == "" || ip != "10.233.15.19" {
		t.Fatal("exact isolated production Web/Gin/PostgreSQL/HTTPS fixture required")
	}
	if _, err := os.Stat(filepath.Join(dist, "index.html")); err != nil {
		t.Fatal("actual Vite Web production build absent")
	}
	leaf, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		t.Fatal(err)
	}
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.DesktopMapGuestGrant{},
		&meta.BaiduJSAPIMapEpoch{}, &meta.AuditEvent{},
		&meta.AdminServiceSecret{}, &meta.InternalServiceKeyAnchor{},
		&meta.BaiduMapScopeHandoff{}, &meta.PhotoCollection{},
		&meta.Node{}, &meta.File{}, &meta.FileVersion{}, &meta.ContentBlob{},
		&meta.MediaMetadata{}, &meta.MediaDerivedResource{},
		&meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.Source{}, &meta.SourceItem{}, &meta.SourceCollection{}, &meta.SourceCollectionItem{},
		&meta.PhotoAsset{}, &meta.PhotoAssetOccurrence{}, &meta.PhotoAssetIdentityAlias{},
		&meta.PhotoEditRecipe{}, &meta.PhotoResource{}, &meta.PhotoMetadata{},
		&meta.PhotoCollectionAsset{}, &meta.PhotoAnalysisState{}, &meta.PhotoOCRText{},
		&meta.BaiduPhotoMapConsent{}, &meta.BaiduPhotoMapPosition{},
		&meta.LocalPushQuotaHold{}, &meta.NodeChange{}, &meta.BackgroundOwnerCancellation{},
		// The authentic production Renderer concurrently mounts file-operation,
		// people, album, and location-label surfaces before the Places guest.
		// Missing tables are a broken *test schema*, not failed map admission.
		&meta.FileOperation{}, &meta.FileRecentAccess{}, &meta.FileRecentFolderAccess{},
		&meta.FileFavorite{}, &meta.FileQuickAccess{}, &meta.FileSavedSearch{},
		&meta.FileTag{}, &meta.FileNodeTag{}, &meta.UploadSession{}, &meta.UploadPart{},
		&meta.SyncRun{}, &meta.ArchivePrepareRun{}, &meta.PhotoIntelligenceReanalyzeIntent{},
		&meta.PhotoFace{}, &meta.PhotoPersonCluster{}, &meta.PhotoPersonClusterFace{},
		&meta.PhotoPersonClusterState{}, &meta.PhotoPerson{}, &meta.PhotoPersonAsset{},
		&meta.PhotoPersonSuggestionReview{}, &meta.PhotoPlaceLabel{},
		&meta.PhotoVisualLabel{}, &meta.PhotoSemanticEmbedding{},
		&meta.PhotoAlbumFolder{}, &meta.PhotoCreativeGeneration{},
		&meta.MediaSelectionJob{}, &meta.MediaSelectionJobItem{},
		&meta.ViewerQualityPreference{}, &meta.AdminViewerQualitySetting{},
		&meta.NotesNamespace{}, &meta.Note{},
	); err != nil {
		t.Fatal(err)
	}
	for _, who := range []struct{ name, password string }{
		{"production-map-owner", "OnlySyntheticAgent-2026!"},
		{"production-map-foreign", "OnlySyntheticForeign-2026!"},
	} {
		hash, err := auth.HashPassword(who.password)
		if err != nil {
			t.Fatal(err)
		}
		user := meta.User{Username: who.name, PasswordHash: hash,
			Role: meta.UserRoleUser, SessionVersion: 1}
		if err := db.Create(&user).Error; err != nil {
			t.Fatal(err)
		}
	}
	var owner, foreign meta.User
	if err := db.Where("username = ?", "production-map-owner").Take(&owner).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("username = ?", "production-map-foreign").Take(&foreign).Error; err != nil {
		t.Fatal(err)
	}
	// These synthetic test users bypass normal map-session initialization.
	// The real /cells route MUST still reject a missing/revoked map epoch.
	// Match the existing PostgreSQL Owner-map fixture by provisioning a
	// revocable nonzero epoch for each isolated test account, never in prod.
	for _, person := range []meta.User{owner, foreign} {
		epoch, initErr := ensureBaiduMapEpochTx(context.Background(), db, person.ID)
		if initErr != nil || epoch.OwnerID != person.ID || epoch.Epoch == 0 {
			t.Fatalf("synthetic Owner map epoch initialization failed: %v", initErr)
		}
	}
	original := image.NewRGBA(image.Rect(0, 0, 2, 2))
	original.Set(0, 0, color.RGBA{R: 11, G: 68, B: 176, A: 255})
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, original); err != nil {
		t.Fatal(err)
	}
	hash := fmt.Sprintf("%x", sha256.Sum256(encoded.Bytes()))
	key, err := storage.ContentAddressedKey(hash)
	if err != nil {
		t.Fatal(err)
	}
	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if written, err := local.Put(context.Background(), key, bytes.NewReader(encoded.Bytes())); err != nil ||
		written != int64(encoded.Len()) {
		t.Fatal("physical CAS media seed failed")
	}
	if err := db.Create(&meta.ContentBlob{
		SHA256: hash, StorageKey: key, Size: int64(encoded.Len()),
		RefCount: 10, State: meta.ContentBlobStateReady,
	}).Error; err != nil {
		t.Fatal(err)
	}
	// Use exactly the established P0-17 production PostgreSQL/BD09 source
	// shape: 9 Owner GPS photos, 3 favorites, plus 1 foreign Owner neighbor.
	seedP04BrowserOwnerPhotoCells(t, db, owner.ID, "production", 9, 3,
		key, hash, int64(encoded.Len()))
	seedP04BrowserOwnerPhotoCells(t, db, foreign.ID, "foreign", 1, 0,
		key, hash, int64(encoded.Len()))
	family := meta.PhotoCollection{OwnerID: owner.ID, ExternalKey: "manual:Family",
		Kind: meta.PhotoCollectionKindManual, Name: "Family",
		State: meta.PhotoCollectionStateActive, Revision: 7}
	if err := db.Create(&family).Error; err != nil {
		t.Fatal(err)
	}
	var assets []meta.PhotoAsset
	if err := db.Where("owner_id = ?", owner.ID).Order("id ASC").Find(&assets).Error; err != nil ||
		len(assets) != 9 {
		t.Fatal("Owner's nine map assets did not seed")
	}
	for i, idx := range []int{0, 1, 3} {
		if err := db.Create(&meta.PhotoCollectionAsset{
			CollectionID: family.ID, AssetID: assets[idx].ID, Position: int64(i),
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
	// Seed genuinely decodable, cache-contract-valid synthetic JPEG bytes
	// for every Owner photo. This makes protected Thumbnail and Viewer
	// endpoints test actual binary delivery rather than an unbuilt worker.
	var derivative bytes.Buffer
	if err := jpeg.Encode(&derivative, original, &jpeg.Options{Quality: 87}); err != nil {
		t.Fatal(err)
	}
	variant, err := mediapkg.ViewerQualityVariantFor(mediapkg.ViewerQualityHigh, "jpeg")
	if err != nil {
		t.Fatal(err)
	}
	for _, asset := range assets {
		var node meta.Node
		if err := db.Preload("File").First(&node, asset.PrimaryNodeID).Error; err != nil ||
			node.File == nil {
			t.Fatal("synthetic Owner media node missing for derivative")
		}
		var metadata meta.MediaMetadata
		if err := db.Where("node_id = ?", node.ID).Take(&metadata).Error; err != nil {
			t.Fatal("synthetic media metadata missing for derivative")
		}
		thumbKey := mediaThumbnailStorageKey(node, metadata)
		viewerKey, err := mediapkg.ViewerQualityStorageKey(
			node.ID, node.Revision, metadata.SHA256, variant)
		if err != nil {
			t.Fatal(err)
		}
		for _, cacheKey := range []string{thumbKey, viewerKey} {
			if written, putErr := local.Put(context.Background(),
				cacheKey, bytes.NewReader(derivative.Bytes())); putErr != nil ||
				written != int64(derivative.Len()) {
				t.Fatal("synthetic thumbnail/viewer JPEG bytes were not cached")
			}
		}
	}
	// Reserve the exact test HTTPS origin BEFORE signing the managed map
	// release. The signed scope binds this host:port and must match the
	// socket actually served by Gin below, not an unconfigured origin.
	listener, err := net.Listen("tcp", net.JoinHostPort(ip, "0"))
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	server := &Server{DB: db, Store: local,
		Auth:       auth.New("production-map-test-only-no-real-user", 15*time.Minute),
		RefreshTTL: time.Hour,
	}
	// Pin the current 9-photo contract at each real Server query layer,
	// before Electron and the browser JWT path run. A valid 8x8 response
	// contains one bin for these synthetic colocated photos but its
	// TotalCount must be NINE, not a count of grid cells.
	ctxCheck, cancelCheck := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancelCheck()
	boundsCheck := baiduPhotoMapBounds{
		West: 100, South: 20, East: 125, North: 40,
		CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL,
	}
	rawCheck, rawErr := queryBaiduPhotoMapCells(ctxCheck, db, owner.ID, boundsCheck)
	if rawErr != nil {
		t.Fatalf("production map fixture raw owner positions unavailable: %v", rawErr)
	}
	galleryOptions := mediaQueryOptions{SortBy: "captured", SortDir: "desc"}
	galleryCheck, galleryErr := server.mediaItemsBaseQuery(
		ctxCheck, owner.ID, galleryOptions, "")
	if galleryErr != nil {
		t.Fatalf("production map fixture Gallery membership unavailable: %v", galleryErr)
	}
	var memberCount int64
	if err := galleryCheck.Session(&gorm.Session{}).
		Distinct("xd_media_metadata.node_id").Count(&memberCount).Error; err != nil {
		t.Fatalf("production map fixture Gallery member count unavailable: %v", err)
	}
	scopedCheck, scopedErr := queryBaiduPhotoMapCellsScoped(
		ctxCheck, db, owner.ID, boundsCheck,
		galleryCheck.Session(&gorm.Session{}).Select("n.id"), galleryOptions)
	if scopedErr != nil {
		t.Fatalf("production map fixture scoped Owner cells unavailable: %v", scopedErr)
	}
	if rawCheck.TotalCount != 9 || memberCount != 9 ||
		scopedCheck.TotalCount != 9 {
		t.Fatalf("production map fixture lost synthetic members: raw=%d Gallery=%d scoped=%d expected=9",
			rawCheck.TotalCount, memberCount, scopedCheck.TotalCount)
	}
	server.AllowedOrigin = "https://" + listener.Addr().String()
	// The real Owner /cells and signed Web map routes require a managed
	// release. Create only synthetic test keys here; no provider AK, live
	// Baidu API, production user account or external network is used.
	keys, err := connectorsecret.NewKeyring(1, map[uint32]string{
		1: strings.Repeat("de", 32),
	})
	if err != nil {
		t.Fatal(err)
	}
	server.ConnectorSecrets = keys
	keyVersion, encryptedAK, err := keys.Seal(
		baiduJSAPISecretAADID, baiduJSAPISecretKind,
		[]byte("SYNTHETIC_PRODUCTION_MAP_E2E_AK_NO_PROVIDER"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.AdminServiceSecret{
		Name: baiduJSAPISecretName, Enabled: true, Revision: 1,
		KeyVersion: keyVersion, Ciphertext: encryptedAK,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := server.EnsureBaiduJSAPI4InternalKeys(context.Background()); err != nil {
		t.Fatal(err)
	}
	priorCommit := version.Commit
	version.Commit = strings.Repeat("d", 40)
	defer func() { version.Commit = priorCommit }()
	if err := server.RefreshBaiduJSAPI4ManagedRelease(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer server.ClearBaiduJSAPI4OperatorRelease()
	gin.SetMode(gin.TestMode)
	router := server.Router()
	frontend := http.FileServer(http.Dir(dist))
	legacyMarker := os.Getenv("XD_DESKTOP_PLACES_LEGACY_MARKER")
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			// Test-only old Server capability: no Desktop map grant endpoint,
			// while ordinary Owner APIs and native Agent login remain real.
			if legacyMarker != "" && r.Method == http.MethodPost &&
				r.URL.Path == "/api/v1/auth/desktop-map/issue" {
				if _, err := os.Stat(legacyMarker); err == nil {
					http.NotFound(w, r)
					return
				}
			}
			router.ServeHTTP(w, r)
			return
		}
		// Production Vite static files and actual Web JS. No replaced login,
		// SDK, file list, Gallery DOM, Owner API or fake /cells responses.
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		frontend.ServeHTTP(w, r)
	})
	tlsServer := httptest.NewUnstartedServer(handler)
	_ = tlsServer.Listener.Close()
	tlsServer.Listener = listener
	tlsServer.TLS = &tls.Config{Certificates: []tls.Certificate{leaf}, MinVersion: tls.VersionTLS12}
	tlsServer.StartTLS()
	defer tlsServer.Close()
	if !strings.HasPrefix(tlsServer.URL, "https://"+ip+":") ||
		tlsServer.URL != server.AllowedOrigin {
		t.Fatal("signed map origin does not match dedicated RFC1918 HTTPS socket")
	}
	// Readiness contains NO password, bearer token, Root CA or PhotoAsset ID.
	payload, err := json.Marshal(map[string]any{
		"url": tlsServer.URL, "owner": owner.Username, "family": "Family",
		"total_owner": 9, "favorites": 3, "family_favorites": 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(ready), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(ready, payload, 0600); err != nil {
		t.Fatal(err)
	}
	defer os.Remove(ready)
	// Multiple real WebView mode/Cookie/revocation phases run within one
	// test fixture; each phase also has its own shorter failure deadline.
	timer := time.NewTimer(18 * time.Minute)
	defer timer.Stop()
	ticker := time.NewTicker(150 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			if _, err := os.Stat(stop); err == nil {
				return
			}
		case <-timer.C:
			t.Fatal("production Desktop/Gin/PG/Web app never completed")
		}
	}
}
