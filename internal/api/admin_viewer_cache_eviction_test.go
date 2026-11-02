package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestViewerCacheAdminEvictionRequiresExplicitDryRunAndFencesStorage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server := &Server{}
	for _, tc := range []struct {
		body string
		want int
	}{
		{"{}", http.StatusBadRequest},
		{`{"dry_run":1}`, http.StatusBadRequest},
		{`{"dry_run":false,"node_id":1}`, http.StatusBadRequest},
		{`{"dry_run":true}`, http.StatusServiceUnavailable},
		{`{"dry_run":false}`, http.StatusServiceUnavailable},
	} {
		rec := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(rec)
		c.Request = httptest.NewRequest(http.MethodPost,
			"/api/v1/admin/storage/cache/viewer/evict", strings.NewReader(tc.body))
		server.adminEvictViewerCache(c)
		if rec.Code != tc.want || rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("body %q returned %d want %d", tc.body, rec.Code, tc.want)
		}
	}
}
