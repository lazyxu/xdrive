package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// Reject missing Cookie and forged parameters before a DB query is possible.
func TestDesktopMapBrowserSessionProbeAdmissionBeforeDB(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/v1/auth/desktop-map/session", (&Server{}).desktopMapBrowserSessionProbe)
	const origin = "https://drive.example.test:8443"
	for _, tc := range []struct {
		name, requestOrigin, owner, body, bearer string
		want int
	}{
		{"no origin", "", "owner", "", "", 403},
		{"cross origin", "https://attacker.test", "owner", "", "", 403},
		{"no owner", origin, "", "", "", 403},
		{"nonempty body", origin, "owner", "{}", "", 403},
		{"bearer", origin, "owner", "", "Bearer browser-access", 403},
		{"missing Cookie", origin, "owner", "", "", 401},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost,
				origin+"/api/v1/auth/desktop-map/session", strings.NewReader(tc.body))
			if tc.requestOrigin != "" {
				req.Header.Set("Origin", tc.requestOrigin)
			}
			if tc.owner != "" {
				req.Header.Set("X-XDrive-Browser-Owner", tc.owner)
			}
			if tc.bearer != "" {
				req.Header.Set("Authorization", tc.bearer)
			}
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tc.want {
				t.Fatalf("status=%d want=%d: %s", w.Code, tc.want, w.Body.String())
			}
			if w.Header().Get("Cache-Control") != "no-store" ||
				len(w.Result().Cookies()) != 0 {
				t.Fatal("session probe was cacheable or leaked a Cookie")
			}
		})
	}
}
