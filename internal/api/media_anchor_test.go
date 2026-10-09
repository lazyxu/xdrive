package api

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestMediaAnchorBeforeClauseMatchesRangeOrder(t *testing.T) {
	captured := time.Date(2026, 3, 8, 5, 0, 0, 0, time.UTC)
	added := captured.Add(3 * time.Hour)
	tests := []struct {
		name         string
		query        mediaQueryOptions
		capture      *time.Time
		wantOperator string
		wantCapture  string
		wantArgs     int
	}{
		{"capture descending", mediaQueryOptions{SortBy: "captured", SortDir: "desc"}, &captured, ">", "xd_media_metadata.captured_at IS NOT NULL", 5},
		{"capture ascending", mediaQueryOptions{SortBy: "captured", SortDir: "asc"}, &captured, "<", "xd_media_metadata.captured_at IS NOT NULL", 5},
		{"unknown last even in ascending", mediaQueryOptions{SortBy: "captured", SortDir: "asc"}, nil, "<", "xd_media_metadata.captured_at IS NOT NULL OR", 3},
		{"added descending", mediaQueryOptions{SortBy: "added", SortDir: "desc"}, &captured, ">", "n.created_at", 3},
		{"added ascending", mediaQueryOptions{SortBy: "added", SortDir: "asc"}, &captured, "<", "n.created_at", 3},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			where, args := mediaAnchorBeforeClause(tc.query, mediaAnchorRow{NodeID: 42, CapturedAt: tc.capture, CreatedAt: added})
			if !strings.Contains(where, tc.wantCapture) || !strings.Contains(where, tc.wantOperator+" ?") {
				t.Fatalf("unexpected comparison %s", where)
			}
			if len(args) != tc.wantArgs || strings.Count(where, "?") != len(args) {
				t.Fatalf("comparison %q placeholders=%d args=%d expected=%d", where, strings.Count(where, "?"), len(args), tc.wantArgs)
			}
			if args[len(args)-1] != uint64(42) {
				t.Fatalf("stable node-ID tie breaker missing: %#v", args)
			}
		})
	}
}

func TestMediaAnchorQueryValidatesNodeID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		query string
		ok    bool
		want  uint64
	}{
		{"anchor_node_id=42&sort_by=added&sort_dir=asc", true, 42},
		{"anchor_node_id=0", false, 0},
		{"anchor_node_id=-1", false, 0},
		{"anchor_node_id=word", false, 0},
		{"anchor_node_id=18446744073709551616", false, 0},
	} {
		t.Run(tc.query, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest("GET", "/api/v1/media/items?"+tc.query, nil)
			opt, ok := mediaQueryFromRequest(c)
			if ok != tc.ok {
				t.Fatalf("got ok=%v, want %v: %s", ok, tc.ok, w.Body.String())
			}
			if ok && opt.AnchorNodeID != tc.want {
				t.Fatalf("anchor = %d, want %d", opt.AnchorNodeID, tc.want)
			}
		})
	}
}
