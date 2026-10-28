package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestBaiduPhotoFocusParserFailClosed(t *testing.T) {
	node, rev, ok := parseBaiduPhotoFocusQuery("node_id=42&node_revision=3")
	if !ok || node != 42 || rev != 3 {
		t.Fatal("valid current photo identity rejected")
	}
	for _, bad := range []string{
		"", "node_id=42", "node_revision=3",
		"node_id=0&node_revision=1",
		"node_id=42&node_revision=0",
		"node_id=042&node_revision=1",
		"node_id=42&node_revision=01",
		"node_id=-42&node_revision=1",
		"node_id=42&node_revision=-1",
		"node_id=42&node_id=43&node_revision=1",
		"node_id=42&node_revision=1&node_revision=2",
		"node_id=42&node_revision=1&owner_id=7",
		"node_id=42&node_revision=1&latitude=30",
		"node_id=42&node_revision=1&coordinate_space=wgs84ll",
		"node_id=42&node_revision=1&album=manual:secret",
		"node_id=42&node_revision=1&ak=canary",
		"node_id=9007199254740992&node_revision=1",
		"node_id=42&node_revision=9007199254740992",
		"node_id=18446744073709551616&node_revision=1",
		"node_id=42%20&node_revision=1",
		"node_id=42&node_revision=1%GG",
	} {
		if _, _, accepted := parseBaiduPhotoFocusQuery(bad); accepted {
			t.Fatalf("unapproved photo focus selector: %q", bad)
		}
	}
}

func TestBaiduPhotoFocusNoReleaseFailClosed(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := &Server{AllowedOrigin: "https://gallery.example.invalid"}
	router := gin.New()
	router.GET("/api/v1/media/places/baidu-jsapi/photo-focus", s.getBaiduNativeMapPhotoFocus)
	for _, q := range []string{"node_id=42&node_revision=3",
		"node_id=42&node_revision=3&owner_id=canary"} {
		req := httptest.NewRequest(http.MethodGet,
			"/api/v1/media/places/baidu-jsapi/photo-focus?"+q, nil)
		req.Header.Set("Authorization", "Bearer secret_canary")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusServiceUnavailable ||
			!strings.Contains(rec.Body.String(), "map_runtime_unavailable") ||
			strings.Contains(rec.Body.String(), "canary") ||
			rec.Header().Get("Cache-Control") != "private, no-store" ||
			rec.Header().Get("Referrer-Policy") != "no-referrer" {
			t.Fatalf("unlicensed map focus did not fail closed: status=%d", rec.Code)
		}
	}
	found := false
	for _, route := range s.Router().Routes() {
		if route.Method == http.MethodGet &&
			route.Path == "/api/v1/media/places/baidu-jsapi/photo-focus" {
			found = true
		}
	}
	if !found {
		t.Fatal("missing authenticated Owner focus route")
	}
}

