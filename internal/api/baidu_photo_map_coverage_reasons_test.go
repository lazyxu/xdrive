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

func TestBaiduMapCoverageReasonsNoAuthorityAndConservation(t *testing.T) {
	c, cancel := context.WithCancel(context.Background())
	cancel()
	for _, tc := range []struct {
		ctx   context.Context
		owner uint64
	}{
		{nil, 1}, {c, 1}, {context.Background(), 0},
		{context.Background(), 1},
	} {
		if _, err := queryBaiduPhotoMapCoverageReasons(tc.ctx, nil, tc.owner); err == nil {
			t.Fatal("untrusted coverage caller accepted")
		}
	}
	good := baiduPhotoMapCoverageReasons{
		ValidGPSAssets: 8, EligibleBD09Assets: 1,
		DerivedMissingAssets: 5, DerivedInvalidAssets: 2,
	}
	if !good.valid() {
		t.Fatal("consistent exclusive partition rejected")
	}
	for _, bad := range []baiduPhotoMapCoverageReasons{
		{ValidGPSAssets: -1},
		{ValidGPSAssets: 1, EligibleBD09Assets: 2},
		{ValidGPSAssets: 2, EligibleBD09Assets: 1, DerivedMissingAssets: 2},
		{ValidGPSAssets: 3, EligibleBD09Assets: 1, DerivedMissingAssets: 1},
		{ValidGPSAssets: 1, ConsentUnavailableAssets: -1},
	} {
		if bad.valid() {
			t.Fatalf("unsafe reasons accepted: %+v", bad)
		}
	}
}

