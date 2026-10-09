package api

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestMobileGalleryTailQueryValidationAndUnknownOrder(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		query string
		valid bool
	}{
		{"sort_by=captured&sort_dir=asc&unknown_first=true&initial_position=latest", true},
		{"sort_by=added&sort_dir=asc&initial_position=latest", true},
		{"sort_by=captured&sort_dir=desc&unknown_first=false", true},
		{"initial_position=first", false},
		{"initial_position=-1", false},
		{"unknown_first=invalid", false},
	} {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest("GET", "/api/v1/media/items?"+tc.query, nil)
		options, ok := mediaQueryFromRequest(c)
		if ok != tc.valid {
			t.Errorf("query=%s accepted=%v want=%v code=%d", tc.query, ok, tc.valid, recorder.Code)
		}
		if ok && strings.Contains(tc.query, "initial_position=latest") && options.InitialPosition != "latest" {
			t.Errorf("latest position did not round-trip: %+v", options)
		}
	}

	mobile := mediaQueryOptions{SortBy: "captured", SortDir: "asc", UnknownFirst: true}
	wide := mediaQueryOptions{SortBy: "captured", SortDir: "asc"}
	if clauses := mediaGallerySortClauses(mobile); !strings.HasSuffix(clauses[0], "DESC") {
		t.Errorf("mobile unknown dates should precede known captures: %v", clauses)
	}
	if clauses := mediaGallerySortClauses(wide); !strings.HasSuffix(clauses[0], "ASC") {
		t.Errorf("wide desktop behavior must not change: %v", clauses)
	}
	if mediaTimelineUnknownOrder(mobile) != "unknown_rank DESC" ||
		mediaTimelineUnknownOrder(wide) != "unknown_rank ASC" {
		t.Fatal("mobile day-group order disagrees with row sort")
	}
	unknown := mediaAnchorRow{NodeID: 9, CreatedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	sql, _ := mediaAnchorBeforeClause(mobile, unknown)
	if strings.Contains(sql, "IS NOT NULL OR") || !strings.Contains(sql, "IS NULL AND") {
		t.Errorf("mobile unknown-date anchor rank is incorrect: %s", sql)
	}
	date := unknown.CreatedAt.AddDate(0, 1, 0)
	known := mediaAnchorRow{NodeID: 10, CapturedAt: &date, CreatedAt: date}
	sql, _ = mediaAnchorBeforeClause(mobile, known)
	if !strings.Contains(sql, "IS NULL OR") {
		t.Errorf("unknown-first rows must precede a known-date anchor: %s", sql)
	}
}
