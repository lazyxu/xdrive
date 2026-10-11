package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type localEvidenceSummaryManagerFake struct {
	*fakeDesktopIPCController
	sourceID uint64
	started  chan struct{}
}

func (f *localEvidenceSummaryManagerFake) CloudReadLocalBoundBackupEvidenceSummary(ctx context.Context, id uint64) (localBackupPersistedEvidenceSummary, error) {
	f.sourceID = id
	if f.started != nil {
		close(f.started)
		<-ctx.Done()
		return localBackupPersistedEvidenceSummary{}, ctx.Err()
	}
	return localBackupPersistedEvidenceSummary{
		SourceID: id, Revision: 7, StagedRecords: 3,
		Authoritative: false, MissingInferenceSafe: false,
	}, nil
}

func TestDesktopIPCPrivateEvidenceSummaryReadOnlyBoundedAndRedacted(t *testing.T) {
	f := &localEvidenceSummaryManagerFake{fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1}}
	h := newDesktopIPCHandler(f, "secret", func() {})
	got := desktopIPCRequest(t, h, http.MethodGet, "/v1/device-backups/local-evidence-summary?source_id=42", "")
	if got.Code != http.StatusOK || f.sourceID != 42 ||
		got.Header().Get("Cache-Control") != "private, no-store" ||
		!strings.Contains(got.Body.String(), "\"staged_records\":3") ||
		!strings.Contains(got.Body.String(), "\"authoritative\":false") ||
		!strings.Contains(got.Body.String(), "\"missing_inference_safe\":false") {
		t.Fatalf("owning private evidence COUNT unavailable: %d %s", got.Code, got.Body.String())
	}
	for _, forbidden := range []string{"root", "fingerprint", "device", "token",
		"native", "snapshot", "source_item", "path", "error", "ignore_rules", "filename"} {
		if strings.Contains(got.Body.String(), forbidden) {
			t.Fatalf("private evidence COUNT leaked %s", forbidden)
		}
	}
	for _, path := range []string{
		"/v1/device-backups/local-evidence-summary",
		"/v1/device-backups/local-evidence-summary?source_id=0",
		"/v1/device-backups/local-evidence-summary?source_id=bad",
		"/v1/device-backups/local-evidence-summary?source_id=42&path=/private",
		"/v1/device-backups/local-evidence-summary?source_id=42&source_id=43",
	} {
		bad := desktopIPCRequest(t, h, http.MethodGet, path, "")
		if bad.Code != http.StatusBadRequest {
			t.Fatalf("unsafe evidence COUNT request accepted: %s %d", path, bad.Code)
		}
	}
	if write := desktopIPCRequest(t, h, http.MethodPost, "/v1/device-backups/local-evidence-summary?source_id=42", ""); write.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST to private count endpoint accepted: %d", write.Code)
	}
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/v1/device-backups/local-evidence-summary?source_id=42", nil)
	req.RemoteAddr = "127.0.0.1:43210"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated private count accepted: %d", rec.Code)
	}
}

func TestDesktopIPCPrivateEvidenceSummaryCannotFallbackToSources(t *testing.T) {
	h := newDesktopIPCHandler(&fakeDesktopIPCController{revision: 1}, "secret", func() {})
	got := desktopIPCRequest(t, h, http.MethodGet, "/v1/device-backups/local-evidence-summary?source_id=42", "")
	if got.Code != http.StatusNotImplemented {
		t.Fatalf("generic Sources accepted private count request: %d", got.Code)
	}
}

func TestDesktopIPCPrivateEvidenceSummaryCancellationReachesGoContext(t *testing.T) {
	f := &localEvidenceSummaryManagerFake{
		fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1},
		started:                  make(chan struct{}),
	}
	h := newDesktopIPCHandler(f, "secret", func() {})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/v1/device-backups/local-evidence-summary?source_id=42", nil).WithContext(ctx)
	req.RemoteAddr = "127.0.0.1:43210"
	req.Header.Set("Authorization", "Bearer secret")
	done := make(chan struct{})
	go func() {
		defer close(done)
		h.ServeHTTP(httptest.NewRecorder(), req)
	}()
	select {
	case <-f.started:
	case <-time.After(5 * time.Second):
		t.Fatal("private count read never started")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("private count read ignored Go cancellation")
	}
}
