package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Exercise the actual authenticated Server map + PhotoAsset Range over HTTP
// with two accounts that intentionally share the same canonical GPS placeID.
// An Owner A response created before a switch is permitted to finish, but
// every freshly requested Owner B response must contain only B's PhotoAsset.
// Native iOS epoch/Owner fences prevent the in-flight A response from painting
// B's wall; the companion source/UITests guard that client-side boundary.
func TestIOSMapP0OwnerABAndRevocationCompoundHTTP(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	gin.SetMode(gin.TestMode)

	rootDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "ios_map_owner_race_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := rootDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = rootDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error
	}()

	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	values := parsed.Query()
	values.Set("search_path", schema)
	parsed.RawQuery = values.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(6)
	sqlDB.SetMaxIdleConns(0)
	defer sqlDB.Close()
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{},
		&meta.MediaMetadata{}, &meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.PhotoAsset{}, &meta.PhotoAssetOccurrence{},
		&meta.PhotoAssetIdentityAlias{}, &meta.PhotoEditRecipe{},
		&meta.PhotoMetadata{}, &meta.PhotoResource{},
	); err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		DB: db, Store: store,
		Auth: auth.New("ios-map-owner-compound-race-test", time.Hour),
		AllowedOrigin: "http://localhost", RefreshTTL: time.Hour,
		MaxUploadBytes: 10 << 20,
	}
	router := server.Router()
	nameA := "mapracea" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	nameB := "mapraceb" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	tokenA := createTestUser(t, db, router, nameA, "ios-map-race-test-password-a")
	tokenB := createTestUser(t, db, router, nameB, "ios-map-race-test-password-b")
	rootA := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root",
		tokenA, nil, http.StatusOK)
	rootB := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root",
		tokenB, nil, http.StatusOK)
	var ownerA, ownerB meta.User
	if err := db.Where("username = ?", nameA).First(&ownerA).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("username = ?", nameB).First(&ownerB).Error; err != nil {
		t.Fatal(err)
	}
	if ownerA.ID == ownerB.ID {
		t.Fatal("fixture did not create distinct authenticated owners")
	}

	lat, lon := 31.231, 121.475
	captured := time.Date(2026, time.November, 1, 12, 0, 0, 0, time.UTC)
	makeLocation := func(ownerID, rootID uint64, name string) uint64 {
		t.Helper()
		node := meta.Node{
			ParentID: &rootID, Name: name, OwnerID: ownerID,
			Type: meta.NodeTypeFile, Revision: 1,
		}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		file := meta.File{
			NodeID: node.ID, Size: 64, StorageKey: "map-race-" + name,
			SHA256: fmt.Sprintf("%064x", node.ID),
		}
		if err := db.Create(&file).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.MediaMetadata{
			NodeID: node.ID, OwnerID: ownerID, NodeRevision: 1,
			SHA256: file.SHA256, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", Latitude: &lat, Longitude: &lon,
			CapturedAt: &captured, IndexState: meta.MediaIndexStateReady,
		}).Error; err != nil {
			t.Fatal(err)
		}
		asset := meta.PhotoAsset{
			OwnerID: ownerID, PrimaryNodeID: node.ID,
			Kind: meta.PhotoAssetKindImage,
			EvidenceKey: fmt.Sprintf("node:%d", node.ID),
		}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoMetadata{
			AssetID: asset.ID, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", Latitude: &lat, Longitude: &lon,
			CapturedAt: &captured,
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoResource{
			AssetID: asset.ID, ResourceKind: meta.PhotoResourceKindNode,
			NodeID: node.ID, Role: meta.PhotoResourceRolePrimary,
			Name: name, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", Size: file.Size,
		}).Error; err != nil {
			t.Fatal(err)
		}
		return node.ID
	}
	nodeA := makeLocation(ownerA.ID, rootA.ID, "map-race-a.jpg")
	nodeB := makeLocation(ownerB.ID, rootB.ID, "map-race-b.jpg")
	world := "/api/v1/media/places/overview?west=-180&south=-85&east=180&north=85&detail=1"
	readOverview := func(token string) mediaPlacesMapOverviewDTO {
		t.Helper()
		answer := request(t, router, http.MethodGet, world, token, nil, http.StatusOK)
		var overview mediaPlacesMapOverviewDTO
		if err := json.Unmarshal(answer.Body.Bytes(), &overview); err != nil {
			t.Fatal(err)
		}
		return overview
	}
	checkOverview := func(overview mediaPlacesMapOverviewDTO, own, foreign uint64) string {
		t.Helper()
		if overview.TotalPhotoCount != 1 || len(overview.Items) != 1 ||
			overview.Items[0].ItemCount != 1 ||
			overview.Items[0].CoverNodeID == nil ||
			*overview.Items[0].CoverNodeID != own ||
			*overview.Items[0].CoverNodeID == foreign {
			t.Fatalf("wrong current Owner map covers/count: %+v", overview)
		}
		return overview.Items[0].ID
	}
	placeA := checkOverview(readOverview(tokenA), nodeA, nodeB)
	placeB := checkOverview(readOverview(tokenB), nodeB, nodeA)
	if placeA != placeB {
		t.Fatalf("two genuine same-cell Owners should share placeID, got %q vs %q", placeA, placeB)
	}
	rangeURL := "/api/v1/media/items?range=true&limit=48&offset=0&place=" +
		url.QueryEscape(placeA)
	checkRange := func(token string, own, foreign uint64) {
		t.Helper()
		answer := request(t, router, http.MethodGet, rangeURL, token, nil, http.StatusOK)
		var page mediaItemRangeDTO
		if err := json.Unmarshal(answer.Body.Bytes(), &page); err != nil {
			t.Fatal(err)
		}
		if page.TotalCount != 1 || page.Offset != 0 || len(page.Items) != 1 ||
			page.Items[0].Node.ID != own || page.Items[0].Node.ID == foreign {
			t.Fatalf("foreign or stale Owner media entered canonical 48-item Range: %+v", page)
		}
	}
	checkRange(tokenA, nodeA, nodeB)

	// Keep an actual completed Owner A response in flight from the client's
	// perspective, then independently read Owner B's same-GPS place. The
	// client has to discard A by epoch/Owner, not by place ID or count.
	delayedA := request(t, router, http.MethodGet, rangeURL, tokenA, nil, http.StatusOK)
	checkRange(tokenB, nodeB, nodeA)
	if strings.Contains(delayedA.Body.String(), "map-race-b.jpg") {
		t.Fatal("Owner A response included B media before account switch")
	}

	// A signed-out/invalid token cannot reveal an old Owner's GPS or Range.
	// B requests for A's direct Node/thumbnail are forbidden or not found;
	// neither status may contain A's name or media bytes.
	foreignPaths := []string{
		fmt.Sprintf("/api/v1/media/items/%d", nodeA),
		fmt.Sprintf("/api/v1/media/items/%d/thumbnail?revision=1", nodeA),
	}
	for _, path := range foreignPaths {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+tokenB)
		got := httptest.NewRecorder()
		router.ServeHTTP(got, req)
		if got.Code != http.StatusForbidden && got.Code != http.StatusNotFound {
			t.Fatalf("cross-Owner item/thumbnail %s status=%d response=%s",
				path, got.Code, got.Body.String())
		}
		if strings.Contains(got.Body.String(), "map-race-a.jpg") {
			t.Fatalf("cross-Owner denial exposed A filename at %s", path)
		}
	}
	if err := db.Model(&meta.User{}).Where("id = ?", ownerA.ID).
		Update("session_version", ownerA.SessionVersion+1).Error; err != nil {
		t.Fatal(err)
	}
	// Concurrent A (revoked) and B (current) HTTP responses use distinct
	// Session/Owner contexts even though they read the same numeric placeID.
	type result struct {
		code int
		body string
	}
	var wg sync.WaitGroup
	results := make(chan result, 2)
	for _, token := range []string{tokenA, tokenB} {
		token := token
		wg.Add(1)
		go func() {
			defer wg.Done()
			req := httptest.NewRequest(http.MethodGet, rangeURL, nil)
			req.Header.Set("Authorization", "Bearer "+token)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			results <- result{code: rec.Code, body: rec.Body.String()}
		}()
	}
	wg.Wait()
	close(results)
	okB, deniedA := false, false
	for result := range results {
		switch result.code {
		case http.StatusOK:
			var page mediaItemRangeDTO
			if err := json.Unmarshal([]byte(result.body), &page); err != nil {
				t.Fatal(err)
			}
			if len(page.Items) != 1 || page.Items[0].Node.ID != nodeB {
				t.Fatalf("revoked A photo leaked in current response: %+v", page)
			}
			okB = true
		case http.StatusUnauthorized:
			if strings.Contains(result.body, "map-race-a.jpg") {
				t.Fatal("revoked A response leaked old media")
			}
			deniedA = true
		default:
			t.Fatalf("unexpected status during Owner revocation race: %d", result.code)
		}
	}
	if !okB || !deniedA {
		t.Fatalf("concurrent revoked A/current B results missing: denied=%v B=%v", deniedA, okB)
	}
	_ = context.Background() // The router above exercised actual authenticated HTTP contexts.
}
