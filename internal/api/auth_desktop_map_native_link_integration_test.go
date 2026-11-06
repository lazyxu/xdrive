//go:build linux

package api

import (
	"encoding/json"
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

// Isolated PostgreSQL CI fixture only; never uses real Owner credentials.
func TestDesktopMapRedeemedBrowserFollowsNativeRotationAndLogout(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL fixture is not configured")
	}
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(&meta.User{}, &meta.RefreshToken{},
		&meta.DesktopMapGuestGrant{}, &meta.BaiduJSAPIMapEpoch{},
		&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	owner := meta.User{Username: "linked-map-" + uuid.NewString(),
		PasswordHash: "synthetic", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	s := &Server{DB: db, Auth: auth.New("desktop-map-native-linked-ci-secret", 15*time.Minute),
		RefreshTTL: time.Hour}
	native, err := s.issueSession(db, owner)
	if err != nil {
		t.Fatal(err)
	}
	normal, err := s.issueSession(db, owner)
	if err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/api/v1/auth/desktop-map/issue", s.requireAuth(), s.issueDesktopMapGuestGrant)
	router.POST("/api/v1/auth/desktop-map/redeem", s.redeemDesktopMapGuestGrant)
	router.POST("/api/v1/auth/refresh", s.refresh)
	router.POST("/api/v1/auth/browser/refresh", s.refresh)
	router.POST("/api/v1/auth/logout", s.logout)
	router.GET("/api/v1/me", s.requireAuth(), s.me)
	const origin = "https://drive.example.test:8443"
	jsonBody := func(key, value string) string {
		t.Helper()
		body, err := json.Marshal(map[string]string{key: value})
		if err != nil {
			t.Fatal(err)
		}
		return string(body)
	}
	call := func(path, body, bearer, requestOrigin, browserOwner string, cookie *http.Cookie) *httptest.ResponseRecorder {
		t.Helper()
		method := http.MethodPost
		if path == "/api/v1/me" {
			method = http.MethodGet
		}
		req := httptest.NewRequest(method, origin+path, strings.NewReader(body))
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
		if browserOwner != "" {
			req.Header.Set("X-XDrive-Browser-Owner", browserOwner)
		}
		if cookie != nil {
			req.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w
	}
	decode := func(w *httptest.ResponseRecorder) authResponse {
		t.Helper()
		if w.Code != http.StatusOK {
			t.Fatalf("response code=%d body=%s", w.Code, w.Body.String())
		}
		var session authResponse
		if err := json.Unmarshal(w.Body.Bytes(), &session); err != nil {
			t.Fatal(err)
		}
		return session
	}
	getCookie := func(w *httptest.ResponseRecorder) *http.Cookie {
		t.Helper()
		for _, cookie := range w.Result().Cookies() {
			if cookie.Name == browserRefreshCookieName {
				return cookie
			}
		}
		t.Fatal("missing HttpOnly browser refresh Cookie")
		return nil
	}
	issue := call("/api/v1/auth/desktop-map/issue",
		jsonBody("native_refresh_token", native.RefreshToken),
		native.AccessToken, "", "", nil)
	if issue.Code != http.StatusOK {
		t.Fatalf("native issuance failed %d: %s", issue.Code, issue.Body.String())
	}
	var grant map[string]any
	if err := json.Unmarshal(issue.Body.Bytes(), &grant); err != nil {
		t.Fatal(err)
	}
	ticket, ok := grant["ticket"].(string)
	if !ok || len(ticket) != 64 {
		t.Fatal("no one-use native map ticket")
	}
	redeem := call("/api/v1/auth/desktop-map/redeem",
		jsonBody("ticket", ticket), "", origin, "", nil)
	browser := decode(redeem)
	cookie := getCookie(redeem)
	claims, err := s.Auth.ParseClaims(browser.AccessToken)
	if err != nil || claims.DesktopMapNativeRefreshID == 0 ||
		claims.UserID != owner.ID || claims.SessionVersion != owner.SessionVersion {
		t.Fatalf("redeemed browser bearer not native-bound: %+v %v", claims, err)
	}
	var nativeRow meta.RefreshToken
	if err := db.Where("token_hash = ?",
		auth.HashRefreshToken(native.RefreshToken)).Take(&nativeRow).Error; err != nil {
		t.Fatal(err)
	}
	if claims.DesktopMapNativeRefreshID != nativeRow.ID {
		t.Fatal("browser bearer linked to the wrong Agent native session")
	}
	if w := call("/api/v1/me", "", browser.AccessToken, "", "", nil); w.Code != 200 {
		t.Fatalf("live map bearer denied: %d", w.Code)
	}
	if w := call("/api/v1/me", "", normal.AccessToken, "", "", nil); w.Code != 200 {
		t.Fatalf("independent session lost access: %d", w.Code)
	}
	// The mapped Cookie must not be promoted into an independent native JSON
	// refresh: only the same-Origin HttpOnly browser flow may rotate it.
	invalid := call("/api/v1/auth/refresh",
		jsonBody("refresh_token", cookie.Value), "", "", "", nil)
	if invalid.Code != 401 {
		t.Fatalf("native JSON refresh stripped native map binding: %d", invalid.Code)
	}
	browserNextResult := call("/api/v1/auth/browser/refresh", "", "", origin, owner.Username, cookie)
	browserNext := decode(browserNextResult)
	cookie = getCookie(browserNextResult)
	nextClaims, err := s.Auth.ParseClaims(browserNext.AccessToken)
	if err != nil || nextClaims.DesktopMapNativeRefreshID != nativeRow.ID {
		t.Fatalf("Cookie rotation lost native authority: %+v %v", nextClaims, err)
	}
	// A valid native refresh is a Server-recorded replacement chain, NOT a logout.
	nativeNext := decode(call("/api/v1/auth/refresh",
		jsonBody("refresh_token", native.RefreshToken), "", "", "", nil))
	if w := call("/api/v1/me", "", browserNext.AccessToken, "", "", nil); w.Code != 200 {
		t.Fatalf("native rotation wrongly revoked mapped browser bearer: %d", w.Code)
	}
	browserNextResult = call("/api/v1/auth/browser/refresh", "", "", origin, owner.Username, cookie)
	browserNext = decode(browserNextResult)
	cookie = getCookie(browserNextResult)
	nextClaims, err = s.Auth.ParseClaims(browserNext.AccessToken)
	if err != nil || nextClaims.DesktopMapNativeRefreshID != nativeRow.ID {
		t.Fatalf("second browser refresh lost native chain: %+v %v", nextClaims, err)
	}
	// Native logout is terminal. Even an ALREADY-issued browser Access JWT
	// must fail every protected endpoint, rather than remaining valid until TTL.
	logout := call("/api/v1/auth/logout",
		jsonBody("refresh_token", nativeNext.RefreshToken), "", "", "", nil)
	if logout.Code != http.StatusNoContent {
		t.Fatalf("native logout failed: %d %s", logout.Code, logout.Body.String())
	}
	if w := call("/api/v1/me", "", browserNext.AccessToken, "", "", nil); w.Code != 401 {
		t.Fatalf("native logout left map bearer active: %d", w.Code)
	}
	if w := call("/api/v1/auth/browser/refresh", "", "", origin, owner.Username, cookie); w.Code != 401 {
		t.Fatalf("native logout left map browser Cookie renewable: %d", w.Code)
	}
	if w := call("/api/v1/me", "", normal.AccessToken, "", "", nil); w.Code != 200 {
		t.Fatalf("native logout changed an independent Owner session: %d", w.Code)
	}
	// A newly granted map session is also revoked by an Owner session-version
	// change; a normal Browser Cookie must never silently upgrade its version.
	freshNative, err := s.issueSession(db, owner)
	if err != nil {
		t.Fatal(err)
	}
	freshGrant := call("/api/v1/auth/desktop-map/issue",
		jsonBody("native_refresh_token", freshNative.RefreshToken),
		freshNative.AccessToken, "", "", nil)
	if freshGrant.Code != 200 {
		t.Fatalf("new native ticket denied: %d", freshGrant.Code)
	}
	if err := json.Unmarshal(freshGrant.Body.Bytes(), &grant); err != nil {
		t.Fatal(err)
	}
	freshTicket, ok := grant["ticket"].(string)
	if !ok || len(freshTicket) != 64 {
		t.Fatal("second native ticket invalid")
	}
	freshRedeem := call("/api/v1/auth/desktop-map/redeem",
		jsonBody("ticket", freshTicket), "", origin, "", nil)
	freshBrowser := decode(freshRedeem)
	freshCookie := getCookie(freshRedeem)
	if err := db.Model(&meta.User{}).Where("id = ?", owner.ID).
		Update("session_version", uint64(2)).Error; err != nil {
		t.Fatal(err)
	}
	if w := call("/api/v1/me", "", freshBrowser.AccessToken, "", "", nil); w.Code != 401 {
		t.Fatalf("old map bearer survived Owner SessionVersion change: %d", w.Code)
	}
	if w := call("/api/v1/auth/browser/refresh", "", "", origin, owner.Username, freshCookie); w.Code != 401 {
		t.Fatalf("map Cookie bypassed Owner SessionVersion change: %d", w.Code)
	}
}
