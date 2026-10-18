package api

import (
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestBaiduNativeCellsParserRejectsUnreviewedGeometry(t *testing.T) {
	good := "west=179.9&south=-2&east=-179.9&north=3"
	b, err := parseBaiduNativeMapCells(good)
	if err != nil || !b.valid() || b.CoordinateSpace != meta.BaiduPhotoMapSpaceBD09LL {
		t.Fatalf("valid antimeridian BD09 rejected: %#v %v", b, err)
	}
	dx, dy, err := baiduPhotoMapCellSteps(b)
	if err != nil || math.Abs(dx-0.025) > 1e-9 || dy != 0.625 {
		t.Fatalf("wrapped 8x8 geometry incorrect: %f %f %v", dx, dy, err)
	}
	for _, q := range []string{
		"",
		"west=1&south=2&east=3",
		"west=1&south=2&east=3&north=4&ak=secret",
		"west=1&south=2&east=3&north=4&limit=100",
		"west=1&south=2&east=3&north=4&offset=0",
		"west=1&south=2&east=3&north=4&zoom=12",
		"west=1&south=2&east=3&north=4&coordinate_space=wgs84ll",
		"west=1&west=1&south=2&east=3&north=4",
		"west=1&south=2&east=3&north=NaN",
		"west=181&south=2&east=3&north=4",
		"west=1&south=2&east=1&north=4",
		"west=1&south=2&east=3&north=1",
		"west=1&south=2&east=3&north=4%3Bbad",
		"west=1&south=2&east=3&north=4&west=2",
	} {
		if _, err := parseBaiduNativeMapCells(q); err == nil {
			t.Fatalf("accepted unsafe BD09 cluster request %q", q)
		}
	}
	if _, _, err := baiduPhotoMapCellSteps(baiduPhotoMapBounds{
		West: 0, East: 1e-12, South: 0, North: 1,
		CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL,
	}); err == nil {
		t.Fatal("numerically unstable tiny cell viewport was accepted")
	}
}

func TestBaiduNativeCellsActualGinNoReleaseNoLeak(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := &Server{AllowedOrigin: "https://gallery.example.invalid"}
	r := gin.New()
	r.GET("/api/v1/media/places/baidu-jsapi/cells", s.listBaiduNativeMapCells)
	for _, raw := range []string{
		"/api/v1/media/places/baidu-jsapi/cells?west=1&south=1&east=2&north=2",
		"/api/v1/media/places/baidu-jsapi/cells?west=1&south=1&east=2&north=2&ak=secret_canary",
	} {
		req := httptest.NewRequest(http.MethodGet, raw, nil)
		req.Header.Set("Authorization", "Bearer secret_bearer_canary")
		out := httptest.NewRecorder()
		r.ServeHTTP(out, req)
		if out.Code != http.StatusServiceUnavailable ||
			!strings.Contains(out.Body.String(), "map_runtime_unavailable") ||
			strings.Contains(out.Body.String(), "secret_canary") ||
			strings.Contains(out.Body.String(), "secret_bearer_canary") ||
			out.Header().Get("Set-Cookie") != "" ||
			out.Header().Get("Cache-Control") != "private, no-store" ||
			out.Header().Get("Referrer-Policy") != "no-referrer" {
			t.Fatalf("unsafe nonreleased aggregate response: %d %s", out.Code, out.Body.String())
		}
	}
	found := false
	for _, route := range s.Router().Routes() {
		if route.Method == "GET" &&
			route.Path == "/api/v1/media/places/baidu-jsapi/cells" {
			found = true
		}
	}
	if !found {
		t.Fatal("real authenticated Router missing map cells endpoint")
	}
}

func TestBaiduNativeCellsWireNoOriginalWGS84OrUnboundedPoints(t *testing.T) {
	cells := make([]baiduPhotoMapCell, baiduPhotoMapCellMax)
	var total int64
	for i := range cells {
		cells[i] = baiduPhotoMapCell{
			CellX: i % 8, CellY: i / 8,
			PhotoCount: 1562, AssetID: uint64(i + 1),
			NodeID: uint64(i + 101), Latitude: 39.9, Longitude: 116.4,
		}
		total += cells[i].PhotoCount
	}
	cells[0].PhotoCount += 32
	total += 32 // Synthetic EXACT 100,000 without returning 100k raw points.
	if total != 100000 || len(cells) != 64 {
		t.Fatal("synthetic bounded 100k cell arithmetic failed")
	}
	out, err := json.Marshal(baiduNativeMapCellsDTO{
		CoordinateSpace: "bd09ll",
		IndexScope:      baiduNativeMapIndexScope,
		Cells:           cells,
		TotalCount:      total, GridColumns: 8, GridRows: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	body := string(out)
	if !strings.Contains(body, "\"total_count\":100000") ||
		!strings.Contains(body, "\"grid_columns\":8") ||
		!strings.Contains(body, "\"grid_rows\":8") ||
		strings.Contains(body, "source_latitude") ||
		strings.Contains(body, "source_longitude") ||
		strings.Contains(body, "owner_id") ||
		strings.Contains(body, "browser_ak") {
		t.Fatal("unsafe or incorrect bounded map cells DTO")
	}
	// Synthetic arithmetic is NOT a genuine 100k PostgreSQL/performance test.
}
