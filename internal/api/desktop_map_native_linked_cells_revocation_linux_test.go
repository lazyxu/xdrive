//go:build linux

package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

// Real PostgreSQL and real production Gin endpoints. This is the missing
// intersection of the existing native-linked browser JWT test (which used
// /me) and ordinary Owner BD09 Cell Range tests (which used unlinked JWTs).
// No real album, external SDK, image bytes or production credentials are used.
func TestDesktopMapNativeLinkedOwnerCellsRevokedWithAgentLogout(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("dedicated PostgreSQL 17 fixture required")
	}
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.DesktopMapGuestGrant{},
		&meta.BaiduJSAPIMapEpoch{}, &meta.AuditEvent{},
		&meta.Node{}, &meta.File{}, &meta.MediaMetadata{},
		&meta.MediaGroup{}, &meta.MediaGroupItem{}, &meta.PhotoAsset{},
		&meta.PhotoAssetOccurrence{}, &meta.PhotoAssetIdentityAlias{},
		&meta.PhotoEditRecipe{}, &meta.PhotoResource{}, &meta.PhotoMetadata{},
		&meta.BaiduPhotoMapConsent{}, &meta.BaiduPhotoMapPosition{},
	); err != nil {
		t.Fatal(err)
	}
	owner := meta.User{Username: "map-linked-cells-owner-" + uuid.NewString(),
		PasswordHash: "synthetic", Role: meta.UserRoleUser, SessionVersion: 1}
	foreign := meta.User{Username: "map-linked-cells-foreign-" + uuid.NewString(),
		PasswordHash: "synthetic", Role: meta.UserRoleUser, SessionVersion: 1}
	for _, u := range []*meta.User{&owner, &foreign} {
		if err := db.Create(u).Error; err != nil {
			t.Fatal(err)
		}
	}
	const fakeSHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	const fakeCAS = "synthetic-map-cas-only"
	seedP04BrowserOwnerPhotoCells(t, db, owner.ID, "native-linked", 9, 3,
		fakeCAS, fakeSHA, 10)
	seedP04BrowserOwnerPhotoCells(t, db, foreign.ID, "foreign-linked", 1, 0,
		fakeCAS, fakeSHA, 10)
	s := &Server{DB: db,
		Auth:       auth.New("map-native-owner-cells-test-only", 15*time.Minute),
		RefreshTTL: time.Hour,
	}
	native, err := s.issueSession(db, owner)
	if err != nil {
		t.Fatal(err)
	}
	independent, err := s.issueSession(db, owner)
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.issueSession(db, foreign)
	if err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	router := s.Router()
	const origin = "https://map.example.invalid:8443"
	request := func(method, route, bearer, body, requestOrigin string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, origin+route, strings.NewReader(body))
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if requestOrigin != "" {
			req.Header.Set("Origin", requestOrigin)
			req.Header.Set("Sec-Fetch-Site", "same-origin")
		}
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		return res
	}
	jsonBody := func(key, value string) string {
		t.Helper()
		encoded, err := json.Marshal(map[string]string{key: value})
		if err != nil {
			t.Fatal(err)
		}
		return string(encoded)
	}
	issued := request(http.MethodPost, "/api/v1/auth/desktop-map/issue",
		native.AccessToken, jsonBody("native_refresh_token", native.RefreshToken), "")
	if issued.Code != http.StatusOK {
		t.Fatalf("native map issue failed: HTTP %d", issued.Code)
	}
	var grant struct {
		Ticket string `json:"ticket"`
	}
	if err := json.Unmarshal(issued.Body.Bytes(), &grant); err != nil || len(grant.Ticket) != 64 {
		t.Fatal("native map ticket receipt absent")
	}
	redeemed := request(http.MethodPost, "/api/v1/auth/desktop-map/redeem",
		"", jsonBody("ticket", grant.Ticket), origin)
	if redeemed.Code != http.StatusOK {
		t.Fatalf("one-use map browser redeem failed: HTTP %d", redeemed.Code)
	}
	var browser authResponse
	if err := json.Unmarshal(redeemed.Body.Bytes(), &browser); err != nil ||
		browser.AccessToken == "" {
		t.Fatal("native-linked browser AccessJWT absent")
	}
	claims, err := s.Auth.ParseClaims(browser.AccessToken)
	if err != nil || claims.UserID != owner.ID ||
		claims.DesktopMapNativeRefreshID == 0 {
		t.Fatal("map browser token lost native session lineage")
	}
	const bounds = "west=100&south=20&east=125&north=40&sort_by=captured&sort_dir=desc"
	cellsRoute := "/api/v1/media/places/baidu-jsapi/cells?" + bounds
	readCells := func(bearer, suffix string) (baiduNativeMapCellsDTO, int) {
		t.Helper()
		got := request(http.MethodGet, cellsRoute+suffix, bearer, "", "")
		var page baiduNativeMapCellsDTO
		if got.Code == http.StatusOK {
			if err := json.Unmarshal(got.Body.Bytes(), &page); err != nil {
				t.Fatal(err)
			}
		}
		return page, got.Code
	}
	live, code := readCells(browser.AccessToken, "")
	if code != http.StatusOK || live.TotalCount != 9 || len(live.Cells) != 1 {
		t.Fatalf("native-linked browser did not read exact Owner Cells: HTTP %d count %d",
			code, live.TotalCount)
	}
	favorites, code := readCells(browser.AccessToken, "&favorite=true")
	if code != http.StatusOK || favorites.TotalCount != 3 || len(favorites.Cells) != 1 {
		t.Fatalf("native-linked browser did not preserve favorite scope: HTTP %d count %d",
			code, favorites.TotalCount)
	}
	foreignCells, code := readCells(other.AccessToken, "")
	if code != http.StatusOK || foreignCells.TotalCount != 1 ||
		foreignCells.Cells[0].AssetID == live.Cells[0].AssetID {
		t.Fatal("real map native link leaked the foreign Owner Cell")
	}
	cellRoute := func(cell baiduPhotoMapCell, suffix string) string {
		return fmt.Sprintf(
			"/api/v1/media/places/baidu-jsapi/cell-items?%s&cell_x=%d&cell_y=%d&asset_id=%d&node_id=%d&node_revision=%d&photo_count=%d&limit=10&offset=0&range=true%s",
			bounds, cell.CellX, cell.CellY, cell.AssetID, cell.NodeID,
			cell.NodeRevision, cell.PhotoCount, suffix)
	}
	ownerItemsPath := cellRoute(live.Cells[0], "")
	if got := request(http.MethodGet, ownerItemsPath,
		browser.AccessToken, "", ""); got.Code != http.StatusOK {
		t.Fatalf("linked browser protected cell-items failed: HTTP %d", got.Code)
	}
	if got := request(http.MethodGet, cellRoute(favorites.Cells[0], "&favorite=true"),
		browser.AccessToken, "", ""); got.Code != http.StatusOK {
		t.Fatalf("linked browser favorite cell-items failed: HTTP %d", got.Code)
	}
	if got := request(http.MethodGet, ownerItemsPath,
		other.AccessToken, "", ""); got.Code == http.StatusOK {
		t.Fatal("foreign Owner claimed source Owner Cell descriptor")
	}
	// Confirm native logout invalidates an ALREADY-MINTED browser bearer on
	// the real protected photo routes, not merely /me or cookie renewal.
	logout := request(http.MethodPost, "/api/v1/auth/logout", "",
		jsonBody("refresh_token", native.RefreshToken), "")
	if logout.Code != http.StatusNoContent {
		t.Fatalf("Agent native logout failed: HTTP %d", logout.Code)
	}
	for _, route := range []string{
		cellsRoute,
		cellsRoute + "&favorite=true",
		ownerItemsPath,
		cellRoute(favorites.Cells[0], "&favorite=true"),
		fmt.Sprintf("/api/v1/media/items/%d/thumbnail", live.Cells[0].NodeID),
		fmt.Sprintf("/api/v1/media/items/%d/viewer-preview", live.Cells[0].NodeID),
	} {
		got := request(http.MethodGet, route, browser.AccessToken, "", "")
		if got.Code != http.StatusUnauthorized {
			t.Fatalf("revoked map bearer reached protected photo endpoint: HTTP %d", got.Code)
		}
	}
	if got := request(http.MethodPost, "/api/v1/auth/desktop-map/issue",
		native.AccessToken, jsonBody("native_refresh_token", native.RefreshToken), ""); got.Code == http.StatusOK {
		t.Fatal("logged-out native Agent issued another map browser grant")
	}
	// An independently authenticated session for the same Owner is not part
	// of this revoked Agent's browser lineage; foreign Owner also survives.
	if page, code := readCells(independent.AccessToken, ""); code != http.StatusOK ||
		page.TotalCount != 9 {
		t.Fatal("Agent logout accidentally revoked an independent Owner session")
	}
	if page, code := readCells(other.AccessToken, ""); code != http.StatusOK ||
		page.TotalCount != 1 {
		t.Fatal("Agent logout accidentally revoked independent foreign Owner")
	}
}
