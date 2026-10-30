package synologyui

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

type fakeDSMRecoveryAgent struct {
	*fakeAgent
	calls  int
	forge  bool
	reject bool
}

func (f *fakeDSMRecoveryAgent) RecoveryReview(
	_ context.Context, id, after uint64, epoch string,
) (localbackupipc.RecoveryReviewPage, error) {
	f.calls++
	if f.reject {
		return localbackupipc.RecoveryReviewPage{}, errors.New("PRIVATE ORIGINAL SQL TOKEN")
	}
	if id != 42 || (after != 0 && (after != 16 || epoch != strings.Repeat("a", 64))) {
		return localbackupipc.RecoveryReviewPage{}, errors.New("foreign or stale local review")
	}
	page := localbackupipc.RecoveryReviewPage{
		SourceID: 42, Revision: 3, RunState: "partial",
		ReviewedFiles: 16, HistoricalCommitted: 16, CurrentNodeMatch: 16,
		NextAfterFile: 16, PageEpoch: strings.Repeat("a", 64), HasMore: true,
	}
	if after == 16 {
		page.ReviewedFiles, page.HistoricalCommitted, page.CurrentNodeMatch = 2, 1, 1
		page.PendingFiles, page.NextAfterFile, page.HasMore = 1, 0, false
	}
	if f.forge {
		page.SourceID = 99
	}
	return page, nil
}

func requestDSMRecoveryReview(g *Gateway, method, query string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, "https://nas.example:5001"+DSMCGIPath+query, nil)
	req.Header.Set("Cookie", "id=dsm-session")
	w := httptest.NewRecorder()
	CGIHandler(g).ServeHTTP(w, req)
	return w
}

func TestDSMRecoveryReviewUsesRealLocalAgentAndHistoricalCountsOnly(t *testing.T) {
	g, local := newFixture(t)
	agent := &fakeDSMRecoveryAgent{fakeAgent: local}
	g.Connect = func(context.Context) (Agent, error) { return agent, nil }
	first := requestDSMRecoveryReview(g, http.MethodGet, "?op=recovery-review&source_id=42")
	if first.Code != http.StatusOK || first.Header().Get("Cache-Control") != "no-store, private" {
		t.Fatalf("no authenticated private historical review: %d %s", first.Code, first.Body.String())
	}
	var page localbackupipc.RecoveryReviewPage
	if err := json.Unmarshal(first.Body.Bytes(), &page); err != nil ||
		page.SourceID != 42 || page.ReviewedFiles != 16 || page.Authoritative || !page.HasMore {
		t.Fatalf("untrusted DSM historical review: %+v %v", page, err)
	}
	for _, secret := range []string{"root_id", "path", "operation_id", "cas_verified", "backup_complete", "device_token"} {
		if strings.Contains(first.Body.String(), secret) {
			t.Fatalf("browser received private Agent or CAS fields: %s", secret)
		}
	}
	next := requestDSMRecoveryReview(g, http.MethodGet,
		"?op=recovery-review&source_id=42&after_file=16&page_epoch="+page.PageEpoch)
	if next.Code != http.StatusOK || !strings.Contains(next.Body.String(), `"pending_original_files":1`) {
		t.Fatalf("original Agent continuation denied: %d %s", next.Code, next.Body.String())
	}
	if agent.calls != 2 || local.runs != 0 || local.controls != 0 || local.scheduleWrites != 0 {
		t.Fatal("read-only review triggered local Source or Runner mutation")
	}
}

func TestDSMRecoveryReviewRejectsForgedSelectorsBeforeAgent(t *testing.T) {
	g, local := newFixture(t)
	agent := &fakeDSMRecoveryAgent{fakeAgent: local}
	g.Connect = func(context.Context) (Agent, error) { return agent, nil }
	validEpoch := strings.Repeat("a", 64)
	for _, query := range []string{
		"?op=recovery-review", "?op=recovery-review&source_id=0",
		"?op=recovery-review&source_id=042", "?op=recovery-review&source_id=-1",
		"?op=recovery-review&source_id=9007199254740992",
		"?op=recovery-review&source_id=42&source_id=42",
		"?op=recovery-review&source_id=42&path=/volume1/secret",
		"?op=recovery-review&source_id=42&root_id=hidden",
		"?op=recovery-review&source_id=42&after_file=-1",
		"?op=recovery-review&source_id=42&after_file=1000001",
		"?op=recovery-review&source_id=42&after_file=16",
		"?op=recovery-review&source_id=42&page_epoch=" + validEpoch,
		"?op=recovery-review&source_id=42&after_file=16&page_epoch=" + strings.Repeat("A", 64),
		"?op=recovery-review&source_id=42&after_file=16&page_epoch=" + validEpoch + "&page_epoch=" + validEpoch,
		"?op=recovery-review&source_id=42&op=run",
		"?op=recovery-review&source_id=42;action=run",
		"?op=recovery-review&source_id=42&after_file=00016&page_epoch=" + validEpoch,
	} {
		r := requestDSMRecoveryReview(g, http.MethodGet, query)
		if r.Code == http.StatusOK {
			t.Fatalf("unsafe recovery review admitted: %q", query)
		}
	}
	if agent.calls != 0 {
		t.Fatal("untrusted DSM review selector reached private owning Agent")
	}
}

func TestDSMRecoveryReviewOldAgentForeignDSMAndForgedReplyFailClosed(t *testing.T) {
	g, local := newFixture(t)
	if r := requestDSMRecoveryReview(g, http.MethodGet, "?op=recovery-review&source_id=42"); r.Code != http.StatusNotImplemented {
		t.Fatalf("old Agent incorrectly accepted native recovery review: %d", r.Code)
	}
	agent := &fakeDSMRecoveryAgent{fakeAgent: local}
	g.Connect = func(context.Context) (Agent, error) { return agent, nil }
	agent.forge = true
	if r := requestDSMRecoveryReview(g, http.MethodGet, "?op=recovery-review&source_id=42"); r.Code != http.StatusServiceUnavailable {
		t.Fatalf("forged Source identity exposed: %d", r.Code)
	}
	agent.forge = false
	agent.reject = true
	if r := requestDSMRecoveryReview(g, http.MethodGet, "?op=recovery-review&source_id=42"); r.Code != http.StatusServiceUnavailable ||
		strings.Contains(r.Body.String(), "PRIVATE") {
		t.Fatal("private original SQL errors must not reach the DSM browser")
	}
	agent.reject = false
	previous := agent.calls
	g.Authenticate = func(context.Context) (string, error) { return "foreign", nil }
	if r := requestDSMRecoveryReview(g, http.MethodGet, "?op=recovery-review&source_id=42"); r.Code != http.StatusForbidden ||
		agent.calls != previous {
		t.Fatal("foreign DSM user admitted to original SQL recovery review")
	}
	// The first page is an ordinal projection, never an arbitrary file name.
	if _, _, _, ok := parseDSMRecoveryReview(httptest.NewRequest(http.MethodGet,
		"https://nas.example:5001/v1/recovery-review?source_id="+strconv.Itoa(42), nil)); !ok {
		t.Fatal("canonical Source selector rejected")
	}
}