func TestBaiduPhotoFocusRealPG17OwnerGPSRevision(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" || os.Getenv("XD_PLACES_PHOTO_FOCUS_PG17") != "1" {
		t.Skip("standalone disposable PG17 test only")
	}
	if os.Getenv("XD_PLACES_100K_DISPOSABLE_CI") != "1" {
		t.Fatal("refusing non-disposable Owner position test")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal("disposable PostgreSQL unavailable")
	}
	rootPool, err := root.DB()
	if err != nil {
		t.Fatal(err)
	}
	rootPool.SetMaxOpenConns(2)
	defer rootPool.Close()
	schema := "photo_focus_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal("failed to allocate isolated schema")
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	pool.SetMaxOpenConns(3)
	defer pool.Close()
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{},
		&meta.MediaMetadata{}, &meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.PhotoAsset{}, &meta.PhotoEditRecipe{}, &meta.PhotoResource{},
		&meta.PhotoMetadata{}, &meta.BaiduPhotoMapConsent{}, &meta.BaiduPhotoMapPosition{},
	); err != nil {
		t.Fatal("failed to migrate isolated Owner tables")
	}
	owner := meta.User{Username: "focus-owner", PasswordHash: "fixture",
		Role: meta.UserRoleUser, SessionVersion: 1}
	other := meta.User{Username: "focus-other", PasswordHash: "fixture",
		Role: meta.UserRoleUser, SessionVersion: 1}
	for _, person := range []*meta.User{&owner, &other} {
		if err := db.Create(person).Error; err != nil {
			t.Fatal("failed to create isolated Owner")
		}
	}
	originalLat, originalLon := 30.13, 119.97
	seed := func(ownerID uint64, name string) meta.Node {
		t.Helper()
		node := meta.Node{OwnerID: ownerID, Name: name, Type: meta.NodeTypeFile, Revision: 1}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal("seed node")
		}
		file := meta.File{NodeID: node.ID, Size: 12, StorageKey: name,
			SHA256: strings.Repeat("a", 64)}
		if err := db.Create(&file).Error; err != nil {
			t.Fatal("seed file")
		}
		media := meta.MediaMetadata{NodeID: node.ID, OwnerID: ownerID,
			NodeRevision: node.Revision, SHA256: file.SHA256,
			IndexState: meta.MediaIndexStateReady, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", Latitude: &originalLat, Longitude: &originalLon}
		if err := db.Create(&media).Error; err != nil {
			t.Fatal("seed original indexed GPS")
		}
		asset := meta.PhotoAsset{OwnerID: ownerID, PrimaryNodeID: node.ID,
			EvidenceKey: "focus:" + name, Kind: meta.MediaKindImage}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal("seed source PhotoAsset")
		}
		// No per-photo Consent record: the current Owner valid-GPS policy must
		// remain active, and only existing derived/source proof is consulted.
		derived := meta.BaiduPhotoMapPosition{
			AssetID: asset.ID, OwnerID: ownerID, PrimaryNodeID: node.ID,
			NodeRevision: node.Revision, MediaUpdatedAt: media.UpdatedAt,
			SourceLatitude: originalLat, SourceLongitude: originalLon,
			Latitude: 30.14, Longitude: 119.98,
			CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL,
			ProjectionVersion: meta.BaiduPhotoMapProjectionGeoconvV2,
		}
		if err := db.Create(&derived).Error; err != nil {
			t.Fatal("seed derived BD09 photo")
		}
		return node
	}
	a := seed(owner.ID, "one.jpg")
	b := seed(other.ID, "foreign.jpg")
	ctx, stop := context.WithTimeout(context.Background(), 8*time.Second)
	defer stop()
	point, ok, err := queryBaiduPhotoFocus(ctx, db, owner.ID, a.ID, a.Revision)
	if err != nil || !ok || point.CoordinateSpace != meta.BaiduPhotoMapSpaceBD09LL ||
		point.IndexScope != baiduNativeMapIndexScope ||
		point.NodeID != a.ID || point.NodeRevision != a.Revision ||
		point.Latitude != 30.14 || point.Longitude != 119.98 ||
		point.Latitude == originalLat || point.Longitude == originalLon {
		t.Fatal("current Owner focus widened or returned original GPS")
	}
	for _, input := range []struct{ owner, node, revision uint64 }{
		{owner.ID, b.ID, b.Revision},
		{other.ID, a.ID, a.Revision},
		{owner.ID, a.ID, a.Revision + 1},
	} {
		if _, found, err := queryBaiduPhotoFocus(ctx, db, input.owner,
			input.node, input.revision); err != nil || found {
			t.Fatal("foreign Owner or stale revision admitted")
		}
	}
	if err := db.Model(&meta.MediaMetadata{}).
		Where("node_id = ?", a.ID).Update("latitude", 31.0).Error; err != nil {
		t.Fatal("change original GPS")
	}
	if _, found, err := queryBaiduPhotoFocus(ctx, db, owner.ID,
		a.ID, a.Revision); err != nil || found {
		t.Fatal("stale source GPS reauthorized derived coordinate")
	}
	aborted, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := queryBaiduPhotoFocus(aborted, db, owner.ID,
		a.ID, a.Revision); err == nil {
		t.Fatal("cancelled map focus query admitted")
	}
	if _, _, err := queryBaiduPhotoFocus(context.Background(), nil, owner.ID,
		a.ID, a.Revision); err == nil {
		t.Fatal("missing DB admitted")
	}
}
