package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type localPreviewManagerFake struct {
	*fakeDesktopIPCController
	sourceID uint64
	started  chan struct{}
}

func (f *localPreviewManagerFake) CloudLocalBoundBackupPreview(ctx context.Context, id uint64) (localBackupPreviewSummary, error) {
	f.sourceID = id
	if f.started != nil {
		close(f.started)
		<-ctx.Done()
		return localBackupPreviewSummary{}, ctx.Err()
	}
	return localBackupPreviewSummary{
		SourceID: id, Revision: 8, ScannedFiles: 10,
		ScannedBytes: 2048, Complete: true, MissingInferenceSafe: false,
	}, nil
}

func TestDesktopIPCLocalPreviewIsAuthenticatedAndPrivate(t *testing.T) {
	f := &localPreviewManagerFake{fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1}}
	h := newDesktopIPCHandler(f, "secret", func() {})
	got := desktopIPCRequest(t, h, http.MethodGet, "/v1/device-backups/local-preview?source_id=42", "")
	if got.Code != http.StatusOK || f.sourceID != 42 ||
		got.Header().Get("Cache-Control") != "private, no-store" ||
		!strings.Contains(got.Body.String(), "\"complete\":true") ||
		!strings.Contains(got.Body.String(), "\"missing_inference_safe\":false") {
		t.Fatalf("private local preview failed: %d %s", got.Code, got.Body.String())
	}
	for _, secret := range []string{"local_path", "root_id", "fingerprint", "device_token", "ignore_rules", "item_path", "checkpoint"} {
		if strings.Contains(got.Body.String(), secret) {
			t.Fatalf("private preview leaked %q", secret)
		}
	}
	for _, path := range []string{
		"/v1/device-backups/local-preview",
		"/v1/device-backups/local-preview?source_id=0",
		"/v1/device-backups/local-preview?source_id=bad",
	} {
		if bad := desktopIPCRequest(t, h, http.MethodGet, path, ""); bad.Code != http.StatusBadRequest {
			t.Fatalf("invalid Source accepted %s: %d", path, bad.Code)
		}
	}
	anon := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/v1/device-backups/local-preview?source_id=42", nil)
	anon.RemoteAddr = "127.0.0.1:43210"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, anon)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous local preview was accepted: %d", rec.Code)
	}
}

func TestDesktopIPCLocalPreviewHasNoGenericFallback(t *testing.T) {
	h := newDesktopIPCHandler(&fakeDesktopIPCController{revision: 1}, "secret", func() {})
	got := desktopIPCRequest(t, h, http.MethodGet, "/v1/device-backups/local-preview?source_id=42", "")
	if got.Code != http.StatusNotImplemented {
		t.Fatalf("generic Source preview fallback: %d", got.Code)
	}
}

func TestDesktopIPCLocalPreviewCancelledRequestCancelsGoContext(t *testing.T) {
	f := &localPreviewManagerFake{
		fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1},
		started:                  make(chan struct{}),
	}
	h := newDesktopIPCHandler(f, "secret", func() {})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/v1/device-backups/local-preview?source_id=42", nil).WithContext(ctx)
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
		t.Fatal("preview never started")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Go request context did not observe preview cancellation")
	}
}
