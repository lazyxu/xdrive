//go:build linux

package api

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"github.com/lazyxu/xdrive/internal/version"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// This opt-in fixture exposes the REAL Gin Router on loopback while actual
// Chromium loads the trusted Gallery at a separate synthetic HTTPS Origin.
// The browser harness forwards same-origin /api requests unchanged. No
// production account, provider SDK, AK, JWT or physical photo is accessed.
func TestPlacesP04MountedBrowserRealGinFixture(t *testing.T) {
	if os.Getenv("XD_PLACES_P04_BROWSER_GIN") != "1" {
		t.Skip("only the dedicated non-production Chromium/PostgreSQL job uses this fixture")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	origin := os.Getenv("XD_PLACES_P04_GALLERY_ORIGIN")
	ready := os.Getenv("XD_PLACES_P04_READY_FILE")
	stop := os.Getenv("XD_PLACES_P04_STOP_FILE")
	// The parent runner intentionally discards private fixture stdout.
	// Export only a fixed nonsecret setup stage when a test fatals.
	stage := "initial-setup"
	stageFile := os.Getenv("XD_PLACES_P04_FAILURE_STAGE")
	t.Cleanup(func() {
		if t.Failed() && stageFile != "" {
			_ = os.WriteFile(stageFile, []byte(stage), 0600)
		}
	})
	if dsn == "" || ready == "" || stop == "" ||
		!strings.HasPrefix(origin, "https://gallery.example.net:") {
		t.Fatal("missing bounded Chromium/Gin fixture configuration")
	}
	o, err := url.Parse(origin)
	if err != nil || o.String() != origin || o.Port() == "" || o.Hostname() != "gallery.example.net" {
		t.Fatal("invalid local browser origin")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	rootPool, err := root.DB()
	if err != nil {
		t.Fatal(err)
	}
	rootPool.SetMaxOpenConns(2)
	defer rootPool.Close()
	schema := "p04_browser_gin_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
	dbURI, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := dbURI.Query()
	q.Set("search_path", schema)
	dbURI.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(dbURI.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	pool.SetMaxOpenConns(4)
	defer pool.Close()
	if err := db.AutoMigrate(
		&meta.User{}, &meta.AdminServiceSecret{}, &meta.InternalServiceKeyAnchor{},
		&meta.BaiduJSAPIMapEpoch{}, &meta.PhotoCollection{},
		&meta.BaiduMapScopeHandoff{},
		&meta.Node{}, &meta.File{}, &meta.FileVersion{},
		&meta.ContentBlob{}, &meta.MediaMetadata{}, &meta.MediaDerivedResource{},
		&meta.MediaGroup{}, &meta.MediaGroupItem{},
		// The real media-detail route reads Source collections to show
		// provenance even when this isolated Owner has no connected sources.
		// Mirror those empty production tables in this disposable fixture.
		&meta.Source{}, &meta.SourceItem{},
		&meta.SourceCollection{}, &meta.SourceCollectionItem{},
		&meta.PhotoAsset{}, &meta.PhotoEditRecipe{},
		&meta.PhotoResource{}, &meta.PhotoMetadata{}, &meta.PhotoCollectionAsset{},
		// GET /media/items/:id includes Owner-fenced OCR state, even when
		// this fixture has no analysis results. Real tables must exist so a
		// Live Photo detail cannot fail before the signed motion ticket.
		&meta.PhotoAnalysisState{}, &meta.PhotoOCRText{},
		&meta.BaiduPhotoMapConsent{}, &meta.BaiduPhotoMapPosition{},
	); err != nil {
		t.Fatal(err)
	}

	// The two SDK Hosts use the *actual* protected original preview pipeline:
	// ten independently owned Nodes share one tiny generated PNG in physical
	// local CAS. No real user image, outside Provider, or synthetic /api mock.
	picture := image.NewRGBA(image.Rect(0, 0, 2, 2))
	picture.Set(0, 0, color.RGBA{R: 25, G: 95, B: 175, A: 255})
	var pngData bytes.Buffer
	if err := png.Encode(&pngData, picture); err != nil {
		t.Fatal(err)
	}
	checksum := fmt.Sprintf("%x", sha256.Sum256(pngData.Bytes()))
	casKey, err := storage.ContentAddressedKey(checksum)
	if err != nil {
		t.Fatal(err)
	}
	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if written, err := local.Put(context.Background(), casKey, bytes.NewReader(pngData.Bytes())); err != nil || written != int64(pngData.Len()) {
		t.Fatal("failed to seed real local CAS original for map Viewer")
	}
	if err := db.Create(&meta.ContentBlob{
		SHA256: checksum, Size: int64(pngData.Len()), StorageKey: casKey,
		RefCount: 10, State: meta.ContentBlobStateReady,
	}).Error; err != nil {
		t.Fatal(err)
	}
	keyring, err := connectorsecret.NewKeyring(1,
		map[uint32]string{1: strings.Repeat("ee", 32)})
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		DB: db, Store: local, ConnectorSecrets: keyring,
		Auth:          auth.New("p04-mounted-chromium-gin-only", time.Hour),
		AllowedOrigin: origin,
	}
	owner := meta.User{Username: "browser-map-owner", PasswordHash: "synthetic",
		Role: meta.UserRoleUser, SessionVersion: 1}
	foreign := meta.User{Username: "browser-map-foreign", PasswordHash: "synthetic",
		Role: meta.UserRoleUser, SessionVersion: 1}
	heicOwner := meta.User{Username: "browser-map-heic", PasswordHash: "synthetic",
		Role: meta.UserRoleUser, SessionVersion: 1}
	liveOwner := meta.User{Username: "browser-map-livp", PasswordHash: "synthetic",
		Role: meta.UserRoleUser, SessionVersion: 1}
	for _, person := range []*meta.User{&owner, &foreign, &heicOwner, &liveOwner} {
		if err := db.Create(person).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.BaiduJSAPIMapEpoch{
			OwnerID: person.ID, Epoch: 3,
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Create(&meta.PhotoCollection{
		OwnerID: owner.ID, ExternalKey: "manual:Family",
		Kind: meta.PhotoCollectionKindManual, Name: "Family",
		State: meta.PhotoCollectionStateActive, Revision: 7,
	}).Error; err != nil {
		t.Fatal(err)
	}
	// The same signed Owner Cells used by the mounted Browser are now sourced
	// from real PostgreSQL. Only 3 of 9 photos are favorites; another Owner
	// has an overlapping BD09 location which must never enter this scope.
	seedP04BrowserOwnerPhotoCells(t, db, owner.ID, "owner", 9, 3, casKey, checksum, int64(pngData.Len()))
	seedP04BrowserOwnerPhotoCells(t, db, foreign.ID, "foreign", 1, 0, casKey, checksum, int64(pngData.Len()))
	// Keep the existing 9 total/3 favorites fixture unchanged. A real manual
	// Family album contains 2 favorites plus a non-favorite: the combined
	// Album+Favorites map is exactly 2 and cannot silently widen to 3 or 9.
	var family meta.PhotoCollection
	if err := db.Where("owner_id = ? AND external_key = ?", owner.ID, "manual:Family").
		Take(&family).Error; err != nil {
		t.Fatal(err)
	}
	var familyCandidateAssets []meta.PhotoAsset
	if err := db.Where("owner_id = ?", owner.ID).Order("id ASC").
		Find(&familyCandidateAssets).Error; err != nil || len(familyCandidateAssets) != 9 {
		t.Fatal("missing original 9 real Owner assets for scoped Family fixture")
	}
	for ordinal, assetIndex := range []int{0, 1, 3} {
		if err := db.Create(&meta.PhotoCollectionAsset{
			CollectionID: family.ID, AssetID: familyCandidateAssets[assetIndex].ID,
			Position: int64(ordinal),
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
	// Dedicated test-only HEIC Owner: the original 9+1 asset map and every
	// pre-existing Viewer/Count assertion remain source-exact unchanged.
	// The real HEVC-coded sample is decoded by the existing media package,
	// cached under its production revision/MIME-fenced thumbnail identity,
	// and later served only by Gin's authenticated /media/items/:id/thumbnail.
	stage = "heic-seed"
	seedP04BrowserOwnerPhotoCells(t, db, heicOwner.ID, "heic", 1, 0,
		casKey, checksum, int64(pngData.Len()))
	stage = "heic-file"
	heicOriginal, err := os.ReadFile(filepath.Join("internal", "media", "testdata", "heic-8bit-512.heic"))
	if err != nil {
		t.Fatal(err)
	}
	stage = "heic-extract"
	heicInfo, err := mediapkg.Extract("p04-heic-01.HEIC",
		bytes.NewReader(heicOriginal), int64(len(heicOriginal)))
	if err != nil || (heicInfo.MIMEType != "image/heic" &&
		heicInfo.MIMEType != "image/heif") || heicInfo.Width != 512 || heicInfo.Height != 512 {
		t.Fatalf("real HEVC-coded HEIC fixture cannot be indexed: %v", err)
	}
	stage = "heic-decode"
	heicThumb, err := mediapkg.ThumbnailWithAlpha(bytes.NewReader(heicOriginal),
		heicInfo.Orientation, mediaThumbnailEdge)
	if err != nil || heicThumb.SourceKind != "heic" ||
		heicThumb.MIMEType != "image/jpeg" || len(heicThumb.Data) < 512 {
		t.Fatalf("real HEIC did not produce the existing JPEG thumbnail: %v", err)
	}
	stage = "heic-storage"
	heicChecksum := fmt.Sprintf("%x", sha256.Sum256(heicOriginal))
	heicKey, err := storage.ContentAddressedKey(heicChecksum)
	if err != nil {
		t.Fatal(err)
	}
	if written, err := local.Put(context.Background(), heicKey,
		bytes.NewReader(heicOriginal)); err != nil || written != int64(len(heicOriginal)) {
		t.Fatal("failed to seed HEIC original in real test CAS")
	}
	if err := db.Create(&meta.ContentBlob{
		SHA256: heicChecksum, Size: int64(len(heicOriginal)),
		StorageKey: heicKey, RefCount: 1, State: meta.ContentBlobStateReady,
	}).Error; err != nil {
		t.Fatal(err)
	}
	stage = "heic-node"
	var heicNode meta.Node
	if err := db.Where("owner_id = ? AND name = ?",
		heicOwner.ID, "p04-heic-01.png").Take(&heicNode).Error; err != nil {
		t.Fatal(err)
	}
	var heicAsset meta.PhotoAsset
	if err := db.Where("owner_id = ? AND primary_node_id = ?",
		heicOwner.ID, heicNode.ID).Take(&heicAsset).Error; err != nil {
		t.Fatal(err)
	}
	stage = "heic-metadata"
	if err := db.Model(&meta.Node{}).Where("id = ?", heicNode.ID).
		Update("name", "p04-heic-01.HEIC").Error; err != nil {
		t.Fatal(err)
	}
	heicFile := map[string]any{
		"size":        int64(len(heicOriginal)),
		"storage_key": heicKey, "sha256": heicChecksum,
	}
	for _, model := range []any{&meta.File{}, &meta.FileVersion{}} {
		if err := db.Model(model).Where("node_id = ?", heicNode.ID).
			Updates(heicFile).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Model(&meta.MediaMetadata{}).Where("node_id = ?", heicNode.ID).
		Updates(map[string]any{
			"sha256": heicChecksum, "mime_type": heicInfo.MIMEType,
			"media_kind":  meta.MediaKindImage,
			"orientation": heicInfo.Orientation,
		}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.PhotoMetadata{}).Where("asset_id = ?", heicAsset.ID).
		Update("mime_type", heicInfo.MIMEType).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.PhotoResource{}).Where("node_id = ?", heicNode.ID).
		Updates(map[string]any{
			"name": "p04-heic-01.HEIC", "mime_type": heicInfo.MIMEType,
			"size": int64(len(heicOriginal)), "sha256": heicChecksum,
		}).Error; err != nil {
		t.Fatal(err)
	}
	stage = "heic-thumbnail-cache"
	var heicMetadata meta.MediaMetadata
	if err := db.Where("node_id = ?", heicNode.ID).Take(&heicMetadata).Error; err != nil {
		t.Fatal(err)
	}
	thumbKey := mediaThumbnailStorageKey(heicNode, heicMetadata)
	if written, err := local.Put(context.Background(), thumbKey,
		bytes.NewReader(heicThumb.Data)); err != nil || written != int64(len(heicThumb.Data)) {
		t.Fatal("failed to cache the actual decoded HEIC JPEG thumbnail")
	}
	if err := db.Model(&meta.MediaMetadata{}).Where("node_id = ?", heicNode.ID).
		Updates(map[string]any{
			"thumbnail_key": thumbKey, "thumbnail_mime_type": "image/jpeg",
			"thumbnail_width": heicThumb.Width, "thumbnail_height": heicThumb.Height,
		}).Error; err != nil {
		t.Fatal(err)
	}
	// A source replacement must not leave the signed map Cell on the prior
	// PNG SHA/timestamp. Keep the original built-in source revision fences.
	if err := db.Where("node_id = ?", heicNode.ID).Take(&heicMetadata).Error; err != nil {
		t.Fatal(err)
	}
	stage = "heic-position"
	if err := db.Model(&meta.BaiduPhotoMapPosition{}).
		Where("asset_id = ?", heicAsset.ID).
		Update("media_updated_at", heicMetadata.UpdatedAt).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.BaiduPhotoMapConsent{}).
		Where("asset_id = ?", heicAsset.ID).
		Update("source_media_updated_at", heicMetadata.UpdatedAt).Error; err != nil {
		t.Fatal(err)
	}
	stage = "heic-ready"

	// Isolate real LIVP still/motion integration from the existing Owner and
	// standalone HEIC Owner. Reuse the exact tested HEVC still, packaged with
	// the pre-existing generated QuickTime motion in an actual store-only LIVP.
	stage = "livp-seed"
	seedP04BrowserOwnerPhotoCells(t, db, liveOwner.ID, "livp", 1, 0,
		casKey, checksum, int64(pngData.Len()))
	var liveArchive bytes.Buffer
	liveZIP := zip.NewWriter(&liveArchive)
	liveMotion := testLIVPMOV("P04-HEIC-LIVP-TEST-ID")
	for _, entry := range []struct {
		name string
		data []byte
	}{
		{"IMG_HEIC_512.HEIC", heicOriginal},
		{"IMG_HEIC_512.MOV", liveMotion},
	} {
		writer, err := liveZIP.CreateHeader(&zip.FileHeader{
			Name: entry.name, Method: zip.Store,
		})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := writer.Write(entry.data); err != nil {
			t.Fatal(err)
		}
	}
	if err := liveZIP.Close(); err != nil {
		t.Fatal(err)
	}
	liveBytes := liveArchive.Bytes()
	stage = "livp-inspect"
	liveInfo, err := mediapkg.Extract("p04-livp-01.livp",
		bytes.NewReader(liveBytes), int64(len(liveBytes)))
	if err != nil || liveInfo.ContainerKind != mediapkg.ContainerKindLIVP ||
		liveInfo.MIMEType != mediapkg.LIVPMIMEType ||
		liveInfo.Width != 512 || liveInfo.Height != 512 {
		t.Fatalf("real HEIC still was not indexed as a bounded LIVP archive: %v", err)
	}
	liveDescriptor, err := mediapkg.ParseLIVPContainerDescriptor(liveInfo.ContainerJSON)
	if err != nil || liveDescriptor.Still.MIMEType != heicInfo.MIMEType ||
		liveDescriptor.Motion.MIMEType != "video/quicktime" ||
		liveDescriptor.Still.Size != int64(len(heicOriginal)) ||
		liveDescriptor.Motion.Size != int64(len(liveMotion)) {
		t.Fatalf("HEIC LIVP still/motion descriptor cannot be verified: %v", err)
	}
	for _, entry := range []struct {
		offset int64
		size   int64
		data   []byte
	}{
		{liveDescriptor.Still.Offset, liveDescriptor.Still.Size, heicOriginal},
		{liveDescriptor.Motion.Offset, liveDescriptor.Motion.Size, liveMotion},
	} {
		if entry.offset < 0 || entry.size <= 0 ||
			entry.offset > int64(len(liveBytes)) ||
			entry.size > int64(len(liveBytes))-entry.offset ||
			!bytes.Equal(liveBytes[entry.offset:entry.offset+entry.size], entry.data) {
			t.Fatal("LIVP container offsets do not select exact HEIC still and MOV bytes")
		}
	}
	stage = "livp-cas"
	liveChecksum := fmt.Sprintf("%x", sha256.Sum256(liveBytes))
	liveKey, err := storage.ContentAddressedKey(liveChecksum)
	if err != nil {
		t.Fatal(err)
	}
	if written, err := local.Put(context.Background(), liveKey,
		bytes.NewReader(liveBytes)); err != nil || written != int64(len(liveBytes)) {
		t.Fatal("failed to seed LIVP archive CAS original")
	}
	if err := db.Create(&meta.ContentBlob{
		SHA256: liveChecksum, Size: int64(len(liveBytes)),
		StorageKey: liveKey, RefCount: 1, State: meta.ContentBlobStateReady,
	}).Error; err != nil {
		t.Fatal(err)
	}
	stage = "livp-metadata"
	var liveNode meta.Node
	if err := db.Where("owner_id = ? AND name = ?",
		liveOwner.ID, "p04-livp-01.png").Take(&liveNode).Error; err != nil {
		t.Fatal(err)
	}
	var liveAsset meta.PhotoAsset
	if err := db.Where("owner_id = ? AND primary_node_id = ?",
		liveOwner.ID, liveNode.ID).Take(&liveAsset).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.Node{}).Where("id = ?", liveNode.ID).
		Update("name", "p04-livp-01.livp").Error; err != nil {
		t.Fatal(err)
	}
	liveFile := map[string]any{
		"size":        int64(len(liveBytes)),
		"storage_key": liveKey, "sha256": liveChecksum,
	}
	for _, model := range []any{&meta.File{}, &meta.FileVersion{}} {
		if err := db.Model(model).Where("node_id = ?", liveNode.ID).
			Updates(liveFile).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Model(&meta.MediaMetadata{}).Where("node_id = ?", liveNode.ID).
		Updates(map[string]any{
			"sha256": liveChecksum, "mime_type": mediapkg.LIVPMIMEType,
			"media_kind":                  meta.MediaKindImage,
			"container_kind":              mediapkg.ContainerKindLIVP,
			"container_json":              liveInfo.ContainerJSON,
			"orientation":                 liveInfo.Orientation,
			"live_photo_asset_identifier": liveInfo.LivePhotoAssetIdentifier,
			"derived_resource_version":    mediapkg.LIVPDerivedResourceVersion,
		}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.PhotoAsset{}).Where("id = ?", liveAsset.ID).
		Update("kind", meta.PhotoAssetKindLivePhoto).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.PhotoMetadata{}).Where("asset_id = ?", liveAsset.ID).
		Updates(map[string]any{
			"mime_type": mediapkg.LIVPMIMEType,
			"width":     liveInfo.Width, "height": liveInfo.Height,
		}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.PhotoResource{}).Where("node_id = ?", liveNode.ID).
		Updates(map[string]any{
			"name": "p04-livp-01.livp", "mime_type": mediapkg.LIVPMIMEType,
			"size": int64(len(liveBytes)), "sha256": liveChecksum,
		}).Error; err != nil {
		t.Fatal(err)
	}
	stage = "livp-thumbnail"
	var liveMetadata meta.MediaMetadata
	if err := db.Where("node_id = ?", liveNode.ID).Take(&liveMetadata).Error; err != nil {
		t.Fatal(err)
	}
	if got := mediaThumbnailSourceMIME(liveMetadata); got != heicInfo.MIMEType ||
		mediaThumbnailVersion(liveMetadata) != mediapkg.ThumbnailAlphaVersion ||
		liveMetadata.DerivedResourceVersion != mediapkg.LIVPDerivedResourceVersion {
		t.Fatal("LIVP cache did not resolve the embedded HEIC still as a v4 image")
	}
	liveThumbKey := mediaThumbnailStorageKey(liveNode, liveMetadata)
	if written, err := local.Put(context.Background(), liveThumbKey,
		bytes.NewReader(heicThumb.Data)); err != nil || written != int64(len(heicThumb.Data)) {
		t.Fatal("failed to cache the verified HEIC LIVP still JPEG")
	}
	if err := db.Model(&meta.MediaMetadata{}).Where("node_id = ?", liveNode.ID).
		Updates(map[string]any{
			"thumbnail_key": liveThumbKey, "thumbnail_mime_type": "image/jpeg",
			"thumbnail_width": heicThumb.Width, "thumbnail_height": heicThumb.Height,
		}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("node_id = ?", liveNode.ID).Take(&liveMetadata).Error; err != nil {
		t.Fatal(err)
	}
	stage = "livp-position"
	if err := db.Model(&meta.BaiduPhotoMapPosition{}).
		Where("asset_id = ?", liveAsset.ID).
		Update("media_updated_at", liveMetadata.UpdatedAt).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.BaiduPhotoMapConsent{}).
		Where("asset_id = ?", liveAsset.ID).
		Update("source_media_updated_at", liveMetadata.UpdatedAt).Error; err != nil {
		t.Fatal(err)
	}
	stage = "livp-ready"
	v, ciphertext, err := keyring.Seal(baiduJSAPISecretAADID,
		baiduJSAPISecretKind, []byte("SYNTHETIC_BROWSER_AK_NEVER_USED_WITH_PROVIDER"))
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.AdminServiceSecret{
		Name: baiduJSAPISecretName, Enabled: true, Revision: 1,
		KeyVersion: v, Ciphertext: ciphertext,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := server.EnsureBaiduJSAPI4InternalKeys(context.Background()); err != nil {
		t.Fatal(err)
	}
	beforeCommit := version.Commit
	version.Commit = strings.Repeat("b", 40)
	defer func() { version.Commit = beforeCommit }()
	if err := server.RefreshBaiduJSAPI4ManagedRelease(context.Background()); err != nil {
		t.Fatal("protected signed release unavailable in non-production fixture")
	}
	defer server.ClearBaiduJSAPI4OperatorRelease()
	ownerToken, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	foreignToken, err := server.Auth.Issue(foreign.ID, foreign.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	heicToken, err := server.Auth.Issue(heicOwner.ID, heicOwner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	liveToken, err := server.Auth.Issue(liveOwner.ID, liveOwner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	router := server.Router()
	mux := http.NewServeMux()
	mux.Handle("/api/", router)
	// This synthetic token endpoint exists ONLY inside this opt-in test
	// process, is bound to 127.0.0.1 and is never installed on a Server.
	mux.HandleFunc("/__fixture/map-owner", func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		ip := net.ParseIP(host)
		if r.Method != http.MethodGet || err != nil || ip == nil || !ip.IsLoopback() {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		token := ownerToken
		if r.URL.Query().Get("account") == "foreign" && r.URL.RawQuery == "account=foreign" {
			token = foreignToken
		} else if r.URL.Query().Get("account") == "heic" && r.URL.RawQuery == "account=heic" {
			token = heicToken
		} else if r.URL.Query().Get("account") == "livp" && r.URL.RawQuery == "account=livp" {
			token = liveToken
		} else if r.URL.RawQuery != "" {
			http.Error(w, "invalid", http.StatusBadRequest)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"token": token})
	})
	// ONLY the opt-in loopback P0-17 fixture exposes these bounded state
	// transitions. Real Server.Router has no such endpoint. It lets mounted
	// Chromium prove a pending Owner map ticket is denied when Album or
	// Session authority changes between issue and cross-document consume.
	mux.HandleFunc("/__fixture/map-handoff-invalidate", func(w http.ResponseWriter, request *http.Request) {
		host, _, err := net.SplitHostPort(request.RemoteAddr)
		ip := net.ParseIP(host)
		w.Header().Set("Cache-Control", "no-store")
		if request.Method != http.MethodPost || err != nil || ip == nil ||
			!ip.IsLoopback() || request.URL.RawQuery != "" ||
			request.Header.Get("Origin") != origin ||
			request.Header.Get("Authorization") != "Bearer "+ownerToken {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		var input struct {
			Action string `json:"action"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, request.Body, 128)).
			Decode(&input); err != nil {
			http.Error(w, "invalid", http.StatusBadRequest)
			return
		}
		var update *gorm.DB
		switch input.Action {
		case "album-revision":
			update = db.Model(&meta.PhotoCollection{}).
				Where("owner_id = ? AND external_key = ?", owner.ID, "manual:Family").
				Update("revision", 8)
		case "album-missing":
			update = db.Model(&meta.PhotoCollection{}).
				Where("owner_id = ? AND external_key = ?", owner.ID, "manual:Family").
				Update("state", meta.PhotoCollectionStateMissing)
		case "album-deleted":
			// Physically DELETE the actual Album row and its three membership
			// edges. Marking it "missing" is tested independently and is not
			// evidence that the old one-use ticket rejects a deleted Album.
			err := db.Transaction(func(tx *gorm.DB) error {
				members := tx.Where("collection_id = ?", family.ID).
					Delete(&meta.PhotoCollectionAsset{})
				if members.Error != nil {
					return members.Error
				}
				if members.RowsAffected != 3 {
					return fmt.Errorf("expected three deleted Album memberships")
				}
				removed := tx.Where(
					"id = ? AND owner_id = ? AND external_key = ?",
					family.ID, owner.ID, "manual:Family",
				).Delete(&meta.PhotoCollection{})
				if removed.Error != nil {
					return removed.Error
				}
				if removed.RowsAffected != 1 {
					return fmt.Errorf("original Album was not deleted")
				}
				var remaining int64
				if err := tx.Model(&meta.PhotoCollection{}).
					Where("id = ?", family.ID).Count(&remaining).Error; err != nil {
					return err
				}
				if remaining != 0 {
					return fmt.Errorf("deleted Album still exists")
				}
				return nil
			})
			if err != nil {
				http.Error(w, "unavailable", http.StatusServiceUnavailable)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		case "session-revoked":
			update = db.Model(&meta.User{}).Where("id = ?", owner.ID).
				Update("session_version", 2)
		case "map-epoch-revoked":
			update = db.Model(&meta.BaiduJSAPIMapEpoch{}).Where("owner_id = ?", owner.ID).
				Update("epoch", 4)
		case "restore":
			err := db.Transaction(func(tx *gorm.DB) error {
				reset := tx.Model(&meta.PhotoCollection{}).
					Where("owner_id = ? AND external_key = ?", owner.ID, "manual:Family").
					Updates(map[string]any{"revision": uint64(7),
						"state": meta.PhotoCollectionStateActive})
				if reset.Error != nil {
					return reset.Error
				}
				if reset.RowsAffected == 0 {
					// Recreate only the original synthetic fixture after a true
					// deletion. An unrelated Album ID must never be substituted.
					rebuilt := meta.PhotoCollection{
						ID: family.ID, OwnerID: owner.ID, ExternalKey: "manual:Family",
						Kind: meta.PhotoCollectionKindManual, Name: "Family",
						State: meta.PhotoCollectionStateActive, Revision: 7,
					}
					if err := tx.Create(&rebuilt).Error; err != nil {
						return err
					}
					for ordinal, assetIndex := range []int{0, 1, 3} {
						if err := tx.Create(&meta.PhotoCollectionAsset{
							CollectionID: family.ID,
							AssetID: familyCandidateAssets[assetIndex].ID,
							Position: int64(ordinal),
						}).Error; err != nil {
							return err
						}
					}
				}
				if err := tx.Model(&meta.User{}).Where("id = ?", owner.ID).
					Update("session_version", uint64(1)).Error; err != nil {
					return err
				}
				if err := tx.Model(&meta.BaiduJSAPIMapEpoch{}).
					Where("owner_id = ?", owner.ID).
					Update("epoch", uint64(3)).Error; err != nil {
					return err
				}
				// Test-only reset must retire all previously issued one-use
				// nonces so restoring synthetic state never renews a ticket.
				return tx.Where("owner_id = ?", owner.ID).
					Delete(&meta.BaiduMapScopeHandoff{}).Error
			})
			if err != nil {
				http.Error(w, "unavailable", http.StatusServiceUnavailable)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		default:
			http.Error(w, "invalid", http.StatusBadRequest)
			return
		}
		if update.Error != nil || update.RowsAffected != 1 {
			http.Error(w, "unavailable", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	httpServer := httptest.NewServer(mux)
	defer httpServer.Close()
	// No bearer, AK or database information enters this readiness file.
	payload, err := json.Marshal(map[string]any{
		"real_gin": true, "postgresql": true, "url": httpServer.URL,
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
	deadline := time.NewTimer(3 * time.Minute)
	defer deadline.Stop()
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-deadline.C:
			t.Fatal("real mounted Chromium did not return a bounded completion signal")
		case <-ticker.C:
			if _, err := os.Stat(stop); err == nil {
				return
			} else if !os.IsNotExist(err) {
				t.Fatal("invalid completion path")
			}
		}
	}
}

// Seed one real protected Source→PhotoAsset→Consent→BD09 Cell chain. These
// are generated non-production metadata rows, not user photos. No provider
// coordinate conversion or unreviewed GPS send is performed.
func seedP04BrowserOwnerPhotoCells(t *testing.T, db *gorm.DB,
	ownerID uint64, prefix string, total, favorites int,
	storageKey, checksum string, byteSize int64,
) {
	t.Helper()
	sourceLatitude, sourceLongitude := 30.13, 119.97
	derivedLatitude, derivedLongitude := 30.135, 119.975
	stamp := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	for i := 0; i < total; i++ {
		name := fmt.Sprintf("p04-%s-%02d.png", prefix, i+1)
		node := meta.Node{
			OwnerID: ownerID, Name: name, Type: meta.NodeTypeFile, Revision: 1,
		}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		file := meta.File{
			NodeID: node.ID, Size: byteSize, StorageKey: storageKey, SHA256: checksum,
		}
		if err := db.Create(&file).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.FileVersion{
			NodeID: node.ID, Revision: 1, Size: byteSize,
			StorageKey: storageKey, SHA256: checksum,
		}).Error; err != nil {
			t.Fatal(err)
		}
		indexed := meta.MediaMetadata{
			NodeID: node.ID, OwnerID: ownerID, NodeRevision: 1,
			SHA256: file.SHA256, IndexState: meta.MediaIndexStateReady,
			RelationEvidenceVersion: mediapkg.RelationEvidenceVersion,
			MediaKind:               meta.MediaKindImage, MIMEType: "image/png",
			Latitude: &sourceLatitude, Longitude: &sourceLongitude,
			CapturedAt: &stamp,
		}
		if err := db.Create(&indexed).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.First(&indexed, "node_id = ?", node.ID).Error; err != nil {
			t.Fatal(err)
		}
		asset := meta.PhotoAsset{
			OwnerID: ownerID, PrimaryNodeID: node.ID,
			EvidenceKey: "p04-browser:" + name, Kind: meta.MediaKindImage,
		}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoMetadata{
			AssetID: asset.ID, MediaKind: meta.MediaKindImage,
			MIMEType: "image/png", Latitude: &sourceLatitude,
			Longitude: &sourceLongitude, CapturedAt: &stamp,
			Favorite: i < favorites,
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoResource{
			AssetID: asset.ID, NodeID: node.ID,
			ResourceKind: meta.PhotoResourceKindNode,
			Role:         meta.PhotoResourceRolePrimary,
			Name:         name, MediaKind: meta.MediaKindImage, Size: file.Size,
			MIMEType: "image/png", SHA256: checksum,
		}).Error; err != nil {
			t.Fatal(err)
		}
		consent := meta.BaiduPhotoMapConsent{
			AssetID: asset.ID, OwnerID: ownerID, Revision: 1,
			AllowIndex: true, AllowBaiduConversion: true,
			ExpiresAt:    time.Now().UTC().Add(time.Hour),
			SourceNodeID: node.ID, SourceNodeRevision: 1,
			SourceMediaUpdatedAt: &indexed.UpdatedAt,
			SourceLatitude:       &sourceLatitude, SourceLongitude: &sourceLongitude,
		}
		if err := db.Create(&consent).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.BaiduPhotoMapPosition{
			AssetID: asset.ID, OwnerID: ownerID,
			PrimaryNodeID: node.ID, NodeRevision: 1,
			MediaUpdatedAt: indexed.UpdatedAt, ConsentRevision: 1,
			SourceLatitude: sourceLatitude, SourceLongitude: sourceLongitude,
			Latitude: derivedLatitude, Longitude: derivedLongitude,
			CoordinateSpace:   meta.BaiduPhotoMapSpaceBD09LL,
			ProjectionVersion: meta.BaiduPhotoMapProjectionGeoconvV2,
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
}
