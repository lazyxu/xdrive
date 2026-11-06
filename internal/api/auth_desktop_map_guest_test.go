package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestDesktopMapGuestStrictTicketAndNativeSecretParsing(t *testing.T) {
	const native = "native-only-refresh-secret-for-test"
	for _, valid := range []struct{ body, key, want string }{
		{`{"native_refresh_token":"` + native + `"}`, "native_refresh_token", native},
		{`{"ticket":"` + strings.Repeat("a", 64) + `"}`, "ticket", strings.Repeat("a", 64)},
	} {
		got, ok := desktopMapGuestField([]byte(valid.body), valid.key)
		if !ok || got != valid.want {
			t.Fatalf("valid parse %q: ok=%v", valid.key, ok)
		}
	}
	for _, body := range []string{
		"{}", "[]", "null", `{"ticket":null}`,
		`{"ticket":10}`, `{"ticket":""}`,
		`{"ticket":"valid","native_refresh_token":"unexpected"}`,
		`{"ticket":"a","ticket":"b"}`,
		`{"unknown":"value"}`, `{"ticket":"value"} trailing`,
	} {
		if _, ok := desktopMapGuestField([]byte(body), "ticket"); ok {
			t.Fatalf("accepted malformed map ticket JSON: %q", body)
		}
	}
	if _, ok := desktopMapGuestField([]byte(strings.Repeat("x", 1025)), "ticket"); ok {
		t.Fatal("accepted unbounded body")
	}
	for _, candidate := range []string{
		"", strings.Repeat("A", 64), strings.Repeat("0", 63),
		strings.Repeat("a", 65), strings.Repeat("g", 64),
	} {
		if _, ok := desktopMapGuestTicketHash(candidate); ok {
			t.Fatalf("accepted invalid one-use token %q", candidate)
		}
	}
	if hash, ok := desktopMapGuestTicketHash(strings.Repeat("a", 64)); !ok ||
		len(hash) != 64 || hash == strings.Repeat("a", 64) {
		t.Fatal("ticket is not hashed before persistence")
	}
	for _, host := range []string{"", "host/path", "user@host", "host?q", "host#f", "host space", ".host"} {
		if validDesktopMapGuestHost(host) {
			t.Fatalf("accepted invalid Server Host: %q", host)
		}
	}
	if !validDesktopMapGuestHost("drive.example.test:8443") {
		t.Fatal("legitimate pinned HTTPS Host rejected")
	}
}

func TestDesktopMapGuestRedeemRequiresSameOriginHTTPSBeforeDB(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server := &Server{}
	r := gin.New()
	r.POST("/api/v1/auth/desktop-map/redeem", server.redeemDesktopMapGuestGrant)
	const host = "https://drive.example.test:8443"
	for _, tc := range []struct {
		name, origin, fetchSite, authorization, body, contentType string
		want                                                      int
	}{
		{"missing Origin", "", "", "", "{}", "application/json", 403},
		{"cross origin", "https://attacker.example.net", "cross-site", "", "{}", "application/json", 403},
		{"http downgrade", "http://drive.example.test:8443", "", "", "{}", "application/json", 403},
		{"cross-site fetch", host, "cross-site", "", "{}", "application/json", 403},
		{"bearer forbidden", host, "same-origin", "Bearer stolen", "{}", "application/json", 403},
		{"bad content type", host, "same-origin", "", "{}", "text/plain", 403},
		{"duplicate ticket", host, "same-origin", "", `{"ticket":"a","ticket":"b"}`, "application/json", 400},
		{"missing ticket", host, "same-origin", "", "{}", "application/json", 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, host+"/api/v1/auth/desktop-map/redeem",
				strings.NewReader(tc.body))
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			if tc.fetchSite != "" {
				req.Header.Set("Sec-Fetch-Site", tc.fetchSite)
			}
			if tc.authorization != "" {
				req.Header.Set("Authorization", tc.authorization)
			}
			req.Header.Set("Content-Type", tc.contentType)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tc.want {
				t.Fatalf("status=%d want=%d: %s", w.Code, tc.want, w.Body.String())
			}
			if w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("rejected token cannot be cached")
			}
			if len(w.Result().Cookies()) != 0 {
				t.Fatal("invalid request minted a browser refresh cookie")
			}
		})
	}
}
