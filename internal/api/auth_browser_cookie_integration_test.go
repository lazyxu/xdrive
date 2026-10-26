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
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

// Uses an isolated PostgreSQL test schema, never an actual xDrive Owner.
// Run with XD_TEST_DATABASE_URL; otherwise the pure cookie/origin tests still run.
func TestBrowserCookieAndNativeJSONAuthHaveIndependentTransports(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL integration database not configured")
	}
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.AuditEvent{}, &meta.BaiduJSAPIMapEpoch{},
	); err != nil {
		t.Fatal(err)
	}
	const password = "CookieFixture-only-2026!"
	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	user := meta.User{Username: "browser-cookie-fixture", PasswordHash: hash,
		Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	s := &Server{DB: db, Auth: auth.New("isolated-browser-cookie-fixture", time.Minute*15),
		RefreshTTL: time.Hour * 24, AllowedOrigin: browserTestOrigin}
	gin.SetMode(gin.TestMode)
	router := gin.New()
	for _, prefix := range []string{"/api/v1/auth", "/api/v1/auth/browser"} {
		router.POST(prefix+"/login", s.login)
		router.POST(prefix+"/refresh", s.refresh)
		router.POST(prefix+"/logout", s.logout)
	}
	router.POST("/api/v1/me/change-password/browser", s.requireAuth(), s.changePassword)
	makeRequest := func(path string, browser bool, data string, cookie *http.Cookie) *httptest.ResponseRecorder {
		t.Helper()
		w := httptest.NewRecorder()
		req := browserTestRequest(path, "", "", data)
		if browser {
			req.Header.Set("Origin", browserTestOrigin)
			req.Header.Set("Sec-Fetch-Site", "same-origin")
		}
		if cookie != nil {
			req.AddCookie(cookie)
		}
		router.ServeHTTP(w, req)
		return w
	}
	getCookie := func(w *httptest.ResponseRecorder) *http.Cookie {
		t.Helper()
		for _, c := range w.Result().Cookies() {
			if c.Name == browserRefreshCookieName {
				return c
			}
		}
		t.Fatal("missing browser-only HttpOnly refresh cookie")
		return nil
	}
	parse := func(w *httptest.ResponseRecorder) authResponse {
		t.Helper()
		var result authResponse
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}

	browser := makeRequest("/api/v1/auth/browser/login", true,
		`{"username":"browser-cookie-fixture","password":"CookieFixture-only-2026!"}`, nil)
	if browser.Code != 200 {
		t.Fatalf("browser login status %d: %s", browser.Code, browser.Body.String())
	}
	s1, c1 := parse(browser), getCookie(browser)
	if !s1.BrowserSession || s1.RefreshToken != "" || s1.AccessToken == "" || c1.Value == "" {
		t.Fatal("browser login leaked durable token or omitted short access token")
	}
	native := makeRequest("/api/v1/auth/login", false,
		`{"username":"browser-cookie-fixture","password":"CookieFixture-only-2026!"}`, nil)
	if native.Code != 200 {
		t.Fatalf("native login %d", native.Code)
	}
	n1 := parse(native)
	if n1.BrowserSession || n1.RefreshToken == "" {
		t.Fatal("native JSON refresh contract changed")
	}
	for _, cookie := range native.Result().Cookies() {
		if cookie.Name == browserRefreshCookieName {
			t.Fatal("native login unexpectedly acquired browser cookie")
		}
	}

	// A stale tab must never rotate the ambient Cookie of a different Owner.
	mismatchRefresh := browserTestRequest("/api/v1/auth/browser/refresh",
		browserTestOrigin, "same-origin", "")
	mismatchRefresh.AddCookie(c1)
	mismatchRefresh.Header.Set("X-XDrive-Browser-Owner", "stale-owner")
	mismatch := httptest.NewRecorder()
	router.ServeHTTP(mismatch, mismatchRefresh)
	if mismatch.Code != 409 {
		t.Fatalf("mismatched Owner refreshed another Owner's Cookie: %d", mismatch.Code)
	}
	refresh := makeRequest("/api/v1/auth/browser/refresh", true, "", c1)
	if refresh.Code != 200 {
		t.Fatalf("browser refresh status %d: %s", refresh.Code, refresh.Body.String())
	}
	s2, c2 := parse(refresh), getCookie(refresh)
	if !s2.BrowserSession || s2.RefreshToken != "" || c2.Value == c1.Value {
		t.Fatal("browser refresh did not rotate the secret without JSON disclosure")
	}
	old := makeRequest("/api/v1/auth/browser/refresh", true, "", c1)
	if old.Code != 401 {
		t.Fatalf("old refresh token was reusable, status %d", old.Code)
	}
	cross := makeRequest("/api/v1/auth/browser/logout", false, "", c2)
	if cross.Code != 403 {
		t.Fatalf("cross-site or missing origin could revoke cookie, status %d", cross.Code)
	}
	mismatchLogout := browserTestRequest("/api/v1/auth/browser/logout",
		browserTestOrigin, "same-origin", "")
	mismatchLogout.AddCookie(c2)
	mismatchLogout.Header.Set("X-XDrive-Browser-Owner", "stale-owner")
	mismatch = httptest.NewRecorder()
	router.ServeHTTP(mismatch, mismatchLogout)
	if mismatch.Code != 409 {
		t.Fatalf("mismatched Owner revoked another Owner's Cookie: %d", mismatch.Code)
	}
	logout := makeRequest("/api/v1/auth/browser/logout", true, "", c2)
	if logout.Code != 204 || getCookie(logout).MaxAge != -1 {
		t.Fatalf("browser logout failed to clear cookie, status %d", logout.Code)
	}
	invalid := makeRequest("/api/v1/auth/browser/refresh", true, "", c2)
	if invalid.Code != 401 {
		t.Fatalf("revoked browser credential accepted, status %d", invalid.Code)
	}
	nativeRefresh := makeRequest("/api/v1/auth/refresh", false,
		`{"refresh_token":"`+n1.RefreshToken+`"}`, nil)
	if nativeRefresh.Code != 200 || strings.TrimSpace(parse(nativeRefresh).RefreshToken) == "" {
		t.Fatalf("browser cookie logout incorrectly revoked independent native session: %d", nativeRefresh.Code)
	}

	// Re-authenticate with a fresh browser cookie; password change must revoke
	// all old sessions AND return the replacement refresh credential ONLY in
	// HttpOnly Set-Cookie (even when mandatory password change is active).
	fresh := makeRequest("/api/v1/auth/browser/login", true,
		`{"username":"browser-cookie-fixture","password":"CookieFixture-only-2026!"}`, nil)
	if fresh.Code != 200 {
		t.Fatalf("browser login for password change %d", fresh.Code)
	}
	passwordReq := browserTestRequest("/api/v1/me/change-password/browser",
		browserTestOrigin, "same-origin",
		`{"current_password":"CookieFixture-only-2026!","new_password":"CookieFixture-only-Changed-2026!"}`)
	passwordReq.Header.Set("Authorization", "Bearer "+parse(fresh).AccessToken)
	beforePassword := getCookie(fresh)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, passwordReq)
	if w.Code != 200 {
		t.Fatalf("browser password change %d: %s", w.Code, w.Body.String())
	}
	next := parse(w)
	if !next.BrowserSession || next.RefreshToken != "" || next.AccessToken == "" {
		t.Fatal("password change returned an exposed durable bearer")
	}
	if replacement := getCookie(w); replacement.Value == beforePassword.Value {
		t.Fatal("password change did not replace the browser cookie")
	}
	replayed := makeRequest("/api/v1/auth/browser/refresh", true, "", beforePassword)
	if replayed.Code != 401 {
		t.Fatalf("old cookie after password change was accepted: %d", replayed.Code)
	}
}
