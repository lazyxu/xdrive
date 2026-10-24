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
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/version"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// P0-4: real Gin routing, bearer Owner validation, currently signed Server
// release and PostgreSQL single-use issue/redeem. This does NOT mount a
// browser SDK, contact Baidu or validate media bytes/Viewer: #2531 tracks
// that remaining real end-to-end browser integration separately.
func TestPlacesP04RealGinOwnerHandoffPostgres(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("real PostgreSQL test fixture required")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "places_p04_http_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
	uri, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := uri.Query()
	query.Set("search_path", schema)
	uri.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(uri.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(6)
	defer sqlDB.Close()
	if err := db.AutoMigrate(
		&meta.User{}, &meta.AdminServiceSecret{}, &meta.InternalServiceKeyAnchor{},
		&meta.BaiduJSAPIMapEpoch{}, &meta.PhotoCollection{}, &meta.BaiduMapScopeHandoff{},
	); err != nil {
		t.Fatal(err)
	}
	keys, err := connectorsecret.NewKeyring(1, map[uint32]string{
		1: strings.Repeat("cd", 32),
	})
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{
		DB: db, ConnectorSecrets: keys, Auth: auth.New("p04-real-gin-owner-map", time.Hour),
		AllowedOrigin: "https://gallery.example.net",
		// The INLINE Host has no independent Child DNS requirement. This does
		// not relax separate Child ticket admission for isolated map SDK.
	}
	owner := meta.User{Username: "p04-real-owner", PasswordHash: "test-only",
		Role: meta.UserRoleUser, SessionVersion: 1}
	foreign := meta.User{Username: "p04-foreign", PasswordHash: "test-only",
		Role: meta.UserRoleUser, SessionVersion: 1}
	for _, person := range []*meta.User{&owner, &foreign} {
		if err := db.Create(person).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.BaiduJSAPIMapEpoch{
			OwnerID: person.ID, Epoch: 3,
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
	album := meta.PhotoCollection{OwnerID: owner.ID, ExternalKey: "manual:Family",
		Kind: meta.PhotoCollectionKindManual, Name: "Family",
		State: meta.PhotoCollectionStateActive, Revision: 7}
	if err := db.Create(&album).Error; err != nil {
		t.Fatal(err)
	}
	akVersion, akCipher, err := keys.Seal(
		baiduJSAPISecretAADID, baiduJSAPISecretKind, []byte("SYNTHETIC_BROWSER_AK_NO_PROVIDER"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.AdminServiceSecret{Name: baiduJSAPISecretName,
		Enabled: true, Revision: 1, KeyVersion: akVersion, Ciphertext: akCipher}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.EnsureBaiduJSAPI4InternalKeys(context.Background()); err != nil {
		t.Fatal(err)
	}
	priorCommit := version.Commit
	version.Commit = strings.Repeat("a", 40)
	defer func() { version.Commit = priorCommit }()
	if err := s.RefreshBaiduJSAPI4ManagedRelease(context.Background()); err != nil {
		t.Fatalf("could not establish genuine protected test-only signed release: %v", err)
	}
	defer s.ClearBaiduJSAPI4OperatorRelease()
	token, err := s.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.Auth.Issue(foreign.ID, foreign.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	router := s.Router()
	visit := func(route, bearer, payload, origin string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "https://gallery.example.net"+route,
			strings.NewReader(payload))
		req.Header.Set("Authorization", "Bearer "+bearer)
		req.Header.Set("Origin", origin)
		req.Header.Set("Sec-Fetch-Site", "same-origin")
		req.Header.Set("Content-Type", "application/json")
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		return out
	}
	// Genuine Gin response: signed release is available without Child DNS.
	status := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet,
		"https://gallery.example.net/api/v1/media/places/baidu-jsapi/status", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	router.ServeHTTP(status, req)
	if status.Code != http.StatusOK ||
		!strings.Contains(status.Body.String(), "\"activation_state\":\"authorized_signed_release\"") ||
		!strings.Contains(status.Body.String(), "\"isolated_child_origin\":\"\"") {
		t.Fatalf("independent inline signed status unavailable: %d", status.Code)
	}
	testPlacesRealGinBD09PhotoRanges(t, db, router, owner, foreign, token, other)
	issue := func(target string) string {
		t.Helper()
		payload := fmt.Sprintf(
			`{"target_mode":%q,"scope":{"albumKey":"manual:Family","filters":{"sort_by":"captured","sort_dir":"desc","favorite":true}},"camera":{"coordinate_space":"bd09ll","latitude":35.42,"longitude":119.2,"zoom":11}}`,
			target)
		out := visit(baiduMapScopeHandoffPath, token, payload,
			"https://gallery.example.net")
		if out.Code != http.StatusOK {
			t.Fatalf("authenticated Gin issue rejected %s: status %d", target, out.Code)
		}
		var reply struct {
			Ticket     string `json:"ticket"`
			TargetMode string `json:"target_mode"`
		}
		if err := json.Unmarshal(out.Body.Bytes(), &reply); err != nil ||
			len(reply.Ticket) != 64 || reply.TargetMode != target {
			t.Fatal("invalid one-use Gin handoff issue response")
		}
		if strings.Contains(out.Body.String(), "manual:Family") ||
			strings.Contains(out.Body.String(), "35.42") {
			t.Fatal("private album/camera leaked in one-use URL ticket response")
		}
		return reply.Ticket
	}
	consume := func(target, ticket, bearer, origin string) *httptest.ResponseRecorder {
		t.Helper()
		payload := fmt.Sprintf(`{"target_mode":%q,"ticket":%q}`, target, ticket)
		return visit(baiduMapScopeConsumePath, bearer, payload, origin)
	}
	for _, target := range []string{"isolated", "prototype"} {
		ticket := issue(target)
		if got := consume(target, ticket, other, "https://gallery.example.net"); got.Code == http.StatusOK {
			t.Fatal("foreign Owner consumed one-use bridge")
		}
		wrongMode := "isolated"
		if target == "isolated" {
			wrongMode = "prototype"
		}
		if got := consume(wrongMode, ticket, token, "https://gallery.example.net"); got.Code == http.StatusOK {
			t.Fatal("wrong SDK Host consumed one-use bridge")
		}
		if got := consume(target, ticket, token, "https://attacker.example.org"); got.Code == http.StatusOK {
			t.Fatal("cross-Origin request consumed bridge")
		}
		good := consume(target, ticket, token, "https://gallery.example.net")
		if good.Code != http.StatusOK {
			t.Fatalf("real Gin/PG handoff %s consume failed with %d", target, good.Code)
		}
		var reply struct {
			TargetMode string                `json:"target_mode"`
			Scope      baiduMapHandoffScope  `json:"scope"`
			Camera     baiduMapHandoffCamera `json:"camera"`
		}
		if err := json.Unmarshal(good.Body.Bytes(), &reply); err != nil ||
			reply.TargetMode != target || reply.Scope.AlbumKey != "manual:Family" ||
			reply.Scope.Filters.Favorite == nil || !*reply.Scope.Filters.Favorite ||
			reply.Camera.CoordinateSpace != "bd09ll" || reply.Camera.Zoom != 11 {
			t.Fatal("Gin/PG scope or camera changed between map SDK Hosts")
		}
		if replay := consume(target, ticket, token, "https://gallery.example.net"); replay.Code == http.StatusOK {
			t.Fatal("one-use Owner PhotoScope replayed")
		}
	}
	// Album revision must be re-read when consuming a still-valid ticket.
	staleAlbum := issue("isolated")
	if err := db.Model(&meta.PhotoCollection{}).Where("id = ?", album.ID).
		Update("revision", 8).Error; err != nil {
		t.Fatal(err)
	}
	if out := consume("isolated", staleAlbum, token, "https://gallery.example.net"); out.Code == http.StatusOK {
		t.Fatal("modified Album was silently restored")
	}
	// Existing Owner map revocation fence must invalidate pending tickets too.
	if err := db.Model(&meta.PhotoCollection{}).Where("id = ?", album.ID).
		Update("revision", 7).Error; err != nil {
		t.Fatal(err)
	}
	staleEpoch := issue("isolated")
	if err := db.Model(&meta.BaiduJSAPIMapEpoch{}).Where("owner_id = ?", owner.ID).
		Update("epoch", 4).Error; err != nil {
		t.Fatal(err)
	}
	if out := consume("isolated", staleEpoch, token, "https://gallery.example.net"); out.Code == http.StatusOK {
		t.Fatal("revoked Owner map restored")
	}
}

// A signed Owner's real /cells and /cell-items use the same consent/revision
// source-of-truth as Gallery's Range. This is test-only PhotoAsset provenance;
// it cannot substitute for real Chromium Viewer rendering or media byte checks.
func testPlacesRealGinBD09PhotoRanges(
	t *testing.T, db *gorm.DB, router *gin.Engine,
	owner, foreign meta.User, ownerToken, foreignToken string,
) {
	t.Helper()
	if err := db.AutoMigrate(
		&meta.Node{}, &meta.File{}, &meta.MediaMetadata{},
		&meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.PhotoAsset{}, &meta.PhotoEditRecipe{}, &meta.PhotoResource{},
		&meta.PhotoMetadata{}, &meta.BaiduPhotoMapConsent{},
		&meta.BaiduPhotoMapPosition{},
	); err != nil {
		t.Fatal(err)
	}
	var first meta.PhotoAsset
	for i := 0; i < 10; i++ {
		uid := owner.ID
		if i == 9 {
			uid = foreign.ID
		}
		name := fmt.Sprintf("bd09-gin-%02d.jpg", i)
		hash := fmt.Sprintf("%064x", i+1)
		node := meta.Node{Name: name, OwnerID: uid, Type: meta.NodeTypeFile, Revision: 1}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.File{
			NodeID: node.ID, Size: 12, StorageKey: name, SHA256: hash,
		}).Error; err != nil {
			t.Fatal(err)
		}
		rawLat := 30.12 + float64(i)*0.00001
		rawLon := 119.96 + float64(i)*0.00001
		captured := time.Date(2026, 10, 20, 12, 0, i, 0, time.UTC)
		row := meta.MediaMetadata{
			NodeID: node.ID, OwnerID: uid, NodeRevision: 1, SHA256: hash,
			IndexState: meta.MediaIndexStateReady, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", Latitude: &rawLat, Longitude: &rawLon,
			CapturedAt: &captured,
		}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
		asset := meta.PhotoAsset{
			OwnerID: uid, PrimaryNodeID: node.ID,
			EvidenceKey: fmt.Sprintf("p04-http-%d:%s", uid, name),
			Kind:        meta.MediaKindImage,
		}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			first = asset
		}
		if err := db.Create(&meta.PhotoMetadata{
			AssetID: asset.ID, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", Favorite: i < 3, CapturedAt: &captured,
			Latitude: &rawLat, Longitude: &rawLon,
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoResource{
			AssetID: asset.ID, NodeID: node.ID,
			ResourceKind: meta.PhotoResourceKindNode, Role: meta.PhotoResourceRolePrimary,
			Name: name, MediaKind: meta.MediaKindImage,
			Size: 12, MIMEType: "image/jpeg",
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.BaiduPhotoMapConsent{
			AssetID: asset.ID, OwnerID: uid, Revision: 1,
			AllowIndex: true, AllowBaiduConversion: true,
			ExpiresAt:    time.Now().UTC().Add(time.Hour),
			SourceNodeID: node.ID, SourceNodeRevision: 1,
			SourceMediaUpdatedAt: &row.UpdatedAt,
			SourceLatitude:       &rawLat, SourceLongitude: &rawLon,
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.BaiduPhotoMapPosition{
			AssetID: asset.ID, OwnerID: uid, PrimaryNodeID: node.ID,
			NodeRevision: 1, MediaUpdatedAt: row.UpdatedAt,
			ConsentRevision: 1, SourceLatitude: rawLat, SourceLongitude: rawLon,
			Latitude:          30.135 + float64(i)*0.00001,
			Longitude:         119.975 + float64(i)*0.00001,
			CoordinateSpace:   meta.BaiduPhotoMapSpaceBD09LL,
			ProjectionVersion: meta.BaiduPhotoMapProjectionGeoconvV2,
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
	read := func(endpoint, token string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet,
			"https://gallery.example.net"+endpoint, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		return response
	}
	bounds := "west=100&south=20&east=125&north=40&sort_by=captured&sort_dir=desc"
	readCells := func(token, suffix string) (baiduNativeMapCellsDTO, int) {
		t.Helper()
		response := read("/api/v1/media/places/baidu-jsapi/cells?"+bounds+suffix, token)
		var result baiduNativeMapCellsDTO
		if response.Code == http.StatusOK {
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
		}
		return result, response.Code
	}
	all, code := readCells(ownerToken, "")
	if code != http.StatusOK || all.TotalCount != 9 || len(all.Cells) != 1 {
		t.Fatalf("actual Gin Owner Cells expected 9 photos, code=%d count=%d", code, all.TotalCount)
	}
	favorites, code := readCells(ownerToken, "&favorite=true")
	if code != http.StatusOK || favorites.TotalCount != 3 || len(favorites.Cells) != 1 {
		t.Fatalf("actual Gin favorite Cells expected 3 photos, code=%d count=%d", code, favorites.TotalCount)
	}
	foreignPage, code := readCells(foreignToken, "")
	if code != http.StatusOK || foreignPage.TotalCount != 1 ||
		len(foreignPage.Cells) != 1 || foreignPage.Cells[0].AssetID == all.Cells[0].AssetID {
		t.Fatalf("actual Gin crossed Owner boundary, code=%d count=%d", code, foreignPage.TotalCount)
	}
	cellItems := func(token string, cell baiduPhotoMapCell, suffix string) (mediaItemRangeDTO, int) {
		t.Helper()
		query := fmt.Sprintf(
			"%s&cell_x=%d&cell_y=%d&asset_id=%d&node_id=%d&node_revision=%d&photo_count=%d&limit=10&offset=0&range=true%s",
			bounds, cell.CellX, cell.CellY, cell.AssetID, cell.NodeID,
			cell.NodeRevision, cell.PhotoCount, suffix,
		)
		response := read("/api/v1/media/places/baidu-jsapi/cell-items?"+query, token)
		var page mediaItemRangeDTO
		if response.Code == http.StatusOK {
			if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
				t.Fatal(err)
			}
		}
		return page, response.Code
	}
	items, code := cellItems(ownerToken, all.Cells[0], "")
	if code != http.StatusOK || items.TotalCount != 9 || len(items.Items) != 9 {
		t.Fatalf("actual Gin Cell Range returned wrong Owner count, code=%d count=%d", code, items.TotalCount)
	}
	onlyFav, code := cellItems(ownerToken, favorites.Cells[0], "&favorite=true")
	if code != http.StatusOK || onlyFav.TotalCount != 3 || len(onlyFav.Items) != 3 {
		t.Fatalf("actual Gin Favorite Cell Range returned wrong Count, code=%d count=%d", code, onlyFav.TotalCount)
	}
	if _, code := cellItems(foreignToken, all.Cells[0], ""); code == http.StatusOK {
		t.Fatal("cross-Owner representative authorized by original Gin Cell Range")
	}
	// A revoked authorization must make a previously accepted Cell claim stale.
	if err := db.Model(&meta.BaiduPhotoMapConsent{}).Where("asset_id = ?", first.ID).
		Update("revoked_at", time.Now().UTC()).Error; err != nil {
		t.Fatal(err)
	}
	if _, code := cellItems(ownerToken, all.Cells[0], ""); code == http.StatusOK {
		t.Fatal("revoked Owner Consent allowed a stale Gin Cell Range")
	}
	remaining, code := readCells(ownerToken, "")
	if code != http.StatusOK || remaining.TotalCount != 8 {
		t.Fatalf("revoked photo still counted by Owner Cells, code=%d count=%d", code, remaining.TotalCount)
	}
}
