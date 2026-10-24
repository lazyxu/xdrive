package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

const validBaiduScopeIssue = `{"target_mode":"isolated","scope":{"albumKey":"manual:Family","filters":{"sort_by":"captured","sort_dir":"desc","favorite":true,"asset_kind":"image","captured_from":"2026-01-01T00:00:00Z","captured_to":"2026-02-01T00:00:00Z","time_zone":"Asia/Tokyo"}}}`

func TestBaiduMapScopeHandoffStrictJSONAndMembership(t *testing.T) {
	accepted, err := baiduHandoffParseIssue([]byte(validBaiduScopeIssue))
	if err != nil || accepted.TargetMode != "isolated" || accepted.Scope.AlbumKey != "manual:Family" ||
		accepted.Scope.Filters.Favorite == nil || !*accepted.Scope.Filters.Favorite {
		t.Fatalf("exact filtered scope rejected: %#v %v", accepted, err)
	}
	for _, bad := range []string{
		"",
		`{"target_mode":"prototype","scope":{}}`,
		`{"target_mode":"isolated","scope":{"albumKey":"","filters":{"sort_by":"captured"}}}`,
		`{"target_mode":"unknown","scope":{"albumKey":"","filters":{"sort_by":"captured","sort_dir":"desc"}}}`,
		`{"target_mode":"isolated","target_mode":"prototype","scope":{"albumKey":"","filters":{"sort_by":"captured","sort_dir":"desc"}}}`,
		`{"target_mode":"isolated","scope":{"albumKey":"manual:Family","filters":{"sort_by":"captured","sort_dir":"desc","favorite":null}}}`,
		`{"target_mode":"isolated","scope":{"albumKey":"manual:Family","filters":{"sort_by":"captured","sort_dir":"desc","favorite":"true"}}}`,
		`{"target_mode":"isolated","scope":{"albumKey":"manual:Family","filters":{"sort_by":"captured","sort_dir":"desc","favorite":true,"favorite":false}}}`,
		`{"target_mode":"isolated","scope":{"albumKey":"manual:Family","filters":{"sort_by":"captured","sort_dir":"desc","bbox":"-1,-1,1,1"}}}`,
		`{"target_mode":"isolated","scope":{"albumKey":"manual:Family","filters":{"sort_by":"captured","sort_dir":"desc","fold_duplicates":true}}}`,
		`{"target_mode":"isolated","scope":{"albumKey":"manual:Family","filters":{"sort_by":"captured","sort_dir":"desc","asset_kind":"live_photo"}}}`,
		`{"target_mode":"isolated","scope":{"albumKey":"manual:Family","filters":{"sort_by":"captured","sort_dir":"desc","time_zone":"No/SuchZone"}}}`,
		`{"target_mode":"isolated","scope":{"albumKey":"manual:Family","filters":{"sort_by":"captured","sort_dir":"desc","captured_from":"2026-09-01T00:00:00Z","captured_to":"2026-01-01T00:00:00Z"}}}`,
		`{"target_mode":"isolated","scope":{"albumKey":"manual:Family","filters":{"sort_by":"captured","sort_dir":"desc","owner_id":2}}}`,
		`{"target_mode":"isolated","scope":{"albumKey":"manual:Family","filters":{"sort_by":"captured","sort_dir":"desc","latitude":39.9}}}`,
		`{"target_mode":"isolated","scope":{"albumKey":"manual:Family","filters":{"sort_by":"captured","sort_dir":"desc","token":"secret"}}}`,
		`{"target_mode":"isolated","scope":{"albumKey":"foreign-id","filters":{"sort_by":"captured","sort_dir":"desc"}}}`,
		`{"target_mode":"isolated","scope":{"albumKey":"manual:Family","filters":{"sort_by":"distance","sort_dir":"desc"}}}`,
		`{"target_mode":"isolated","scope":{"albumKey":"manual:Family","filters":{"sort_by":"captured","sort_dir":"descending"}}}`,
	} {
		if _, err := baiduHandoffParseIssue([]byte(bad)); err == nil {
			t.Errorf("unsafe scope accepted: %s", bad)
		}
	}
	good := `{"target_mode":"prototype","scope":{"albumKey":"","filters":{"sort_by":"added","sort_dir":"asc","favorite":false}},"camera":{"coordinate_space":"bd09ll","latitude":35.42,"longitude":119.2,"zoom":11}}`
	scope, err := baiduHandoffParseIssue([]byte(good))
	if err != nil || scope.TargetMode != "prototype" || scope.Scope.Filters.Favorite == nil ||
		*scope.Scope.Filters.Favorite {
		t.Fatalf("valid restricted prototype scope denied: %+v %v", scope, err)
	}
	if scope.Camera == nil || scope.Camera.CoordinateSpace != "bd09ll" ||
		scope.Camera.Latitude != 35.42 || scope.Camera.Zoom != 11 {
		t.Fatal("BD09 camera lost")
	}
	for _, badCamera := range []string{
		`"camera":{"coordinate_space":"wgs84","latitude":30,"longitude":120,"zoom":11}`,
		`"camera":{"coordinate_space":"bd09ll","latitude":90,"longitude":120,"zoom":11}`,
		`"camera":{"coordinate_space":"bd09ll","latitude":35,"longitude":190,"zoom":11}`,
		`"camera":{"coordinate_space":"bd09ll","latitude":35,"longitude":120,"zoom":18.5}`,
		`"camera":{"coordinate_space":"bd09ll","latitude":35,"longitude":120,"zoom":11,"ak":"secret"}`,
	} {
		candidate := strings.Replace(good,
			`"camera":{"coordinate_space":"bd09ll","latitude":35.42,"longitude":119.2,"zoom":11}`,
			badCamera, 1)
		if _, err := baiduHandoffParseIssue([]byte(candidate)); err == nil {
			t.Errorf("unsafe camera permitted: %s", badCamera)
		}
	}
}

