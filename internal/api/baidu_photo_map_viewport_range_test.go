package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestBaiduNativeViewportItemsStrictBD09Parser(t *testing.T) {
	good := "west=116&south=39&east=117&north=40&limit=48&offset=0&range=true"
	b, limit, offset, album, err := parseBaiduNativeMapViewportItems(
		good + "&sort_by=added&sort_dir=asc&favorite=true&kind=image")
	if err != nil || b.CoordinateSpace != meta.BaiduPhotoMapSpaceBD09LL ||
		b.West != 116 || b.North != 40 || limit != 48 || offset != 0 || album != "" {
		t.Fatalf("strict current-map wall rejected: %+v %d %d %q %v", b, limit, offset, album, err)
	}
	for _, raw := range []string{
		"west=179.9&south=-5&east=-179.9&north=5&limit=1&offset=0&range=true",
	} {
		wrap, _, _, _, err := parseBaiduNativeMapViewportItems(raw)
		if err != nil || wrap.West <= wrap.East {
			t.Fatalf("valid antimeridian window rejected: %q %v", raw, err)
		}
	}
	for _, bad := range []string{
		strings.Replace(good, "range=true", "range=false", 1),
		strings.Replace(good, "limit=48", "limit=101", 1),
		strings.Replace(good, "limit=48", "limit=0", 1),
		good + "&offset=4",
		good + "&west=100",
		good + "&ak=canary",
		good + "&coordinate_space=wgs84",
		good + "&bbox=116%2C39%2C117%2C40",
		good + "&owner_id=123",
		good + "&fold_duplicates=true",
		good + "&album=%00",
		good + "&favorite=true&favorite=false",
		good + "&sort_by=",
		good + "&bad=%GG",
		strings.Replace(good, "east=117", "east=116", 1),
	} {
		if _, _, _, _, err := parseBaiduNativeMapViewportItems(bad); err == nil {
			t.Fatalf("unsafe viewport media query accepted: %q", bad)
		}
	}
}

func TestBaiduNativeViewportItemsFailClosedBeforeParsingOrDB(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := &Server{AllowedOrigin: "https://gallery.example.invalid"}
	r := gin.New()
	r.GET("/api/v1/media/places/baidu-jsapi/viewport-items", s.listBaiduNativeMapViewportItems)
	for _, query := range []string{
		"?west=116&south=39&east=117&north=40&limit=48&offset=0&range=true",
		"?west=bad&ak=private_canary",
	} {
		req := httptest.NewRequest(http.MethodGet,
			"/api/v1/media/places/baidu-jsapi/viewport-items"+query, nil)
		req.Header.Set("Authorization", "Bearer private_bearer_canary")
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusServiceUnavailable ||
			!strings.Contains(rec.Body.String(), "map_runtime_unavailable") ||
			strings.Contains(rec.Body.String(), "canary") {
			t.Fatalf("map runtime failed closed improperly: %d %s", rec.Code, rec.Body.String())
		}
	}
	found := false
	for _, route := range s.Router().Routes() {
		if route.Method == http.MethodGet &&
			route.Path == "/api/v1/media/places/baidu-jsapi/viewport-items" {
			found = true
		}
	}
	if !found {
		t.Fatal("signed Owner viewport-items endpoint missing from authenticated Router")
	}
}

func TestBaiduNativeViewportMembersNeverRevalidateUntrustedInput(t *testing.T) {
	b := baiduPhotoMapBounds{
		West: 116, South: 39, East: 117, North: 40,
		CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL,
	}
	if ok, err := baiduMapViewportPageMembersStillAuthorized(
		context.Background(), nil, 42, b, mediaItemRangeDTO{}); ok || err == nil {
		t.Fatal("missing database validated")
	}
	b.CoordinateSpace = meta.BaiduPhotoMapSpaceWGS84LL
	if ok, err := baiduMapViewportPageMembersStillAuthorized(
		context.Background(), nil, 42, b, mediaItemRangeDTO{}); ok || err == nil {
		t.Fatal("original WGS84 misused as BD09")
	}
}
