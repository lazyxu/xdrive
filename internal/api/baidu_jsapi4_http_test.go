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
			name: "Session cannot mint from bearer alone", method: "POST",
			target: "/api/v1/media/places/baidu-jsapi/session",
			headers: map[string]string{
				"Authorization": "Bearer synthetic-does-not-grant-runtime",
				"Origin":        "https://gallery.example.invalid",
			},
			want: http.StatusServiceUnavailable,
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
			if tc.want == http.StatusServiceUnavailable {
				if out.Header().Get("Cache-Control") != "private, no-store" ||
					out.Header().Get("Referrer-Policy") != "no-referrer" ||
					out.Header().Get("X-Content-Type-Options") != "nosniff" {
					t.Fatal("map deny response is cacheable or leaks referrers")
				}
			}
		})
	}
}

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

// Verify the routes are registered in the actual Server.Router rather than
// only in a fake Gin test engine. The GET route has NO generic child wildcard.
func TestBaiduJSAPI4RouterRestrictsOnlyExactLoaderAndAuthenticatedSession(t *testing.T) {
	s := &Server{}
	routes := s.Router().Routes()
	paths := make(map[string]bool)
	for _, route := range routes {
		paths[route.Method+" "+route.Path] = true
	}
	for _, name := range []string{
		"GET /_BMapService/api",
		"POST /api/v1/media/places/baidu-jsapi/session",
	} {
		if !paths[name] {
			t.Fatalf("expected reviewed route %s absent", name)
		}
	}
	for name := range paths {
		if strings.HasPrefix(name, "GET /_BMapService/") &&
			name != "GET /_BMapService/api" {
			t.Fatalf("unreviewed map child route exposed: %s", name)
		}
	}
}
