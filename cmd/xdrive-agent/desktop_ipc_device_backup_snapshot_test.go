package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type localSnapshotManagerFake struct {
	*fakeDesktopIPCController
	sourceID uint64
	started  chan struct{}
}

func (f *localSnapshotManagerFake) CloudSaveLocalBoundBackupSnapshot(ctx context.Context, id uint64) (localBackupSnapshotSummary, error) {
	f.sourceID = id
	if f.started != nil {
		close(f.started)
		<-ctx.Done()
		return localBackupSnapshotSummary{}, ctx.Err()
	}
	return localBackupSnapshotSummary{
		SourceID: id, Revision: 4, ScannedFiles: 7, ScannedBytes: 4096,
		Saved: true, Complete: true, MissingInferenceSafe: false,
	}, nil
}

func TestDesktopIPCLocalSnapshotRequiresAuthenticatedPostAndRedacts(t *testing.T) {
	f := &localSnapshotManagerFake{fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1}}
	h := newDesktopIPCHandler(f, "secret", func() {})
	got := desktopIPCRequest(t, h, http.MethodPost, "/v1/device-backups/local-snapshot?source_id=42", "")
	if got.Code != http.StatusOK || f.sourceID != 42 ||
		got.Header().Get("Cache-Control") != "private, no-store" ||
		!strings.Contains(got.Body.String(), "\"saved\":true") ||
		!strings.Contains(got.Body.String(), "\"missing_inference_safe\":false") {
		t.Fatalf("private snapshot request failed: %d %s", got.Code, got.Body.String())
	}
	for _, secret := range []string{"local_path", "root_id", "fingerprint", "device_token", "ignore_rules", "item_path", "checkpoint", "snapshot_name"} {
		if strings.Contains(got.Body.String(), secret) {
			t.Fatalf("local snapshot leaked %q", secret)
		}
	}
	for _, path := range []string{
		"/v1/device-backups/local-snapshot",
		"/v1/device-backups/local-snapshot?source_id=0",
		"/v1/device-backups/local-snapshot?source_id=bad",
	} {
		bad := desktopIPCRequest(t, h, http.MethodPost, path, "")
		if bad.Code != http.StatusBadRequest {
			t.Fatalf("invalid local snapshot Source accepted %s: %d", path, bad.Code)
		}
	}
	if read := desktopIPCRequest(t, h, http.MethodGet, "/v1/device-backups/local-snapshot?source_id=42", ""); read.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET unexpectedly saved local snapshot: %d", read.Code)
	}
	anon := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/v1/device-backups/local-snapshot?source_id=42", nil)
	anon.RemoteAddr = "127.0.0.1:43210"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, anon)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous local snapshot accepted: %d", rec.Code)
	}
}

func TestDesktopIPCLocalSnapshotHasNoGenericSourceFallback(t *testing.T) {
	h := newDesktopIPCHandler(&fakeDesktopIPCController{revision: 1}, "secret", func() {})
	got := desktopIPCRequest(t, h, http.MethodPost, "/v1/device-backups/local-snapshot?source_id=42", "")
	if got.Code != http.StatusNotImplemented {
		t.Fatalf("generic Sources permitted local snapshot: %d", got.Code)
	}
}

func TestDesktopIPCLocalSnapshotCancelReachesGoContext(t *testing.T) {
	f := &localSnapshotManagerFake{
		fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1},
		started:                  make(chan struct{}),
	}
	h := newDesktopIPCHandler(f, "secret", func() {})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/v1/device-backups/local-snapshot?source_id=42", nil).WithContext(ctx)
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
		t.Fatal("snapshot never started")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("snapshot did not observe request cancellation")
	}
}
