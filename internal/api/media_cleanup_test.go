package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestMediaCleanupIDs(t *testing.T) {
	hash := strings.Repeat("a", 64)
	if got := mediaDuplicateID(hash); got != "duplicate:v1:"+hash {
		t.Fatalf("duplicate id=%q", got)
	}
	if parsed, ok := parseMediaDuplicateID("duplicate:v1:" + hash); !ok || parsed != hash {
		t.Fatalf("duplicate parse=%q ok=%v", parsed, ok)
	}
	if _, ok := parseMediaDuplicateID("duplicate:v1:not-a-hash"); ok {
		t.Fatal("invalid duplicate id accepted")
	}
	if got := mediaBurstReviewID(42); got != "burst:v1:42" {
		t.Fatalf("burst id=%q", got)
	}
	if parsed, ok := parseMediaBurstReviewID("burst:v1:42"); !ok || parsed != 42 {
		t.Fatalf("burst parse=%d ok=%v", parsed, ok)
	}
	if _, ok := parseMediaBurstReviewID("burst:v1:0"); ok {
		t.Fatal("zero burst id accepted")
	}
}

func TestChooseDuplicateKeepPreservesUserIntent(t *testing.T) {
	now := time.Date(2026, 10, 8, 0, 0, 0, 0, time.UTC)
	rows := []mediaDuplicateMemberRow{
		{NodeID: 1, CreatedAt: now.Add(-2 * time.Hour)},
		{NodeID: 2, Favorite: true, CreatedAt: now},
		{NodeID: 3, Description: "edited", CreatedAt: now.Add(-time.Hour)},
	}
	best, ok := chooseDuplicateKeep(rows)
	if !ok || best.NodeID != 2 {
		t.Fatalf("best=%+v ok=%v", best, ok)
	}
	if got := duplicateRecommendationReason(best); got != "优先保留已收藏副本" {
		t.Fatalf("reason=%q", got)
	}

	rows = []mediaDuplicateMemberRow{
		{NodeID: 7, CreatedAt: now},
		{NodeID: 5, CreatedAt: now.Add(-time.Hour)},
	}
	best, ok = chooseDuplicateKeep(rows)
	if !ok || best.NodeID != 5 {
		t.Fatalf("oldest best=%+v ok=%v", best, ok)
	}
}

func TestChooseBurstRecommendationUsesResolutionThenCenter(t *testing.T) {
	rows := []mediaBurstMemberRow{
		{NodeID: 1, Ordinal: 0, Width: 3000, Height: 2000},
		{NodeID: 2, Ordinal: 1, Width: 4000, Height: 3000},
		{NodeID: 3, Ordinal: 2, Width: 3000, Height: 2000},
	}
	best, reason, ok := chooseBurstRecommendation(rows)
	if !ok || best.NodeID != 2 {
		t.Fatalf("best=%+v reason=%q ok=%v", best, reason, ok)
	}
	if reason != "优先推荐有效分辨率更高的帧" {
		t.Fatalf("reason=%q", reason)
	}

	rows = []mediaBurstMemberRow{
		{NodeID: 1, Ordinal: 0, Width: 4000, Height: 3000},
		{NodeID: 2, Ordinal: 1, Width: 4000, Height: 3000},
		{NodeID: 3, Ordinal: 2, Width: 4000, Height: 3000},
		{NodeID: 4, Ordinal: 3, Width: 4000, Height: 3000},
	}
	best, reason, ok = chooseBurstRecommendation(rows)
	if !ok || best.NodeID != 2 {
		t.Fatalf("center best=%+v reason=%q ok=%v", best, reason, ok)
	}
	if reason != "同等分辨率下推荐连拍中间帧" {
		t.Fatalf("center reason=%q", reason)
	}
}

func TestMediaCleanupOffsetValidation(t *testing.T) {
	for _, tc := range []struct {
		query string
		want  int
		valid bool
	}{
		{query: "", want: 0, valid: true},
		{query: "?offset=0", want: 0, valid: true},
		{query: "?offset=48", want: 48, valid: true},
		{query: "?offset=10000000", want: 10000000, valid: true},
		{query: "?offset=-1"},
		{query: "?offset=10000001"},
		{query: "?offset=not-a-number"},
	} {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodGet, "/media/duplicates"+tc.query, nil)
		got, ok := mediaCleanupOffset(c)
		if ok != tc.valid || (ok && got != tc.want) {
			t.Errorf("query=%q got=%d valid=%v want=%d valid=%v",
				tc.query, got, ok, tc.want, tc.valid)
		}
		if !ok && recorder.Code != http.StatusBadRequest {
			t.Errorf("query=%q status=%d want=%d", tc.query, recorder.Code, http.StatusBadRequest)
		}
	}
}

func TestMediaBurstReviewPageBeyond48Groups(t *testing.T) {
	groups := make([]mediaBurstReviewDTO, 53)
	for i := range groups {
		groups[i].ID = mediaBurstReviewID(uint64(i + 1))
	}
	var ids []string
	for _, offset := range []int{0, 24, 48} {
		page := mediaBurstReviewPage(groups, 24, offset)
		for _, row := range page {
			ids = append(ids, row.ID)
		}
	}
	if len(ids) != len(groups) {
		t.Fatalf("expected %d groups; paged %d", len(groups), len(ids))
	}
	seen := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		if _, exists := seen[id]; exists {
			t.Fatalf("duplicate burst group on page boundary: %s", id)
		}
		seen[id] = struct{}{}
	}
	if got := mediaBurstReviewPage(groups, 24, 53); len(got) != 0 {
		t.Fatalf("unexpected groups beyond end: %+v", got)
	}
}
