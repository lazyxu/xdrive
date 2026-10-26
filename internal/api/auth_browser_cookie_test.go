package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

const browserTestOrigin = "https://drive.example.test:8443"

func browserTestRequest(path, origin, site, body string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, browserTestOrigin+path, strings.NewReader(body))
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if site != "" {
		req.Header.Set("Sec-Fetch-Site", site)
	}
	req.Header.Set("Content-Type", "application/json")
	return req
}

func TestBrowserCookieOriginIsStrictSameHostHTTPS(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/v1/auth/browser/login", func(c *gin.Context) {
		if !requireBrowserAuthOrigin(c) {
			return
		}
		c.Status(http.StatusNoContent)
	})
	for _, tc := range []struct {
		name, origin, fetchSite string
		status                  int
	}{
		{"same-origin", browserTestOrigin, "same-origin", 204},
		{"legacy-WebKit-without-fetch-site", browserTestOrigin, "", 204},
		{"no-origin", "", "", 403},
		{"different-port", "https://drive.example.test", "", 403},
		{"different-host", "https://attacker.example.test:8443", "", 403},
		{"http-downgrade", "http://drive.example.test:8443", "", 403},
		{"origin-path", browserTestOrigin + "/bad", "", 403},
		{"origin-credentials", "https://owner@drive.example.test:8443", "", 403},
		{"cross-site-fetch", browserTestOrigin, "cross-site", 403},
		{"same-site-subdomain", browserTestOrigin, "same-site", 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			r.ServeHTTP(w, browserTestRequest("/api/v1/auth/browser/login", tc.origin, tc.fetchSite, "{}"))
			if w.Code != tc.status {
				t.Fatalf("status=%d, want=%d", w.Code, tc.status)
			}
			if w.Code == 403 && !strings.Contains(w.Header().Get("Cache-Control"), "no-store") {
				t.Fatal("rejection cannot be cached")
			}
		})
	}
}

func TestBrowserCookieIsHostOnlyHttpOnlyAndNoRefreshTokenJSON(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := &Server{RefreshTTL: 30 * 24 * time.Hour}
	r := gin.New()
	r.POST("/api/v1/auth/browser/login", func(c *gin.Context) {
		if !requireBrowserAuthOrigin(c) {
			return
		}
		s.replyBrowserAuthSession(c, authResponse{
			Token: "short-access", AccessToken: "short-access",
			RefreshToken: "never-in-body-secret",
			TokenType:    "Bearer", ExpiresIn: 900,
			RefreshExpiresIn: int64(s.RefreshTTL.Seconds()), Username: "owner",
		})
	})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, browserTestRequest("/api/v1/auth/browser/login", browserTestOrigin, "same-origin", "{}"))
	if w.Code != 200 {
		t.Fatalf("status %d", w.Code)
	}
	var dto map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &dto); err != nil {
		t.Fatal(err)
	}
	if dto["refresh_token"] == "never-in-body-secret" || w.Body.String() == "" || !strings.Contains(w.Body.String(), "\"browser_session\":true") {
		t.Fatal("browser response must expose access only, not refresh secret")
	}
	var found *http.Cookie
	for _, cookie := range w.Result().Cookies() {
		if cookie.Name == browserRefreshCookieName {
			found = cookie
		}
	}
	if found == nil || found.Value != "never-in-body-secret" ||
		!found.HttpOnly || !found.Secure || found.SameSite != http.SameSiteStrictMode ||
		found.Path != "/" || found.Domain != "" || found.MaxAge < 24*3600 {
		t.Fatalf("browser cookie security contract broken: %+v", found)
	}
	if cc := w.Header().Get("Cache-Control"); cc != "no-store" {
		t.Fatalf("sensitive response cache policy %q", cc)
	}
}

func TestBrowserRefreshAndLogoutNeverUseJSONBearerBodies(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := &Server{}
	r := gin.New()
	r.POST("/api/v1/auth/browser/refresh", s.refresh)
	r.POST("/api/v1/auth/browser/logout", s.logout)

	for _, path := range []string{"/api/v1/auth/browser/refresh", "/api/v1/auth/browser/logout"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, browserTestRequest(path, browserTestOrigin, "same-origin", `{"refresh_token":"malicious-json-bearer"}`))
		if w.Code != 400 {
			t.Fatalf("%s allowed mixing JSON bearer with browser cookie: %d", path, w.Code)
		}
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, browserTestRequest("/api/v1/auth/browser/refresh", browserTestOrigin, "same-origin", ""))
	if w.Code != 401 {
		t.Fatalf("browser refresh without cookie status %d", w.Code)
	}
	// Logout without a browser session is idempotent and actively expires
	// any stale cookie without requiring the database.
	w = httptest.NewRecorder()
	r.ServeHTTP(w, browserTestRequest("/api/v1/auth/browser/logout", browserTestOrigin, "same-origin", ""))
	if w.Code != 204 {
		t.Fatalf("browser logout without cookie status %d", w.Code)
	}
	for _, cookie := range w.Result().Cookies() {
		if cookie.Name == browserRefreshCookieName {
			if cookie.MaxAge != -1 || cookie.Value != "" || !cookie.HttpOnly || !cookie.Secure {
				t.Fatalf("cookie not expired securely: %+v", cookie)
			}
			return
		}
	}
	t.Fatal("missing refresh cookie revocation")
}
