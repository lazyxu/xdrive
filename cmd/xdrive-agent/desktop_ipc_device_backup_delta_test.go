package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type localDeltaManagerFake struct {
	*fakeDesktopIPCController
	sourceID uint64
	started  chan struct{}
}

func (f *localDeltaManagerFake) CloudLocalBoundBackupDelta(ctx context.Context, id uint64) (localBackupDeltaSummary, error) {
	f.sourceID = id
	if f.started != nil {
		close(f.started)
		<-ctx.Done()
		return localBackupDeltaSummary{}, ctx.Err()
	}
	return localBackupDeltaSummary{
		SourceID: id, Revision: 4,
		PreviousItems: 8, CurrentItems: 9,
		Added: 2, Changed: 1, MetadataStable: 6, AbsentCandidates: 1,
		Complete: true, Authoritative: false, MissingInferenceSafe: false,
	}, nil
}

func TestDesktopIPCLocalDeltaAuthenticatedRedactedAndReadOnly(t *testing.T) {
	f := &localDeltaManagerFake{fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1}}
	h := newDesktopIPCHandler(f, "secret", func() {})
	got := desktopIPCRequest(t, h, http.MethodGet, "/v1/device-backups/local-delta?source_id=42", "")
	if got.Code != http.StatusOK || f.sourceID != 42 ||
		got.Header().Get("Cache-Control") != "private, no-store" ||
		!strings.Contains(got.Body.String(), "\"absent_candidates\":1") ||
		!strings.Contains(got.Body.String(), "\"authoritative\":false") ||
		!strings.Contains(got.Body.String(), "\"missing_inference_safe\":false") {
		t.Fatalf("private delta request failed: %d %s", got.Code, got.Body.String())
	}
	for _, secret := range []string{"local_path", "item_path", "root_id", "fingerprint", "device_token", "ignore_rules", "snapshot_name", "native_identity", "filename", "last_error"} {
		if strings.Contains(got.Body.String(), secret) {
			t.Fatalf("local delta leaked %q", secret)
		}
	}
	for _, path := range []string{
		"/v1/device-backups/local-delta",
		"/v1/device-backups/local-delta?source_id=0",
		"/v1/device-backups/local-delta?source_id=bad",
	} {
		bad := desktopIPCRequest(t, h, http.MethodGet, path, "")
		if bad.Code != http.StatusBadRequest {
			t.Fatalf("invalid Source accepted %s: %d", path, bad.Code)
		}
	}
	if write := desktopIPCRequest(t, h, http.MethodPost, "/v1/device-backups/local-delta?source_id=42", ""); write.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST unexpectedly accepted local delta: %d", write.Code)
	}
	anon := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/v1/device-backups/local-delta?source_id=42", nil)
	anon.RemoteAddr = "127.0.0.1:43210"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, anon)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous local delta accepted: %d", rec.Code)
	}
}

func TestDesktopIPCLocalDeltaHasNoGenericSourceFallback(t *testing.T) {
	h := newDesktopIPCHandler(&fakeDesktopIPCController{revision: 1}, "secret", func() {})
	got := desktopIPCRequest(t, h, http.MethodGet, "/v1/device-backups/local-delta?source_id=42", "")
	if got.Code != http.StatusNotImplemented {
		t.Fatalf("generic Sources permitted local delta: %d", got.Code)
	}
}

func TestDesktopIPCLocalDeltaCancelReachesGoContext(t *testing.T) {
	f := &localDeltaManagerFake{
		fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1},
		started:                  make(chan struct{}),
	}
	h := newDesktopIPCHandler(f, "secret", func() {})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/v1/device-backups/local-delta?source_id=42", nil).WithContext(ctx)
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
		t.Fatal("local delta never started")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("local delta did not observe cancellation")
	}
}
