//go:build linux

package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/version"
	"gorm.io/gorm"
)

// Only the opt-in request carries this marker into its PostgreSQL reads.
// No production handler, middleware or global test hook is modified.
type desktopMapInFlightNativeLogoutKey struct{}

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
		&meta.AdminServiceSecret{}, &meta.InternalServiceKeyAnchor{},
		&meta.PhotoCollection{}, &meta.BaiduMapScopeHandoff{},
		&meta.Node{}, &meta.File{}, &meta.FileVersion{}, &meta.MediaMetadata{},
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
		if err := db.Create(&meta.BaiduJSAPIMapEpoch{
			OwnerID: u.ID, Epoch: 3,
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
	const fakeSHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	const fakeCAS = "synthetic-map-cas-only"
	seedP04BrowserOwnerPhotoCells(t, db, owner.ID, "native-linked", 9, 3,
		fakeCAS, fakeSHA, 10)
	seedP04BrowserOwnerPhotoCells(t, db, foreign.ID, "foreign-linked", 1, 0,
		fakeCAS, fakeSHA, 10)
	const origin = "https://map.example.invalid:8443"
	s := &Server{DB: db,
		Auth:          auth.New("map-native-owner-cells-test-only", 15*time.Minute),
		RefreshTTL:    time.Hour,
		AllowedOrigin: origin,
	}
	// Genuine signed Server runtime is mandatory for protected /cells. The
	// synthetic internal AK is never sent to Baidu or exposed to a guest.
	keys, err := connectorsecret.NewKeyring(1, map[uint32]string{
		1: strings.Repeat("cd", 32),
	})
	if err != nil {
		t.Fatal(err)
	}
	s.ConnectorSecrets = keys
	keyVersion, encryptedAK, err := keys.Seal(
		baiduJSAPISecretAADID, baiduJSAPISecretKind,
		[]byte("SYNTHETIC_NATIVE_LINKED_CELLS_AK_NO_PROVIDER"),
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
	if err := s.EnsureBaiduJSAPI4InternalKeys(context.Background()); err != nil {
		t.Fatal(err)
	}
	priorCommit := version.Commit
	version.Commit = strings.Repeat("b", 40)
	defer func() { version.Commit = priorCommit }()
	if err := s.RefreshBaiduJSAPI4ManagedRelease(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer s.ClearBaiduJSAPI4OperatorRelease()

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
	// A JWT minted from the Agent's map grant must never become a generic
	// Owner bearer for Files, Notes, uploads, or Gallery mutations.
	for _, denied := range []struct{ method, route string }{
		{http.MethodGet, "/api/v1/nodes/root"},
		{http.MethodGet, "/api/v1/notes"},
		{http.MethodPost, "/api/v1/media/albums"},
		{http.MethodPost, "/api/v1/uploads"},
	} {
		got := request(denied.method, denied.route, browser.AccessToken, "", "")
		if got.Code != http.StatusForbidden {
			t.Fatalf("map-only browser JWT escaped %s %s: HTTP %d",
				denied.method, denied.route, got.Code)
		}
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
	// An independently authenticated Owner can read the map BEFORE Agent logout.
	// Later map revocation is Owner-wide by design; it must not be confused
	// with revoking this unrelated session's general-purpose Access JWT.
	if page, code := readCells(independent.AccessToken, ""); code != http.StatusOK ||
		page.TotalCount != 9 {
		t.Fatal("independent Owner map session was not live before Agent logout")
	}
	// A separate native Agent session proves the in-flight race: let the
	// mapped /cells handler finish its protected SQL while the original
	// token is live, pause its LAST Owner/epoch verification and revoke the
	// bound native RefreshToken before the HTTP response can be written.
	// Only a post-query native-lineage reread can deny that old result.
	raceNative, err := s.issueSession(db, owner)
	if err != nil {
		t.Fatal(err)
	}
	raceIssued := request(http.MethodPost, "/api/v1/auth/desktop-map/issue",
		raceNative.AccessToken,
		jsonBody("native_refresh_token", raceNative.RefreshToken), "")
	if raceIssued.Code != http.StatusOK {
		t.Fatalf("race native map grant HTTP %d", raceIssued.Code)
	}
	var raceGrant struct {
		Ticket string `json:"ticket"`
	}
	if err := json.Unmarshal(raceIssued.Body.Bytes(), &raceGrant); err != nil ||
		len(raceGrant.Ticket) != 64 {
		t.Fatal("race native map grant missing")
	}
	raceRedeem := request(http.MethodPost, "/api/v1/auth/desktop-map/redeem",
		"", jsonBody("ticket", raceGrant.Ticket), origin)
	if raceRedeem.Code != http.StatusOK {
		t.Fatalf("race map browser redemption HTTP %d", raceRedeem.Code)
	}
	var raceBrowser authResponse
	if err := json.Unmarshal(raceRedeem.Body.Bytes(), &raceBrowser); err != nil ||
		raceBrowser.AccessToken == "" {
		t.Fatal("race map browser JWT missing")
	}
	var epochChecks atomic.Int32
	entered := make(chan struct{})
	release := make(chan struct{})
	const nativeRaceHook = "test:hold_map_epoch_post_query_for_native_logout"
	if err := db.Callback().Query().After("gorm:query").Register(
		nativeRaceHook, func(tx *gorm.DB) {
			if tx.Statement.Context.Value(desktopMapInFlightNativeLogoutKey{}) != true ||
				tx.Statement.Table != "xd_baidu_jsapi_map_epochs" {
				return
			}
			if epochChecks.Add(1) == 2 {
				close(entered)
				<-release
			}
		},
	); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Callback().Query().Remove(nativeRaceHook) }()
	raceRequest := httptest.NewRequest(http.MethodGet, origin+cellsRoute, nil).
		WithContext(context.WithValue(context.Background(),
			desktopMapInFlightNativeLogoutKey{}, true))
	raceRequest.Header.Set("Authorization", "Bearer "+raceBrowser.AccessToken)
	responses := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, raceRequest)
		responses <- w
	}()
	select {
	case <-entered:
	case <-time.After(12 * time.Second):
		close(release)
		t.Fatal("real Gin /cells did not reach post-query epoch recheck")
	}
	terminal := db.Model(&meta.RefreshToken{}).
		Where("token_hash = ?", auth.HashRefreshToken(raceNative.RefreshToken)).
		Update("revoked_at", time.Now().UTC())
	if terminal.Error != nil || terminal.RowsAffected != 1 {
		close(release)
		t.Fatal("could not atomically revoke native RefreshToken while map query is in flight")
	}
	close(release)
	select {
	case result := <-responses:
		if result.Code != http.StatusForbidden {
			t.Fatalf("in-flight native logout exposed old map Cells: HTTP %d", result.Code)
		}
	case <-time.After(12 * time.Second):
		t.Fatal("revoked in-flight map request did not return")
	}
	if epochChecks.Load() != 2 {
		t.Fatalf("expected initial and post-query Owner epoch checks, got %d", epochChecks.Load())
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
	if got := request(http.MethodGet, "/api/v1/me", independent.AccessToken, "", ""); got.Code != http.StatusOK {
		t.Fatalf("Agent logout revoked an independent Owner login: HTTP %d", got.Code)
	}
	if _, code := readCells(independent.AccessToken, ""); code != http.StatusForbidden {
		t.Fatalf("Agent logout left a stale same-Owner map bearer usable: HTTP %d", code)
	}
	if page, code := readCells(other.AccessToken, ""); code != http.StatusOK ||
		page.TotalCount != 1 {
		t.Fatal("Agent logout accidentally revoked independent foreign Owner")
	}
}
