package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestBaiduPhotoMapCoverageDoesNotAcceptMissingAuthority(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for _, tc := range []struct {
		ctx   context.Context
		owner uint64
	}{
		{context.Background(), 0},
		{ctx, 42},
		{context.Background(), 42},
	} {
		if _, err := queryBaiduPhotoMapCoverage(tc.ctx, nil, tc.owner); err == nil {
			t.Fatal("missing Owner, database or live context accepted")
		}
	}
}

func TestBaiduPhotoMapCoverageHTTPNoQueryAndNoRawLocation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := &Server{}
	r := gin.New()
	r.GET("/api/v1/media/places/baidu-jsapi/coverage", s.listBaiduPhotoMapCoverage)
	for _, tc := range []struct {
		query string
		want  int
	}{
		{"?owner_id=7", http.StatusBadRequest},
		{"?west=116&south=39", http.StatusBadRequest},
		{"", http.StatusServiceUnavailable},
	} {
		req := httptest.NewRequest(http.MethodGet,
			"/api/v1/media/places/baidu-jsapi/coverage"+tc.query, nil)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		if rec.Code != tc.want ||
			!strings.Contains(rec.Header().Get("Cache-Control"), "no-store") ||
			strings.Contains(rec.Body.String(), "116") ||
			strings.Contains(rec.Body.String(), "owner_id") {
			t.Fatalf("coverage failed closed improperly: %d %s", rec.Code, rec.Body.String())
		}
	}
	found := false
	for _, route := range s.Router().Routes() {
		if route.Method == http.MethodGet &&
			route.Path == "/api/v1/media/places/baidu-jsapi/coverage" {
			found = true
		}
	}
	if !found {
		t.Fatal("Owner coverage route missing from authenticated Router")
	}
}
