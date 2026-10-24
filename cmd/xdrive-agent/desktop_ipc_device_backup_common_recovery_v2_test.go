package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLocalCommonRecoveryReviewSelectorNeverAcceptsPrivateIdentity(t *testing.T) {
	const epoch = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	for _, tc := range []struct {
		url       string
		after     uint64
		wantEpoch string
	}{
		{"http://localhost/v1/device-backups/local-common-batch/recovery-review?source_id=42", 0, ""},
		{"http://localhost/v1/device-backups/local-common-batch/recovery-review?source_id=42&after_file=16&page_epoch=" + epoch, 16, epoch},
	} {
		r := httptest.NewRequest(http.MethodGet, tc.url, nil)
		id, after, gotEpoch, ok := validLocalCommonRecoveryReviewRequest(r)
		if !ok || id != 42 || after != tc.after || gotEpoch != tc.wantEpoch {
			t.Fatalf("owner-only review rejected bounded selector: %s", tc.url)
		}
	}
	for _, query := range []string{
		"source_id=0", "source_id=-1", "source_id=not-a-number",
		"source_id=042", "source_id=42&path=/tmp/private",
		"source_id=42&root_id=secret", "source_id=42&operation_id=secret",
		"source_id=42&resume_key=lp2_fake",
		"source_id=42&source_id=43",
		"source_id=42&after_file=-1", "source_id=42&after_file=0001",
		"source_id=42&after_file=1000001",
		"source_id=42&after_file=1&after_file=2",
		"source_id=42&after_file=16",
		"source_id=42&page_epoch=" + epoch,
		"source_id=42&page_epoch=",
		"source_id=42&foo%zz=x",
		"source_id=42&after_file=16&page_epoch=" + strings.ToUpper(epoch),
		"source_id=42&after_file=16&page_epoch=" + epoch[:63],
		"source_id=42&after_file=16&page_epoch=" + epoch + "&page_epoch=" + epoch,
		"source_id=42&after_file=16&page_epoch=" + epoch + "&path=/tmp/private",
	} {
		r := httptest.NewRequest(http.MethodGet,
			"http://localhost/v1/device-backups/local-common-batch/recovery-review?"+query, nil)
		if _, _, _, ok := validLocalCommonRecoveryReviewRequest(r); ok {
			t.Fatalf("renderer injected private recovery selector: %s", query)
		}
	}
	wrongMethod := httptest.NewRequest(http.MethodPost,
		"http://localhost/v1/device-backups/local-common-batch/recovery-review?source_id=42", nil)
	if _, _, _, ok := validLocalCommonRecoveryReviewRequest(wrongMethod); ok {
		t.Fatal("write-capable recovery method was accepted")
	}
}

func TestLocalCommonRecoveryReviewDTOHasOnlyRedactedHistoricalCounts(t *testing.T) {
	page := localCommonRecoveryReviewPage{
		SourceID: 42, Revision: 7, RunState: "uncertain",
		ReviewedFiles: 3, PendingFiles: 1, UnrecordedFiles: 1,
		HistoricalCommitted: 1, NextAfterFile: 3, HasMore: true,
		PageEpoch:     strings.Repeat("a", 64),
		Authoritative: false,
	}
	raw, err := json.Marshal(page)
	if err != nil {
		t.Fatal(err)
	}
	lower := strings.ToLower(string(raw))
	for _, private := range []string{
		"absolute_path", "relative_path", "root_id", "root_fingerprint",
		"device_id", "device_token", "session_digest", "operation_id",
		"resume_key", "content_sha256", "node_id", "backup_complete",
		"retirement_safe", "current_cas_verified",
	} {
		if strings.Contains(lower, private) {
			t.Fatalf("redacted recovery review leaked %s", private)
		}
	}
	if !strings.Contains(lower, `"authoritative":false`) ||
		!strings.Contains(lower, `"pending_original_files":1`) {
		t.Fatalf("historical-only review must not be authoritative: %s", raw)
	}
}

func TestLocalCommonRecoveryReviewRejectsForgedControllerPages(t *testing.T) {
	epoch := strings.Repeat("a", 64)
	valid := localCommonRecoveryReviewPage{
		SourceID: 42, Revision: 7, RunState: "uncertain",
		ReviewedFiles: 16, PendingFiles: 12, UnrecordedFiles: 4,
		NextAfterFile: 32, HasMore: true, PageEpoch: epoch,
	}
	if !validLocalCommonRecoveryReviewPage(valid, 42, 16, epoch) {
		t.Fatal("verified bounded page rejected")
	}
	for label, change := range map[string]func(*localCommonRecoveryReviewPage){
		"wrong_source":       func(p *localCommonRecoveryReviewPage) { p.SourceID++ },
		"missing_revision":   func(p *localCommonRecoveryReviewPage) { p.Revision = 0 },
		"asserts_authority":  func(p *localCommonRecoveryReviewPage) { p.Authoritative = true },
		"fabricates_counts":  func(p *localCommonRecoveryReviewPage) { p.HistoricalCommitted++ },
		"oversized_page":     func(p *localCommonRecoveryReviewPage) { p.ReviewedFiles++ },
		"unknown_terminal":   func(p *localCommonRecoveryReviewPage) { p.RunState = "complete" },
		"forged_cursor":      func(p *localCommonRecoveryReviewPage) { p.NextAfterFile++ },
		"no_cursor":          func(p *localCommonRecoveryReviewPage) { p.NextAfterFile = 0 },
		"missing_epoch":      func(p *localCommonRecoveryReviewPage) { p.PageEpoch = "" },
		"changed_generation": func(p *localCommonRecoveryReviewPage) { p.PageEpoch = strings.Repeat("b", 64) },
		"premature_hasmore":  func(p *localCommonRecoveryReviewPage) { p.ReviewedFiles-- },
	} {
		t.Run(label, func(t *testing.T) {
			page := valid
			change(&page)
			if validLocalCommonRecoveryReviewPage(page, 42, 16, epoch) {
				t.Fatalf("invalid recovery result escaped private Agent: %+v", page)
			}
		})
	}
	last := localCommonRecoveryReviewPage{
		SourceID: 42, Revision: 7, RunState: "partial",
		ReviewedFiles: 1, UnrecordedFiles: 1, PageEpoch: epoch,
	}
	if !validLocalCommonRecoveryReviewPage(last, 42, 16, epoch) {
		t.Fatal("non-authoritative final page was rejected")
	}
}
