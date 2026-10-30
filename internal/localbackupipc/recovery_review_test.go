package localbackupipc

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func validHistoricalReviewFixture() RecoveryReviewPage {
	return RecoveryReviewPage{
		SourceID: 42, Revision: 3, RunState: "partial",
		ReviewedFiles: 16, HistoricalCommitted: 16, CurrentNodeMatch: 16,
		NextAfterFile: 16, PageEpoch: strings.Repeat("a", 64), HasMore: true,
		Authoritative: false,
	}
}

func TestRecoveryReviewUsesOnlyExistingOwningAgentReadEndpoint(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != http.MethodGet ||
			r.URL.Path != "/v1/device-backups/local-common-batch/recovery-review" ||
			r.Header.Get("Authorization") != "Bearer "+strings.Repeat("a", 64) ||
			r.URL.Query().Get("source_id") != "42" {
			t.Errorf("unexpected Agent historical read: %s %s", r.Method, r.URL.String())
			w.WriteHeader(http.StatusForbidden)
			return
		}
		page := validHistoricalReviewFixture()
		switch r.URL.Query().Get("after_file") {
		case "":
			if r.URL.RawQuery != "source_id=42" {
				t.Errorf("first page must omit epoch and cursor: %q", r.URL.RawQuery)
			}
		case "16":
			if r.URL.Query().Get("page_epoch") != strings.Repeat("a", 64) ||
				len(r.URL.Query()) != 3 {
				t.Errorf("continuation must pin the original epoch")
			}
			page.ReviewedFiles, page.HistoricalCommitted, page.CurrentNodeMatch = 2, 1, 1
			page.PendingFiles, page.NextAfterFile, page.HasMore = 1, 0, false
		default:
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(page)
	}))
	defer server.Close()
	c := &Client{
		baseURL: server.URL, token: strings.Repeat("a", 64),
		capabilities: []string{"device-backup-local-common-recovery-review"},
		http: server.Client(),
	}
	first, err := c.RecoveryReview(context.Background(), 42, 0, "")
	if err != nil || first.ReviewedFiles != 16 || !first.HasMore {
		t.Fatalf("read-only owning Agent first review: %+v %v", first, err)
	}
	next, err := c.RecoveryReview(context.Background(), 42, first.NextAfterFile, first.PageEpoch)
	if err != nil || next.ReviewedFiles != 2 || next.HasMore || next.PendingFiles != 1 {
		t.Fatalf("read-only owning Agent continuation: %+v %v", next, err)
	}
	for _, tc := range []struct {
		id, after uint64
		epoch     string
	}{
		{0, 0, ""}, {MaxSafeSourceID + 1, 0, ""},
		{42, recoveryReviewMaxAfter + 1, strings.Repeat("a", 64)},
		{42, 0, strings.Repeat("a", 64)}, {42, 16, ""},
		{42, 16, strings.Repeat("G", 64)}, {42, 16, strings.Repeat("a", 63)},
	} {
		if _, err := c.RecoveryReview(context.Background(), tc.id, tc.after, tc.epoch); err == nil {
			t.Fatalf("unsafe recovery review selector admitted: %+v", tc)
		}
	}
	if calls != 2 {
		t.Fatalf("unsafe selectors invoked the Agent: %d calls", calls)
	}
	c.capabilities = []string{"device-backup-local-common-batch"}
	if _, err := c.RecoveryReview(context.Background(), 42, 0, ""); err == nil ||
		!strings.Contains(err.Error(), "capability") {
		t.Fatal("old Agent lacking original-receipt read must fail closed")
	}
	if calls != 2 {
		t.Fatal("old Agent was called despite missing capability")
	}
}

func TestRecoveryReviewRejectsForgedOrCurrentCASClaims(t *testing.T) {
	base := validHistoricalReviewFixture()
	cases := map[string]func(*RecoveryReviewPage){
		"foreign_source": func(p *RecoveryReviewPage) { p.SourceID = 43 },
		"unsafe_revision": func(p *RecoveryReviewPage) { p.Revision = MaxSafeSourceID + 1 },
		"running": func(p *RecoveryReviewPage) { p.RunState = "running" },
		"authoritative": func(p *RecoveryReviewPage) { p.Authoritative = true },
		"oversized_page": func(p *RecoveryReviewPage) { p.ReviewedFiles = 17 },
		"impossible_total": func(p *RecoveryReviewPage) { p.PendingFiles++ },
		"wrong_metadata": func(p *RecoveryReviewPage) { p.CurrentNodeMismatch++ },
		"bad_epoch": func(p *RecoveryReviewPage) { p.PageEpoch = strings.Repeat("A", 64) },
		"bad_next": func(p *RecoveryReviewPage) { p.NextAfterFile = 15 },
		"no_continuation": func(p *RecoveryReviewPage) { p.HasMore = false },
		"overflow_count": func(p *RecoveryReviewPage) { p.HistoricalCommitted = ^uint64(0) },
	}
	if !ValidateRecoveryReviewPage(base, 42, 0, "") {
		t.Fatal("valid original receipt fixture rejected")
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			page := base
			change(&page)
			if ValidateRecoveryReviewPage(page, 42, 0, "") {
				t.Fatalf("unsafe historical receipt page accepted: %+v", page)
			}
		})
	}
	if ValidateRecoveryReviewPage(base, 42, 16, strings.Repeat("b", 64)) {
		t.Fatal("stale or foreign inventory epoch accepted")
	}
	if ValidRecoveryReviewSelector(42, 16, strconv.FormatUint(16, 10)) {
		t.Fatal("raw numeric cursor accepted in place of an opaque epoch")
	}
}
