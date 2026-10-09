package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestMediaSourceRevisionQueryMatchesOwnerScopedNode(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name        string
		query       string
		current     uint64
		allow       bool
		status      int
		cachePolicy string
	}{
		{name: "legacy unknown revision", query: "", current: 4, allow: true},
		{name: "known current revision", query: "?revision=4", current: 4, allow: true},
		{name: "newer query", query: "?revision=5", current: 4, status: http.StatusConflict, cachePolicy: "private, no-store"},
		{name: "superseded query", query: "?revision=3", current: 4, status: http.StatusConflict, cachePolicy: "private, no-store"},
		{name: "invalid zero", query: "?revision=0", current: 4, status: http.StatusBadRequest, cachePolicy: "private, no-store"},
		{name: "invalid negative", query: "?revision=-1", current: 4, status: http.StatusBadRequest, cachePolicy: "private, no-store"},
		{name: "empty supplied", query: "?revision=", current: 4, status: http.StatusBadRequest, cachePolicy: "private, no-store"},
		{name: "overflow", query: "?revision=18446744073709551616", current: 4, status: http.StatusBadRequest, cachePolicy: "private, no-store"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			writer := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(writer)
			ctx.Request = httptest.NewRequest(http.MethodGet, "/media/items/7/thumbnail"+tc.query, nil)
			allowed := requireMediaSourceRevision(ctx, tc.current)
			if allowed != tc.allow {
				t.Fatalf("allowed=%v want=%v", allowed, tc.allow)
			}
			if !tc.allow && writer.Code != tc.status {
				t.Fatalf("status=%d want=%d body=%q", writer.Code, tc.status, writer.Body.String())
			}
			if !tc.allow && writer.Header().Get("Cache-Control") != tc.cachePolicy {
				t.Fatalf("conflict/bad query cache policy=%q want=%q",
					writer.Header().Get("Cache-Control"), tc.cachePolicy)
			}
			if tc.status == http.StatusConflict &&
				(!strings.Contains(writer.Body.String(), "expected_revision") ||
					!strings.Contains(writer.Body.String(), "current_revision")) {
				t.Fatalf("revision conflict response missing diagnostic revisions: %s", writer.Body.String())
			}
		})
	}
}
