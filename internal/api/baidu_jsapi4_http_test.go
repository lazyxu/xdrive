package api

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
)

// Actual Gin handler tests (not a forged authorized mock). A static Browser
// AK setting, or a supplied synthetic Ed25519 proof, cannot create a public
// session, a Cookie or real Server→Baidu traffic while the pinned signer and
// complete child policy are absent.
func TestBaiduJSAPI4HTTPDenyByDefaultNoCredentialLeak(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := &Server{AllowedOrigin: "https://gallery.example.invalid"}
	r := gin.New()
	r.GET("/_BMapService/api", s.baiduJSAPI4LoaderHTTP)
	r.POST("/api/v1/media/places/baidu-jsapi/session", s.baiduJSAPI4SessionHTTP)
	tests := []struct {
		name, method, target string
		headers              map[string]string
		cookie               string
		want                 int
	}{
		{
			name: "loader no map Cookie", method: "GET",
			target: "/_BMapService/api?v=4.0", want: http.StatusServiceUnavailable,
		},
		{
			name: "loader with untrusted injected cookie", method: "GET",
			target: "/_BMapService/api?v=4.0", cookie: "XD_BMAP_SESSION=forged",
			want: http.StatusServiceUnavailable,
		},
		{
			name: "AK injected query denied", method: "GET",
			target: "/_BMapService/api?v=4.0&ak=secret_canary",
			want:   http.StatusServiceUnavailable,
		},
		{
			name: "unknown child never routed", method: "GET",
			target: "/_BMapService/tile/1/2/3.png",
			want:   http.StatusNotFound,
		},
		{
			name: "unreviewed alternate loader", method: "GET",
			target: "/_BMapService/api?v=3.0",
			want:   http.StatusServiceUnavailable,
		},
		{
			name: "Legacy Gallery cookie mint always denied without Bearer", method: "POST",
			target: "/api/v1/media/places/baidu-jsapi/session",
			want:   http.StatusForbidden,
		},
		{
			name: "Session cannot mint from bearer alone", method: "POST",
			target: "/api/v1/media/places/baidu-jsapi/session",
			headers: map[string]string{
				"Authorization": "Bearer synthetic-does-not-grant-runtime",
				"Origin":        "https://gallery.example.invalid",
			},
			want: http.StatusForbidden,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(tc.method, tc.target, nil)
			for key, value := range tc.headers {
				request.Header.Set(key, value)
			}
			if tc.cookie != "" {
				request.Header.Set("Cookie", tc.cookie)
			}
			out := httptest.NewRecorder()
			r.ServeHTTP(out, request)
			if out.Code != tc.want {
				t.Fatalf("status=%d want=%d", out.Code, tc.want)
			}
			if strings.Contains(out.Body.String(), "secret_canary") ||
				strings.Contains(out.Body.String(), "synthetic-does-not-grant-runtime") ||
				out.Header().Get("Set-Cookie") != "" {
				t.Fatal("untrusted map request emitted credentials or Cookie")
			}
			if tc.want == http.StatusServiceUnavailable || tc.want == http.StatusForbidden {
				if out.Header().Get("Cache-Control") != "private, no-store" ||
					out.Header().Get("Referrer-Policy") != "no-referrer" ||
					out.Header().Get("X-Content-Type-Options") != "nosniff" {
					t.Fatal("map deny response is cacheable or leaks referrers")
				}
			}
		})
	}
}

// The legacy route is a hard-deny tombstone even if the Owner supplies
// syntactically valid session headers. Map-only cookies must be minted by
// the separate child redemption endpoint, never by trusted Gallery JS.
//
// A default Server cannot be armed by any test-style self-described authority
// even if the adversary supplies a strong Cookie key and matching origin hash.
// No public API accepts these arguments.
func TestBaiduJSAPI4ReleaseProvisionIsPinnedNotAdminBoolean(t *testing.T) {
	s := &Server{AllowedOrigin: "https://gallery.example.invalid"}
	key := bytes.Repeat([]byte{7}, 32)
	if err := s.InstallBaiduJSAPI4OperatorRelease(context.Background(),
		key, baidumapjsapi.JSAPI4ReleaseAttestation{},
		baidumapjsapi.JSAPI4ReleaseScope{}); err == nil {
		t.Fatal("untrusted release provisioned")
	}
	if _, err := s.currentBaiduJSAPI4OperatorRelease(context.Background()); err == nil {
		t.Fatal("untrusted production runtime became visible")
	}
	s.ClearBaiduJSAPI4OperatorRelease()
	if s.baiduJSAPI4Authority.Load() != nil {
		t.Fatal("kill switch failed to revoke private release")
	}
}

// Verify the real Router dispatches the single bounded official provider
// serviceHost family INSIDE Go; no Caddy-proxied arbitrary upstream.
func TestBaiduJSAPI4RouterRestrictsOnlyExactLoaderAndAuthenticatedSession(t *testing.T) {
	s := &Server{}
	routes := s.Router().Routes()
	paths := make(map[string]bool)
	for _, route := range routes {
		paths[route.Method+" "+route.Path] = true
	}
	for _, name := range []string{
		"GET /_BMapService/*resource",
		"POST /api/v1/media/places/baidu-jsapi/session",
	} {
		if !paths[name] {
			t.Fatalf("expected reviewed route %s absent", name)
		}
	}
	for name := range paths {
		if strings.HasPrefix(name, "GET /_BMapService/") &&
			name != "GET /_BMapService/*resource" {
			t.Fatalf("unexpected parallel map proxy route: %s", name)
		}
	}
}

// The child HTTP handler is production-shaped, but it cannot be armed via
// an untrusted route. Only the reviewed source table can register routes.
func TestBaiduJSAPI4ChildHandlerHardDeniesWithoutReviewedSourceRelease(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := &Server{AllowedOrigin: "https://gallery.example.invalid"}
	r := gin.New()
	r.GET("/_BMapService/tiles/test.png", s.baiduJSAPI4ChildHTTP)
	for _, path := range []string{
		"/_BMapService/tiles/test.png?x=1",
		"/_BMapService/tiles/test.png?ak=secret_canary",
	} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Cookie", "XD_BMAP_SESSION=forged")
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusServiceUnavailable ||
			rec.Header().Get("Cache-Control") != "private, no-store" ||
			rec.Header().Get("Set-Cookie") != "" ||
			strings.Contains(rec.Body.String(), "secret_canary") {
			t.Fatal("unreviewed child exposed content or a private cookie")
		}
	}
}

// A source-reviewed provider family is ONLY a route shape. An unauthenticated
// or forged map Cookie cannot fetch a single JS, tile or font byte from it.
func TestBaiduJSAPI4BoundedProviderRouteHardDeniesWithoutSignedOwner(t *testing.T) {
	s := &Server{AllowedOrigin: "https://gallery.example.invalid"}
	router := s.Router()
	for _, path := range []string{
		"/_BMapService/api?v=4.0",
		"/_BMapService/tiles/2.png?x=1&y=2",
		"/_BMapService/assets/script.js?v=4.0",
	} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Cookie", "XD_BMAP_SESSION=forged")
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusServiceUnavailable ||
			rec.Header().Get("Cache-Control") != "private, no-store" ||
			rec.Header().Get("Set-Cookie") != "" {
			t.Fatalf("unauthorized map resource exposed: %s status=%d", path, rec.Code)
		}
	}
}
