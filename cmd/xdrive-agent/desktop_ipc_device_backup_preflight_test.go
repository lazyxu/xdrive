package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type localEvidencePreflightManagerFake struct {
	*fakeDesktopIPCController
	sourceID uint64
	afterID  uint64
	started  chan struct{}
	override *localEvidencePreflightSummary
}

func (f *localEvidencePreflightManagerFake) preflightLocalBoundBackupEvidencePage(
	ctx context.Context, sourceID, afterID uint64,
) (localEvidencePreflightSummary, error) {
	f.sourceID, f.afterID = sourceID, afterID
	if f.started != nil {
		close(f.started)
		<-ctx.Done()
		return localEvidencePreflightSummary{}, ctx.Err()
	}
	if f.override != nil {
		return *f.override, nil
	}
	return localEvidencePreflightSummary{
		SourceID: sourceID, Revision: 7, Checked: 12,
		LocallyHashedFiles: 12, LocallyHashedBytes: 98432,
		MetadataMatchedFiles: 12, CloudMetadataMatched: true,
		PhysicalCASObservedFiles: 8, PhysicalCASObservedBytes: 64512,
		PhysicalCASUnobservedFiles: 4, PhysicalCASBatchRequests: 2,
		ServerConsistent: true, HasMore: true, NextAfterID: afterID + 20,
	}, nil
}

func TestDesktopIPCLocalContentPreflightOnlyProjectsBoundedRedactedAggregate(t *testing.T) {
	f := &localEvidencePreflightManagerFake{fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1}}
	h := newDesktopIPCHandler(f, "secret", func() {})
	path := "/v1/device-backups/local-evidence-preflight?source_id=42&after_evidence_id=9"
	got := desktopIPCRequest(t, h, http.MethodGet, path, "")
	if got.Code != http.StatusOK || f.sourceID != 42 || f.afterID != 9 ||
		got.Header().Get("Cache-Control") != "private, no-store" ||
		!strings.Contains(got.Body.String(), "\"checked\":12") ||
		!strings.Contains(got.Body.String(), "\"physical_observed_files\":8") ||
		!strings.Contains(got.Body.String(), "\"physical_unobserved_files\":4") ||
		!strings.Contains(got.Body.String(), "\"next_after_id\":29") ||
		!strings.Contains(got.Body.String(), "\"commit_supported\":false") {
		t.Fatalf("safe owning Desktop content preflight not available: %d %s", got.Code, got.Body.String())
	}
	for _, forbidden := range []string{
		"source_item_id", "root_id", "root_fingerprint", "device_id",
		"device_token", "snapshot_sha256", "native_identity",
		"previous_path", "current_path", "storage_key", "sha256", "filename",
		"absolute_path", "local_path", "per_file", "credentials",
	} {
		if strings.Contains(got.Body.String(), forbidden) {
			t.Fatalf("content preflight leaked %s", forbidden)
		}
	}
	for _, bad := range []string{
		"/v1/device-backups/local-evidence-preflight",
		"/v1/device-backups/local-evidence-preflight?source_id=0",
		"/v1/device-backups/local-evidence-preflight?source_id=bad",
		"/v1/device-backups/local-evidence-preflight?source_id=9007199254740992",
		"/v1/device-backups/local-evidence-preflight?source_id=42&after_evidence_id=bad",
		"/v1/device-backups/local-evidence-preflight?source_id=42&after_evidence_id=-1",
		"/v1/device-backups/local-evidence-preflight?source_id=42&after_evidence_id=9007199254740992",
		"/v1/device-backups/local-evidence-preflight?source_id=42&source_id=42",
		"/v1/device-backups/local-evidence-preflight?source_id=42&path=/root/private",
	} {
		resp := desktopIPCRequest(t, h, http.MethodGet, bad, "")
		if resp.Code != http.StatusBadRequest {
			t.Fatalf("unsafe preflight query accepted: %s %d", bad, resp.Code)
		}
	}
	if got := desktopIPCRequest(t, h, http.MethodPost, path, ""); got.Code != http.StatusMethodNotAllowed {
		t.Fatalf("a write method gained physical preflight access: %d", got.Code)
	}
	unauth := httptest.NewRequest(http.MethodGet, "http://127.0.0.1"+path, nil)
	unauth.RemoteAddr = "127.0.0.1:42111"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, unauth)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated preflight request accepted: %d", rec.Code)
	}
}

func TestDesktopIPCLocalContentPreflightNoGenericSourceFallback(t *testing.T) {
	h := newDesktopIPCHandler(&fakeDesktopIPCController{revision: 1}, "secret", func() {})
	got := desktopIPCRequest(t, h, http.MethodGet,
		"/v1/device-backups/local-evidence-preflight?source_id=42", "")
	if got.Code != http.StatusNotImplemented {
		t.Fatalf("generic Source gained owning Agent preflight: %d", got.Code)
	}
}

func TestDesktopIPCLocalContentPreflightRejectsUnsafeResults(t *testing.T) {
	base := localEvidencePreflightSummary{
		SourceID: 42, Revision: 7, Checked: 12,
		LocallyHashedFiles: 12, MetadataMatchedFiles: 12,
		CloudMetadataMatched: true, ServerConsistent: true,
		PhysicalCASObservedFiles: 8, PhysicalCASUnobservedFiles: 4,
		PhysicalCASObservedBytes: 32 << 20, PhysicalCASBatchRequests: 2,
		HasMore: true, NextAfterID: 33,
	}
	for _, mutate := range []func(*localEvidencePreflightSummary){
		func(s *localEvidencePreflightSummary) { s.Authoritative = true },
		func(s *localEvidencePreflightSummary) { s.CommitSupported = true },
		func(s *localEvidencePreflightSummary) { s.MissingInferenceSafe = true },
		func(s *localEvidencePreflightSummary) { s.CloudContentVerified = true },
		func(s *localEvidencePreflightSummary) { s.ContentVerified = true },
		func(s *localEvidencePreflightSummary) { s.PhysicalCASObservedFiles = 17 },
		func(s *localEvidencePreflightSummary) { s.PhysicalCASObservedBytes = 257 << 20 },
		func(s *localEvidencePreflightSummary) { s.PhysicalCASBatchRequests = 5 },
		func(s *localEvidencePreflightSummary) { s.PhysicalCASUnobservedFiles = 0 },
		func(s *localEvidencePreflightSummary) { s.MetadataMatchedFiles = 11 },
		func(s *localEvidencePreflightSummary) { s.NextAfterID = 9 },
		func(s *localEvidencePreflightSummary) { s.ServerConsistent = false },
	} {
		bad := base
		mutate(&bad)
		if _, err := desktopLocalEvidencePreflightProjection(42, 9, bad); err == nil {
			t.Fatalf("unsafe physical preflight projected: %+v", bad)
		}
	}
}

func TestDesktopIPCLocalContentPreflightCancellationPropagatesToGoContext(t *testing.T) {
	f := &localEvidencePreflightManagerFake{
		fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1},
		started:                  make(chan struct{}),
	}
	h := newDesktopIPCHandler(f, "secret", func() {})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/v1/device-backups/local-evidence-preflight?source_id=42", nil).WithContext(ctx)
	req.RemoteAddr = "127.0.0.1:42111"
	req.Header.Set("Authorization", "Bearer secret")
	done := make(chan struct{})
	go func() {
		defer close(done)
		h.ServeHTTP(httptest.NewRecorder(), req)
	}()
	select {
	case <-f.started:
	case <-time.After(5 * time.Second):
		t.Fatal("owning Agent physical preflight never began")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("owning Agent physical preflight ignored request cancellation")
	}
}
