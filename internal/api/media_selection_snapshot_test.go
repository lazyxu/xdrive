package api

import (
	"errors"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestMediaSelectionDayBoundsRespectsDSTAndSortMode(t *testing.T) {
	options := mediaQueryOptions{TimeZone: "America/New_York", SortBy: "captured"}
	spring, springEnd, err := mediaSelectionDayBounds(options, "2026-03-08")
	if err != nil {
		t.Fatal(err)
	}
	if delta := springEnd.Sub(spring); delta != 23*time.Hour {
		t.Fatalf("spring DST day=%v, want 23 hours", delta)
	}
	fall, fallEnd, err := mediaSelectionDayBounds(options, "2026-11-01")
	if err != nil {
		t.Fatal(err)
	}
	if delta := fallEnd.Sub(fall); delta != 25*time.Hour {
		t.Fatalf("fall DST day=%v, want 25 hours", delta)
	}
	for _, day := range []string{"2026-02-30", "2026-3-8", "bad-date", "2026-03-08Z"} {
		if _, _, err := mediaSelectionDayBounds(options, day); err == nil {
			t.Fatalf("invalid calendar day accepted: %s", day)
		}
	}
	options.TimeZone = "Invalid/Not_Real"
	if _, _, err := mediaSelectionDayBounds(options, "2026-03-08"); err == nil {
		t.Fatal("invalid timezone accepted")
	}
}

func TestMediaSelectionExclusionsVersionAndBoundedReview(t *testing.T) {
	session := &mediaSelectionSnapshot{
		nodes:     make([]mediaSelectionNode, 230),
		memberIDs: make(map[uint64]struct{}, 230),
		excluded:  make(map[uint64]struct{}),
		version:   1,
	}
	for i := range session.nodes {
		id := uint64(i + 1)
		session.nodes[i] = mediaSelectionNode{ID: id, Revision: 2}
		session.memberIDs[id] = struct{}{}
	}
	if got := session.selectedCount(); got != 230 {
		t.Fatalf("initial count=%d", got)
	}
	first := session.page(0, 100)
	next := session.page(100, 100)
	end := session.page(200, 100)
	if len(first) != 100 || len(next) != 100 || len(end) != 30 ||
		first[0].ID != 1 || next[0].ID != 101 || end[0].ID != 201 {
		t.Fatal("selection pages are not stable and bounded")
	}
	if err := session.setExcluded(101, true, 1); err != nil {
		t.Fatal(err)
	}
	if session.version != 2 || session.selectedCount() != 229 ||
		session.page(100, 100)[0].ID != 102 {
		t.Fatal("exclusion did not update count, page, or version")
	}
	if err := session.setExcluded(101, true, 2); err != nil || session.version != 2 {
		t.Fatal("idempotent exclusion must not spuriously bump version")
	}
	if err := session.setExcluded(50, true, 1); !errors.Is(err, errMediaSelectionConflict) {
		t.Fatalf("stale mutation was not rejected: %v", err)
	}
	if err := session.setExcluded(999999, true, 2); !errors.Is(err, errMediaSelectionOutside) {
		t.Fatalf("out-of-snapshot item was not rejected: %v", err)
	}
	if err := session.setExcluded(101, false, 2); err != nil {
		t.Fatal(err)
	}
	if session.selectedCount() != 230 || session.version != 3 {
		t.Fatal("removing exclusion must restore selected total")
	}
}

func TestMediaSelection100KReviewRemainsPageBounded(t *testing.T) {
	s := &mediaSelectionSnapshot{
		nodes:    make([]mediaSelectionNode, mediaSelectionMaxItems),
		excluded: make(map[uint64]struct{}),
	}
	for i := range s.nodes {
		s.nodes[i] = mediaSelectionNode{ID: uint64(i + 1), Revision: 1}
	}
	page := s.page(98765, mediaSelectionPageMax)
	if len(page) != mediaSelectionPageMax || page[0].ID != 98766 ||
		page[len(page)-1].ID != 98965 {
		t.Fatalf("100k page mismatch; len=%d, first=%d", len(page), page[0].ID)
	}
	if got := s.page(mediaSelectionMaxItems+1, mediaSelectionPageMax); len(got) != 0 {
		t.Fatalf("outside 100k should be empty, got %d", len(got))
	}
}

func TestMediaSelectionTokensRejectOtherOwnersAndExpiredSessions(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	token := uuid.NewString()
	snapshot := &mediaSelectionSnapshot{
		ownerID:   11,
		nodes:     []mediaSelectionNode{{ID: 42, Revision: 1}},
		excluded:  make(map[uint64]struct{}),
		memberIDs: map[uint64]struct{}{42: {}},
		version:   1,
		expiresAt: time.Now().Add(time.Minute),
	}
	server := &Server{
		mediaSelections: map[string]*mediaSelectionSnapshot{token: snapshot},
	}
	ctx.Set("userID", uint64(12))
	if _, ok := server.mediaSelectionByTokenLocked(ctx, token); ok {
		t.Fatal("snapshot leaked into another owner's request")
	}
	ctx.Set("userID", uint64(11))
	if _, ok := server.mediaSelectionByTokenLocked(ctx, token); !ok {
		t.Fatal("own active snapshot was not found")
	}
	if _, ok := server.mediaSelectionByTokenLocked(ctx, "not-a-uuid"); ok {
		t.Fatal("invalid selection token accepted")
	}
	snapshot.expiresAt = time.Now().Add(-time.Second)
	if _, ok := server.mediaSelectionByTokenLocked(ctx, token); ok {
		t.Fatal("expired snapshot remained accessible")
	}
	if _, exists := server.mediaSelections[token]; exists {
		t.Fatal("expired snapshot was not released from memory")
	}
}
