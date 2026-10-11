package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type localEvidenceManagerFake struct {
	*fakeDesktopIPCController
	sourceID uint64
	started  chan struct{}
}

func (f *localEvidenceManagerFake) CloudStageLocalBoundBackupEvidence(ctx context.Context, id uint64) (localBackupEvidenceStageSummary, error) {
	f.sourceID = id
	if f.started != nil {
		close(f.started)
		<-ctx.Done()
		return localBackupEvidenceStageSummary{}, ctx.Err()
	}
	return localBackupEvidenceStageSummary{
		SourceID: id, Revision: 3, Hints: 4, Matched: 2,
		Unmatched: 2, Stored: 1, Replayed: 1, Complete: true,
		Authoritative: false, MissingInferenceSafe: false,
	}, nil
}

func TestDesktopIPCLocalEvidenceOnlyAuthenticatedPOSTAndSafeCounts(t *testing.T) {
	f := &localEvidenceManagerFake{fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1}}
	h := newDesktopIPCHandler(f, "secret", func() {})
	got := desktopIPCRequest(t, h, http.MethodPost, "/v1/device-backups/local-evidence?source_id=42", "")
	if got.Code != http.StatusOK || f.sourceID != 42 ||
		got.Header().Get("Cache-Control") != "private, no-store" ||
		!strings.Contains(got.Body.String(), "\"stored\":1") ||
		!strings.Contains(got.Body.String(), "\"replayed\":1") ||
		!strings.Contains(got.Body.String(), "\"authoritative\":false") ||
		!strings.Contains(got.Body.String(), "\"missing_inference_safe\":false") {
		t.Fatalf("owning evidence staging failed: %d %s", got.Code, got.Body.String())
	}
	for _, key := range []string{"path", "root", "fingerprint", "device", "token", "native", "identity", "snapshot", "source_item", "error", "ignore_rules"} {
		if strings.Contains(got.Body.String(), key) {
			t.Fatalf("advisory response leaked %s", key)
		}
	}
	for _, path := range []string{
		"/v1/device-backups/local-evidence", "/v1/device-backups/local-evidence?source_id=0",
		"/v1/device-backups/local-evidence?source_id=bad",
		"/v1/device-backups/local-evidence?source_id=42&path=/private",
	} {
		bad := desktopIPCRequest(t, h, http.MethodPost, path, "")
		if bad.Code != http.StatusBadRequest {
			t.Fatalf("bad evidence request was permitted: %s %d", path, bad.Code)
		}
	}
	if read := desktopIPCRequest(t, h, http.MethodGet, "/v1/device-backups/local-evidence?source_id=42", ""); read.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET could stage evidence: %d", read.Code)
	}
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/v1/device-backups/local-evidence?source_id=42", nil)
	req.RemoteAddr = "127.0.0.1:43210"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous evidence permitted: %d", rec.Code)
	}
}

func TestDesktopIPCLocalEvidenceCannotUseGenericSourceManager(t *testing.T) {
	h := newDesktopIPCHandler(&fakeDesktopIPCController{revision: 1}, "secret", func() {})
	got := desktopIPCRequest(t, h, http.MethodPost, "/v1/device-backups/local-evidence?source_id=42", "")
	if got.Code != http.StatusNotImplemented {
		t.Fatalf("generic Source path accepted staging: %d", got.Code)
	}
}

func TestDesktopIPCLocalEvidenceCancellationReachesGoContext(t *testing.T) {
	f := &localEvidenceManagerFake{
		fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1},
		started:                  make(chan struct{}),
	}
	h := newDesktopIPCHandler(f, "secret", func() {})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/v1/device-backups/local-evidence?source_id=42", nil).WithContext(ctx)
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
		t.Fatal("local evidence staging never started")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("evidence staging did not observe Go cancellation")
	}
}
