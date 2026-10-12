package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// A cross-origin owner browser cannot inspect Retry-After unless the Server
// exposes that specific response header; same-origin tests do not catch this.
func TestMediaThumbnailRetryAfterCORSExposureIsOriginScoped(t *testing.T) {
	const allowedOrigin = "https://photos.example.test"
	server := &Server{AllowedOrigin: allowedOrigin}
	router := gin.New()
	router.Use(server.cors())
	router.GET("/media/thumbnail", func(c *gin.Context) {
		c.Header("Retry-After", "1")
		c.Header("Cache-Control", "private, no-store")
		c.Status(http.StatusServiceUnavailable)
	})

	check := func(origin string, allowed bool) {
		t.Helper()
		w := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/media/thumbnail", nil)
		if origin != "" {
			request.Header.Set("Origin", origin)
		}
		router.ServeHTTP(w, request)
		if w.Code != http.StatusServiceUnavailable {
			t.Fatalf("origin %q status=%d want=503", origin, w.Code)
		}
		if got := w.Header().Get("Retry-After"); got != "1" {
			t.Fatalf("origin %q Retry-After=%q want=1", origin, got)
		}
		if got := w.Header().Get("Cache-Control"); got != "private, no-store" {
			t.Fatalf("origin %q Cache-Control=%q", origin, got)
		}
		exposed := false
		for _, header := range strings.Split(w.Header().Get("Access-Control-Expose-Headers"), ",") {
			if strings.TrimSpace(header) == "Retry-After" {
				exposed = true
			}
		}
		if exposed != allowed {
			t.Fatalf("origin %q exposed Retry-After=%v want=%v", origin, exposed, allowed)
		}
		if got := w.Header().Get("Access-Control-Allow-Origin"); (got == allowedOrigin) != allowed {
			t.Fatalf("origin %q CORS allow-origin=%q allowed=%v", origin, got, allowed)
		}
	}

	check(allowedOrigin, true)
	check("https://untrusted.example.test", false)
	check("", false)
}
