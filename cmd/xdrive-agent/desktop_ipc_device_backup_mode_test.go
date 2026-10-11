package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

type localModeWriterFake struct {
	*fakeDesktopIPCController
	sourceID uint64
	revision uint64
	mode     string
}

func (f *localModeWriterFake) CloudSetLocalBoundBackupMode(_ context.Context, sourceID, revision uint64, mode string) (client.LocalBoundBackupSettings, error) {
	f.sourceID, f.revision, f.mode = sourceID, revision, mode
	return client.LocalBoundBackupSettings{SourceID: sourceID, Name: "backup", Revision: revision + 1, SyncMode: mode}, nil
}

func TestDesktopIPCLocalModeRejectsUnknownFieldsAndRequiresAuth(t *testing.T) {
	f := &localModeWriterFake{fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1}}
	h := newDesktopIPCHandler(f, "secret", func() {})
	body := "{\"source_id\":42,\"revision\":7,\"sync_mode\":\"mirror\"}"
	good := desktopIPCRequest(t, h, http.MethodPatch, "/v1/device-backups/local-mode", body)
	if good.Code != http.StatusOK || f.sourceID != 42 || f.revision != 7 || f.mode != "mirror" {
		t.Fatalf("own Agent mode change failed: %d %s", good.Code, good.Body.String())
	}
	if good.Header().Get("Cache-Control") != "private, no-store" || !strings.Contains(good.Body.String(), "\"sync_mode\":\"mirror\"") {
		t.Fatalf("unexpected private backup mode response: %s", good.Body.String())
	}
	for _, secret := range []string{"device_token", "root_id", "root_fingerprint", "local_path", "ignore_rules", "checkpoint"} {
		if strings.Contains(good.Body.String(), secret) {
			t.Fatalf("backup mode response leaked %s", secret)
		}
	}
	for _, invalid := range []string{
		"{\"source_id\":0,\"revision\":7,\"sync_mode\":\"mirror\"}",
		"{\"source_id\":42,\"revision\":0,\"sync_mode\":\"mirror\"}",
		"{\"source_id\":42,\"revision\":7,\"sync_mode\":\"sync\"}",
		"{\"source_id\":42,\"revision\":7,\"sync_mode\":\"Mirror\"}",
		"{\"source_id\":42,\"revision\":7,\"sync_mode\":\"mirror\",\"device_id\":\"foreign\"}",
		"{\"source_id\":42,\"revision\":7,\"sync_mode\":\"mirror\",\"root_id\":\"spoof\"}",
	} {
		if result := desktopIPCRequest(t, h, http.MethodPatch, "/v1/device-backups/local-mode", invalid); result.Code != http.StatusBadRequest {
			t.Fatalf("invalid local policy accepted: %s status=%d", invalid, result.Code)
		}
	}
	anon := httptest.NewRequest(http.MethodPatch, "http://127.0.0.1/v1/device-backups/local-mode", strings.NewReader(body))
	anon.RemoteAddr = "127.0.0.1:12345"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, anon)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous local policy edit accepted: %d", rec.Code)
	}
}

func TestDesktopIPCLocalModeCannotBorrowGenericSourceMutation(t *testing.T) {
	h := newDesktopIPCHandler(&fakeDesktopIPCController{revision: 1}, "secret", func() {})
	result := desktopIPCRequest(t, h, http.MethodPatch, "/v1/device-backups/local-mode", "{\"source_id\":42,\"revision\":7,\"sync_mode\":\"mirror\"}")
	if result.Code != http.StatusNotImplemented {
		t.Fatalf("generic Source fallback unexpectedly allowed: %d", result.Code)
	}
}
