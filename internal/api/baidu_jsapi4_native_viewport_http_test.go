package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestBaiduNativeViewportStrictBD09Query(t *testing.T) {
	good := "west=116&south=39&east=117&north=41&limit=100&offset=0"
	b, n, offset, err := parseBaiduNativeMapViewport(good)
	if err != nil || b.CoordinateSpace != meta.BaiduPhotoMapSpaceBD09LL ||
		b.West != 116 || b.East != 117 || n != 100 || offset != 0 {
		t.Fatalf("BD09 envelope rejected: %+v %d %d %v", b, n, offset, err)
	}
	wrap, _, _, err := parseBaiduNativeMapViewport("west=179.5&south=-10&east=-179.5&north=10")
	if err != nil || !wrap.valid() || wrap.West <= wrap.East {
		t.Fatalf("antimeridian BD09 viewport denied: %+v %v", wrap, err)
	}
	for _, query := range []string{
		"west=116&south=39&east=117&north=41&coordinate_space=photo-wgs84",
		"west=116&south=39&east=117&north=41&coordinate_space=bd09ll",
		"west=116&south=39&east=117&north=41&ak=private",
		"west=116&west=116.1&south=39&east=117&north=41",
		"west=116&south=39&east=117&north=41&limit=101",
		"west=116&south=39&east=117&north=41&offset=10000001",
		"west=116&south=39&east=116&north=41",
		"west=116&south=39&east=117&north=NaN",
		"west=116&south=39&east=117&north=Infinity",
		"west=-181&south=39&east=117&north=41",
		"west=116&south=39&east=117",
	} {
		if _, _, _, err := parseBaiduNativeMapViewport(query); err == nil {
			t.Fatalf("bad native map query accepted: %q", query)
		}
	}
}

// An authenticated Owner map-point route is present, but the real production
// signing root and complete provider child graph are absent. Denial precedes
// parsing an untrusted query, database access and any network request.
func TestBaiduNativeViewportNoProductionReleaseNoLeak(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := &Server{AllowedOrigin: "https://gallery.example.invalid"}
	r := gin.New()
	r.GET("/api/v1/media/places/baidu-jsapi/viewport", s.listBaiduNativeMapViewport)
	for _, raw := range []string{
		"/api/v1/media/places/baidu-jsapi/viewport?west=116&south=39&east=117&north=41",
		"/api/v1/media/places/baidu-jsapi/viewport?west=116&south=39&east=117&north=41&ak=secret_canary",
	} {
		req := httptest.NewRequest(http.MethodGet, raw, nil)
		req.Header.Set("Authorization", "Bearer secret_token_canary")
		out := httptest.NewRecorder()
		r.ServeHTTP(out, req)
		if out.Code != http.StatusServiceUnavailable ||
			!strings.Contains(out.Body.String(), "map_runtime_unavailable") ||
			strings.Contains(out.Body.String(), "secret_canary") ||
			strings.Contains(out.Body.String(), "secret_token_canary") ||
			out.Header().Get("Set-Cookie") != "" ||
			out.Header().Get("Cache-Control") != "private, no-store" ||
			out.Header().Get("Referrer-Policy") != "no-referrer" ||
			out.Header().Get("Cross-Origin-Resource-Policy") != "same-origin" {
			t.Fatalf("unsafe unauthorised viewport response: %d", out.Code)
		}
	}
	routes := s.Router().Routes()
	present := false
	for _, route := range routes {
		if route.Method == http.MethodGet &&
			route.Path == "/api/v1/media/places/baidu-jsapi/viewport" {
			present = true
		}
	}
	if !present {
		t.Fatal("authenticated native BD09 viewport route missing")
	}
}

func TestBaiduNativeViewportNeverSerializesOriginalGPS(t *testing.T) {
	out, err := json.Marshal(baiduNativeMapViewportDTO{
		CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL,
		IndexScope:      baiduNativeMapIndexScope,
		Items: []baiduPhotoMapPoint{{
			AssetID: 12, NodeID: 34, Latitude: 39.92, Longitude: 116.42,
		}},
		TotalCount: 200, Limit: 100, Offset: 0, HasMore: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	text := string(out)
	for _, field := range []string{
		`"coordinate_space":"bd09ll"`,
		`"index_scope":"explicit_opt_in_only"`,
		`"asset_id":12`, `"node_id":34`,
		`"total_count":200`, `"has_more":true`,
	} {
		if !strings.Contains(text, field) {
			t.Fatalf("missing typed native field %s", field)
		}
	}
	for _, leak := range []string{"source_latitude", "source_longitude", "owner_id", "browser_ak", "token", "cookie"} {
		if strings.Contains(text, leak) {
			t.Fatalf("private WGS84/credentials exported: %s", leak)
		}
	}
}

// No production signer is needed to verify this pure Owner/epoch comparison.
// Real Router tests continue to prove that the unprovisioned runtime is 503.
func TestBaiduNativeViewportRechecksOwnerAfterSQL(t *testing.T) {
	now := time.Unix(1_760_000_000, 0).UTC()
	access := auth.MapAccess{UserID: 42, SessionVersion: 5, IssuedAt: now}
	epoch := meta.BaiduJSAPIMapEpoch{OwnerID: 42, Epoch: 7}
	if !baiduNativeViewportOwnerStillCurrent(access, epoch, access, epoch) {
		t.Fatal("current owner and epoch unexpectedly refused")
	}
	cases := []struct {
		name   string
		before auth.MapAccess
		prior  meta.BaiduJSAPIMapEpoch
		after  auth.MapAccess
		latest meta.BaiduJSAPIMapEpoch
	}{
		{"different owner", access, epoch,
			auth.MapAccess{UserID: 43, SessionVersion: 5, IssuedAt: now}, epoch},
		{"rotated session", access, epoch,
			auth.MapAccess{UserID: 42, SessionVersion: 6, IssuedAt: now}, epoch},
		{"new issued-at", access, epoch,
			auth.MapAccess{UserID: 42, SessionVersion: 5, IssuedAt: now.Add(time.Second)}, epoch},
		{"revoked map epoch", access, epoch,
			access, meta.BaiduJSAPIMapEpoch{OwnerID: 42, Epoch: 8}},
		{"epoch owner spoof", access, epoch,
			access, meta.BaiduJSAPIMapEpoch{OwnerID: 43, Epoch: 7}},
		{"missing original epoch", access, meta.BaiduJSAPIMapEpoch{OwnerID: 42}, access, epoch},
		{"missing current epoch", access, epoch, access, meta.BaiduJSAPIMapEpoch{OwnerID: 42}},
		{"missing current user", access, epoch, auth.MapAccess{}, epoch},
		{"missing original issued-at", auth.MapAccess{UserID: 42, SessionVersion: 5}, epoch, access, epoch},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if baiduNativeViewportOwnerStillCurrent(tc.before, tc.prior, tc.after, tc.latest) {
				t.Fatal("revoked/changed map owner escaped the post-query fence")
			}
		})
	}
}