func TestBaiduMapCoverageReasonsReadOnlyOwnerAndRevisionPostgres(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL required")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	rootSQL, err := root.DB()
	if err != nil {
		t.Fatal(err)
	}
	rootSQL.SetMaxOpenConns(2)
	rootSQL.SetMaxIdleConns(0)
	defer rootSQL.Close()
	schema := "baidu_map_reasons_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
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
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(3)
	sqlDB.SetMaxIdleConns(0)
	defer sqlDB.Close()
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.MediaMetadata{},
		&meta.PhotoAsset{}, &meta.BaiduPhotoMapConsent{}, &meta.BaiduPhotoMapPosition{}); err != nil {
		t.Fatal(err)
	}
	owner := meta.User{Username: "map-reasons-owner", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1}
	other := meta.User{Username: "map-reasons-other", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1}
	for _, user := range []*meta.User{&owner, &other} {
		if err := db.Create(user).Error; err != nil {
			t.Fatal(err)
		}
	}
	type photo struct {
		asset meta.PhotoAsset
		node  meta.Node
		media meta.MediaMetadata
	}
	makePhoto := func(who uint64, name, state string, lat, lng float64) photo {
		t.Helper()
		node := meta.Node{OwnerID: who, Name: name, Type: meta.NodeTypeFile, Revision: 1}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		media := meta.MediaMetadata{
			OwnerID: who, NodeID: node.ID, NodeRevision: node.Revision,
			MediaKind: meta.MediaKindImage, IndexState: meta.MediaIndexStateReady,
			Latitude: &lat, Longitude: &lng,
		}
		if err := db.Create(&media).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Where("node_id = ?", node.ID).Take(&media).Error; err != nil {
			t.Fatal(err)
		}
		asset := meta.PhotoAsset{OwnerID: who, PrimaryNodeID: node.ID,
			Kind: meta.PhotoAssetKindImage, EvidenceKey: name}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		if state != "absent" {
			sourceLat := lat
			if state == "stale-consent" {
				sourceLat = lat + 1
			}
			sourceTime := media.UpdatedAt
			consent := meta.BaiduPhotoMapConsent{
				OwnerID: who, AssetID: asset.ID, Revision: 1,
				AllowIndex: true, AllowBaiduConversion: true,
				ExpiresAt:    time.Now().UTC().Add(time.Hour),
				SourceNodeID: node.ID, SourceNodeRevision: node.Revision,
				SourceMediaUpdatedAt: &sourceTime,
				SourceLatitude:       &sourceLat, SourceLongitude: &lng,
			}
			if state == "revoked" {
				now := time.Now().UTC()
				consent.RevokedAt = &now
			}
			if state == "expired" {
				consent.ExpiresAt = time.Now().UTC().Add(-time.Hour)
			}
			if err := db.Create(&consent).Error; err != nil {
				t.Fatal(err)
			}
		}
		if state == "eligible" || state == "bad-position" || state == "outside-bd09" {
			version := meta.BaiduPhotoMapProjectionGeoconvV2
			if state == "bad-position" {
				version = "obsolete-projection"
			}
			pos := meta.BaiduPhotoMapPosition{
				AssetID: asset.ID, OwnerID: who, PrimaryNodeID: node.ID,
				NodeRevision: node.Revision, MediaUpdatedAt: media.UpdatedAt,
				ConsentRevision: 1, SourceLatitude: lat, SourceLongitude: lng,
				CoordinateSpace:   meta.BaiduPhotoMapSpaceBD09LL,
				ProjectionVersion: version,
				Latitude:          lat + 0.006, Longitude: lng + 0.006,
			}
			if err := db.Create(&pos).Error; err != nil {
				t.Fatal(err)
			}
		}
		return photo{asset: asset, node: node, media: media}
	}
	fresh := makePhoto(owner.ID, "valid-origin-zero.jpg", "eligible", 0, 0)
	makePhoto(owner.ID, "missing-consent.jpg", "absent", 25, 30)
	makePhoto(owner.ID, "revoked.jpg", "revoked", 26, 31)
	makePhoto(owner.ID, "expired.jpg", "expired", 27, 32)
	makePhoto(owner.ID, "edited.jpg", "stale-consent", 28, 33)
	makePhoto(owner.ID, "no-position.jpg", "no-position", 29, 34)
	makePhoto(owner.ID, "bad-projection.jpg", "bad-position", 30, 35)
	makePhoto(owner.ID, "outside-world.jpg", "outside-bd09", 86, 36)
	makePhoto(other.ID, "other-owner.jpg", "eligible", 50, 51)

	ctx := context.Background()
	got, err := queryBaiduPhotoMapCoverageReasons(ctx, db, owner.ID)
	if err != nil {
		t.Fatal(err)
	}
	want := baiduPhotoMapCoverageReasons{
		ValidGPSAssets: 8, EligibleBD09Assets: 1,
		DerivedMissingAssets: 5, DerivedInvalidAssets: 2,
	}
	if got != want {
		t.Fatalf("exclusive causes do not match current Owner/BD09 eligibility: got %+v want %+v", got, want)
	}
	// The source set must exactly match the existing count endpoint. Do not
	// claim a subset of 64 map covers as the source PhotoAsset population.
	coverage, err := queryBaiduPhotoMapCoverage(ctx, db, owner.ID)
	if err != nil || coverage.ValidGPSAssets != got.ValidGPSAssets ||
		coverage.EligibleBD09Assets != got.EligibleBD09Assets ||
		coverage.OutsideSourceMapLatitudeAssets != 1 {
		t.Fatalf("reason and primary coverage disagree: %+v, err=%v", coverage, err)
	}
	// Legacy consent-row mutations cannot hide a valid current Owner location.
	if err := db.Model(&meta.BaiduPhotoMapConsent{}).
		Where("owner_id = ? AND asset_id = ?", owner.ID, fresh.asset.ID).
		Update("revoked_at", time.Now().UTC()).Error; err != nil {
		t.Fatal(err)
	}
	after, err := queryBaiduPhotoMapCoverageReasons(ctx, db, owner.ID)
	if err != nil || after.EligibleBD09Assets != 1 ||
		after.DerivedMissingAssets != 5 || !after.valid() {
		t.Fatalf("legacy consent edit changed map membership or partition: %+v err=%v", after, err)
	}
	// Invalid users never appear in this Owner's numbers.
	foreign, err := queryBaiduPhotoMapCoverageReasons(ctx, db, other.ID)
	if err != nil || foreign.ValidGPSAssets != 1 || foreign.EligibleBD09Assets != 1 {
		t.Fatalf("foreign owner source unexpectedly leaked: %+v err=%v", foreign, err)
	}
	// Aborted queries cannot return a stale apparently-successful snapshot.
	dead, stop := context.WithCancel(ctx)
	stop()
	if _, err := queryBaiduPhotoMapCoverageReasons(dead, db, owner.ID); err == nil {
		t.Fatal("cancelled reason diagnostic accepted")
	}
	// Verify read-only implementation cannot insert or mutate authorization.
	var count int64
	if err := db.Model(&meta.BaiduPhotoMapPosition{}).Count(&count).Error; err != nil || count != 4 {
		t.Fatalf("coverage diagnostic mutated derived state: %d %v", count, err)
	}
}

func TestBaiduMapCoverageReasonsHTTPAuthRoutingAndNoRawLocation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := &Server{}
	endpoint := "/api/v1/media/places/baidu-jsapi/coverage-reasons"
	router := gin.New()
	router.GET(endpoint, s.listBaiduPhotoMapCoverageReasons)
	for _, tc := range []struct {
		query string
		want  int
	}{
		{"?owner_id=99", http.StatusBadRequest},
		{"?latitude=35.123", http.StatusBadRequest},
		{"", http.StatusServiceUnavailable},
	} {
		req := httptest.NewRequest(http.MethodGet, endpoint+tc.query, nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != tc.want || !strings.Contains(w.Header().Get("Cache-Control"), "no-store") ||
			strings.Contains(w.Body.String(), "35.123") ||
			strings.Contains(w.Body.String(), "owner_id") {
			t.Fatalf("coverage reason response disclosed sensitive data: %d %s", w.Code, w.Body.String())
		}
	}
	registered := false
	for _, route := range s.Router().Routes() {
		if route.Method == http.MethodGet && route.Path == endpoint {
			registered = true
		}
	}
	if !registered {
		t.Fatal("authenticated Owner reason route missing")
	}
}
