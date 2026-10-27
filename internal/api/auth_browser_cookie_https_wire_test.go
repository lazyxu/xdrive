//go:build linux

package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

// Exercise the real Gin/PostgreSQL rotation logic over an actual TLS socket.
// The browser-side Chromium test is separate: net/http alone cannot prove Web Locks.
func TestBrowserCookieHTTPSWireOwnerAndReplay(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL test database is not configured")
	}
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(&meta.User{}, &meta.RefreshToken{},
		&meta.AuditEvent{}, &meta.BaiduJSAPIMapEpoch{}); err != nil {
		t.Fatal(err)
	}
	const username = "browser-cookie-https-wire"
	const password = "HTTPS-Wire-Only-2026!"
	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	owner := meta.User{Username: username, PasswordHash: hash,
		Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	service := &Server{DB: db,
		Auth:       auth.New("isolated-browser-cookie-https-wire", 15*time.Minute),
		RefreshTTL: time.Hour,
	}
	gin.SetMode(gin.TestMode)
	routes := gin.New()
	for _, prefix := range []string{"/api/v1/auth", "/api/v1/auth/browser"} {
		routes.POST(prefix+"/login", service.login)
		routes.POST(prefix+"/refresh", service.refresh)
		routes.POST(prefix+"/logout", service.logout)
	}
	tlsServer := httptest.NewTLSServer(routes)
	defer tlsServer.Close()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	browser := tlsServer.Client()
	browser.Jar = jar
	browser.Timeout = 10 * time.Second
	raw := tlsServer.Client()
	raw.Timeout = 10 * time.Second
	baseURL, err := url.Parse(tlsServer.URL)
	if err != nil {
		t.Fatal(err)
	}
	// All headers and paths are test-generated. Never contact a production xDrive.
	post := func(client *http.Client, path, origin, ownerHint, site, body string,
		manualCookie *http.Cookie) (*http.Response, []byte) {
		t.Helper()
		req, err := http.NewRequest(http.MethodPost, tlsServer.URL+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		if site != "" {
			req.Header.Set("Sec-Fetch-Site", site)
		}
		if ownerHint != "" {
			req.Header.Set("X-XDrive-Browser-Owner", ownerHint)
		}
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		if manualCookie != nil {
			req.AddCookie(manualCookie)
		}
		response, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		data, err := io.ReadAll(io.LimitReader(response.Body, 8192))
		if err != nil {
			t.Fatal(err)
		}
		return response, data
	}
	parseSession := func(data []byte) authResponse {
		t.Helper()
		var value authResponse
		if err := json.Unmarshal(data, &value); err != nil {
			t.Fatalf("invalid auth response JSON: %v", err)
		}
		return value
	}
	getRefreshCookie := func(response *http.Response) *http.Cookie {
		t.Helper()
		for _, cookie := range response.Cookies() {
			if cookie.Name == browserRefreshCookieName {
				return cookie
			}
		}
		t.Fatal("missing browser refresh Set-Cookie")
		return nil
	}
	jarToken := func() string {
		for _, cookie := range jar.Cookies(baseURL) {
			if cookie.Name == browserRefreshCookieName {
				return cookie.Value
			}
		}
		return ""
	}

	login, data := post(browser, "/api/v1/auth/browser/login", tlsServer.URL, "",
		"same-origin", `{"username":"`+username+`","password":"`+password+`"}`, nil)
	if login.StatusCode != http.StatusOK {
		t.Fatalf("TLS browser login status %d", login.StatusCode)
	}
	first := getRefreshCookie(login)
	loggedIn := parseSession(data)
	if !loggedIn.BrowserSession || loggedIn.RefreshToken != "" ||
		loggedIn.AccessToken == "" || strings.Contains(string(data), first.Value) ||
		!first.Secure || !first.HttpOnly || first.SameSite != http.SameSiteStrictMode ||
		first.Domain != "" || first.Path != "/" || jarToken() != first.Value {
		t.Fatal("real TLS browser login leaked Refresh or violated host-only cookie policy")
	}
	if login.Header.Get("Cache-Control") != "no-store" {
		t.Fatal("browser auth response must never be cached")
	}

	// The original JSON protocol must remain independently usable by natives.
	nativeLogin, nativeData := post(raw, "/api/v1/auth/login", "", "", "",
		`{"username":"`+username+`","password":"`+password+`"}`, nil)
	native := parseSession(nativeData)
	if nativeLogin.StatusCode != http.StatusOK || native.BrowserSession || native.RefreshToken == "" {
		t.Fatalf("original JSON authentication changed, HTTP %d", nativeLogin.StatusCode)
	}
	for _, cookie := range nativeLogin.Cookies() {
		if cookie.Name == browserRefreshCookieName {
			t.Fatal("native authentication acquired browser cookie")
		}
	}

	// A foreign Origin, Fetch Metadata or Owner must not consume the valid token.
	negative := []struct {
		name, origin, owner, site string
		want                      int
	}{
		{"wrong-origin", "https://attacker.invalid", username, "cross-site", http.StatusForbidden},
		{"wrong-fetch-site", tlsServer.URL, username, "same-site", http.StatusForbidden},
		{"wrong-owner", tlsServer.URL, "different-owner", "same-origin", http.StatusConflict},
	}
	for _, tc := range negative {
		t.Run(tc.name, func(t *testing.T) {
			response, _ := post(browser, "/api/v1/auth/browser/refresh", tc.origin,
				tc.owner, tc.site, "", nil)
			if response.StatusCode != tc.want || jarToken() != first.Value {
				t.Fatalf("negative browser refresh HTTP %d; cookie must not rotate", response.StatusCode)
			}
		})
	}
	response, _ := post(browser, "/api/v1/auth/browser/refresh", tlsServer.URL,
		username, "same-origin", `{"refresh_token":"forbidden"}`, nil)
	if response.StatusCode != http.StatusBadRequest || jarToken() != first.Value {
		t.Fatal("Cookie endpoint accepted JSON refresh secret or rotated on bad request")
	}

	refresh, rotatedData := post(browser, "/api/v1/auth/browser/refresh", tlsServer.URL,
		username, "same-origin", "", nil)
	second := getRefreshCookie(refresh)
	rotated := parseSession(rotatedData)
	if refresh.StatusCode != http.StatusOK || second.Value == first.Value ||
		rotated.RefreshToken != "" || !rotated.BrowserSession || jarToken() != second.Value {
		t.Fatal("TLS refresh did not rotate the HttpOnly credential")
	}
	// An old tab/replay explicitly sending the previous credential must be rejected.
	replay, _ := post(raw, "/api/v1/auth/browser/refresh", tlsServer.URL,
		username, "same-origin", "", first)
	if replay.StatusCode != http.StatusUnauthorized || jarToken() != second.Value {
		t.Fatalf("consumed Cookie replay status %d", replay.StatusCode)
	}
	logout, _ := post(browser, "/api/v1/auth/browser/logout", tlsServer.URL,
		username, "same-origin", "", nil)
	if logout.StatusCode != http.StatusNoContent || getRefreshCookie(logout).MaxAge != -1 || jarToken() != "" {
		t.Fatalf("TLS cookie logout did not clear client credential: %d", logout.StatusCode)
	}
	unavailable, _ := post(browser, "/api/v1/auth/browser/refresh", tlsServer.URL,
		username, "same-origin", "", nil)
	if unavailable.StatusCode != http.StatusUnauthorized {
		t.Fatal("logged out Cookie was restored")
	}
	nativeRefresh, nativeRotatedData := post(raw, "/api/v1/auth/refresh", "", "", "",
		`{"refresh_token":"`+native.RefreshToken+`"}`, nil)
	if nativeRefresh.StatusCode != http.StatusOK || parseSession(nativeRotatedData).RefreshToken == "" {
		t.Fatalf("Cookie logout invalidated unrelated native JSON token: %d", nativeRefresh.StatusCode)
	}
}