func TestBaiduMapScopeHandoffConsumeStrictTicketAndMode(t *testing.T) {
	good := `{"target_mode":"prototype","ticket":"` + strings.Repeat("a", 64) + `"}`
	candidate, err := baiduHandoffParseConsume([]byte(good))
	if err != nil || candidate.TargetMode != "prototype" || len(candidate.Token) != 64 {
		t.Fatal(err)
	}
	for _, bad := range []string{
		strings.Replace(good, "prototype", "other", 1),
		strings.Replace(good, strings.Repeat("a", 64), strings.Repeat("A", 64), 1),
		strings.Replace(good, strings.Repeat("a", 64), strings.Repeat("a", 63), 1),
		strings.Replace(good, "}", `,"scope":{"filters":{"favorite":true}}}`, 1),
		strings.Replace(good, "}", `,"target_mode":"isolated"}`, 1),
	} {
		if _, err := baiduHandoffParseConsume([]byte(bad)); err == nil {
			t.Errorf("bad consume accepted %s", bad)
		}
	}
}

func TestBaiduMapScopeHandoffStrictOriginAndNoProviderLeak(t *testing.T) {
	route := baiduMapScopeHandoffPath
	mk := func(body, origin string) *http.Request {
		req := httptest.NewRequest(http.MethodPost, route, strings.NewReader(body))
		req.Header.Set("Origin", origin)
		req.Header.Set("Authorization", "Bearer test-secret")
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Sec-Fetch-Site", "same-origin")
		return req
	}
	good := mk(validBaiduScopeIssue, "https://gallery.example.org")
	if !baiduHandoffTransport(good, "https://gallery.example.org", route) {
		t.Fatal("same-origin Owner intent denied")
	}
	for _, edit := range []func(*http.Request){
		func(r *http.Request) { r.Header.Set("Origin", "https://evil.example.org") },
		func(r *http.Request) { r.Header.Add("Origin", "https://gallery.example.org") },
		func(r *http.Request) { r.Header.Set("Sec-Fetch-Site", "cross-site") },
		func(r *http.Request) { r.Header.Set("Proxy-Authorization", "secret") },
		func(r *http.Request) { r.Header.Set("X-Forwarded-User", "admin") },
		func(r *http.Request) { r.Header.Set("Content-Type", "text/plain") },
		func(r *http.Request) { r.Header.Del("Authorization") },
		func(r *http.Request) { r.URL.RawQuery = "owner_id=1" },
		func(r *http.Request) { r.URL.Path = baiduMapScopeConsumePath },
		func(r *http.Request) { r.Method = http.MethodGet },
		func(r *http.Request) { r.ContentLength = 2049 },
	} {
		bad := mk(validBaiduScopeIssue, "https://gallery.example.org")
		edit(bad)
		if baiduHandoffTransport(bad, "https://gallery.example.org", route) {
			t.Error("malformed transport accepted")
		}
	}
	gin.SetMode(gin.TestMode)
	s := &Server{AllowedOrigin: "https://gallery.example.org"}
	router := s.Router()
	for _, endpoint := range []string{baiduMapScopeHandoffPath, baiduMapScopeConsumePath} {
		found := false
		for _, rt := range router.Routes() {
			if rt.Method == "POST" && rt.Path == endpoint {
				found = true
			}
		}
		if !found {
			t.Fatalf("missing authenticated route %s", endpoint)
		}
		r := mk(validBaiduScopeIssue, "https://gallery.example.org")
		r.URL.Path = endpoint
		out := httptest.NewRecorder()
		router.ServeHTTP(out, r)
		if out.Code != http.StatusUnauthorized && out.Code != http.StatusServiceUnavailable &&
			out.Code != http.StatusForbidden {
			t.Fatalf("unauthorized scope bridge yielded %d", out.Code)
		}
		if strings.Contains(out.Body.String(), "test-secret") ||
			strings.Contains(out.Body.String(), "manual:Family") ||
			out.Header().Get("Set-Cookie") != "" {
			t.Fatal("non-released bridge leaked private scope")
		}
	}
}

func TestBaiduMapScopeHandoffUIPlainCalendarDates(t *testing.T) {
	// The actual current map uses HTML date inputs, never timestamp inputs.
	raw := strings.Replace(validBaiduScopeIssue, "2026-01-01T00:00:00Z", "2026-01-01", 1)
	raw = strings.Replace(raw, "2026-02-01T00:00:00Z", "2026-02-01", 1)
	accepted, err := baiduHandoffParseIssue([]byte(raw))
	if err != nil || accepted.Scope.Filters.CapturedFrom != "2026-01-01" ||
		accepted.Scope.Filters.CapturedTo != "2026-02-01" {
		t.Fatalf("current date-filtered map scope failed mode handoff: %+v %v", accepted, err)
	}
	for _, bad := range []string{"2026-02-30", "2025-12-31"} {
		invalid := strings.Replace(raw, "2026-02-01", bad, 1)
		if _, err := baiduHandoffParseIssue([]byte(invalid)); err == nil {
			t.Errorf("invalid or reversed calendar range accepted: %q", bad)
		}
	}
}
