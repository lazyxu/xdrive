package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

type boundBackupConfigFake struct {
	*fakeDesktopIPCController
	id   uint64
	rev  uint64
	name string
}

func (f *boundBackupConfigFake) CloudLocalBoundBackupSettings(_ context.Context, id uint64) (client.LocalBoundBackupSettings, error) {
	f.id = id
	return client.LocalBoundBackupSettings{SourceID: id, Name: "old", Revision: 7}, nil
}

func (f *boundBackupConfigFake) CloudRenameLocalBoundBackup(_ context.Context, id, rev uint64, name string) (client.LocalBoundBackupSettings, error) {
	f.id, f.rev, f.name = id, rev, name
	return client.LocalBoundBackupSettings{SourceID: id, Name: name, Revision: 8}, nil
}

func TestDesktopIPCBoundBackupConfigRequiresAuthAndBounds(t *testing.T) {
	f := &boundBackupConfigFake{fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1}}
	h := newDesktopIPCHandler(f, "secret", func() {})
	get := desktopIPCRequest(t, h, http.MethodGet, "/v1/device-backups/local-source?source_id=42", "")
	if get.Code != http.StatusOK || f.id != 42 || get.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("bad private read: %d %s", get.Code, get.Body.String())
	}
	patch := desktopIPCRequest(t, h, http.MethodPatch, "/v1/device-backups/local-source", `{"source_id":42,"revision":7,"name":"new"}`)
	if patch.Code != http.StatusOK || f.id != 42 || f.rev != 7 || f.name != "new" {
		t.Fatalf("bad private patch: %d %s", patch.Code, patch.Body.String())
	}
	if patch.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatal("local config must be no-store")
	}
	for _, forbidden := range []string{"root_id", "device_token", "root_fingerprint", "checkpoint", "path"} {
		if strings.Contains(patch.Body.String(), forbidden) {
			t.Fatalf("local config leaked %s", forbidden)
		}
	}
	for _, path := range []string{"/v1/device-backups/local-source", "/v1/device-backups/local-source?source_id=0", "/v1/device-backups/local-source?source_id=-1"} {
		if res := desktopIPCRequest(t, h, http.MethodGet, path, ""); res.Code != http.StatusBadRequest {
			t.Fatalf("bad local config path %s accepted: %d", path, res.Code)
		}
	}
	for _, body := range []string{
		`{"source_id":42,"revision":0,"name":"x"}`,
		`{"source_id":0,"revision":7,"name":"x"}`,
		`{"source_id":42,"revision":7,"name":" "}`,
		`{"source_id":42,"revision":7,"name":"x","device_id":"spoofed"}`,
	} {
		if res := desktopIPCRequest(t, h, http.MethodPatch, "/v1/device-backups/local-source", body); res.Code != http.StatusBadRequest {
			t.Fatalf("bad local config payload %s accepted: %d", body, res.Code)
		}
	}
	unauth := httptest.NewRequest(http.MethodPatch, "http://127.0.0.1/v1/device-backups/local-source", strings.NewReader(`{"source_id":42,"revision":7,"name":"attack"}`))
	unauth.RemoteAddr = "127.0.0.1:12345"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, unauth)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated mutation passed: %d", rec.Code)
	}
}

func TestDesktopIPCBoundBackupConfigNeverFallsBackToGenericSource(t *testing.T) {
	h := newDesktopIPCHandler(&fakeDesktopIPCController{revision: 1}, "secret", func() {})
	if res := desktopIPCRequest(t, h, http.MethodGet, "/v1/device-backups/local-source?source_id=42", ""); res.Code != http.StatusNotImplemented {
		t.Fatalf("generic read fallback: %d", res.Code)
	}
	if res := desktopIPCRequest(t, h, http.MethodPatch, "/v1/device-backups/local-source", `{"source_id":42,"revision":7,"name":"new"}`); res.Code != http.StatusNotImplemented {
		t.Fatalf("generic mutation fallback: %d", res.Code)
	}
}
