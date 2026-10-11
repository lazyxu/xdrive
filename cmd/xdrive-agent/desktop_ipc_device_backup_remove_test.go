package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

type localBoundBackupRemoveFake struct {
	*fakeDesktopIPCController
	sourceID uint64
	revision uint64
}

func (f *localBoundBackupRemoveFake) CloudRemoveLocalBoundBackup(_ context.Context, sourceID, revision uint64) (client.LocalBoundBackupRemoval, error) {
	f.sourceID, f.revision = sourceID, revision
	return client.LocalBoundBackupRemoval{SourceID: sourceID, LocalGrantRemoved: true}, nil
}

func TestDesktopIPCLocalBoundRemoveRequiresAuthAndNarrowIDs(t *testing.T) {
	f := &localBoundBackupRemoveFake{fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1}}
	h := newDesktopIPCHandler(f, "secret", func() {})
	valid := desktopIPCRequest(t, h, http.MethodDelete, "/v1/device-backups/local-bound", `{"source_id":42,"revision":7}`)
	if valid.Code != http.StatusOK || f.sourceID != 42 || f.revision != 7 {
		t.Fatalf("remove IPC mismatch status=%d body=%s", valid.Code, valid.Body.String())
	}
	if valid.Header().Get("Cache-Control") != "private, no-store" ||
		!strings.Contains(valid.Body.String(), `"local_grant_removed":true`) {
		t.Fatalf("missing no-store cleanup ack: %s", valid.Body.String())
	}
	for _, forbidden := range []string{"root_id", "root_fingerprint", "device_token", "local_path"} {
		if strings.Contains(valid.Body.String(), forbidden) {
			t.Fatalf("response leaked %s", forbidden)
		}
	}
	for _, body := range []string{
		`{"source_id":0,"revision":7}`,
		`{"source_id":42,"revision":0}`,
		`{"source_id":42,"revision":7,"device_id":"forged"}`,
		`{"source_id":42,"revision":7,"root_id":"spoof"}`,
	} {
		bad := desktopIPCRequest(t, h, http.MethodDelete, "/v1/device-backups/local-bound", body)
		if bad.Code != http.StatusBadRequest {
			t.Fatalf("invalid body accepted (%s): %d", body, bad.Code)
		}
	}
	anonymous := httptest.NewRequest(http.MethodDelete, "http://127.0.0.1/v1/device-backups/local-bound", strings.NewReader(`{"source_id":42,"revision":7}`))
	anonymous.RemoteAddr = "127.0.0.1:43210"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, anonymous)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("missing IPC auth allowed: %d", rec.Code)
	}
}

func TestDesktopIPCLocalBoundRemoveCannotUseGenericSourceFallback(t *testing.T) {
	h := newDesktopIPCHandler(&fakeDesktopIPCController{revision: 1}, "secret", func() {})
	result := desktopIPCRequest(t, h, http.MethodDelete, "/v1/device-backups/local-bound", `{"source_id":42,"revision":7}`)
	if result.Code != http.StatusNotImplemented {
		t.Fatalf("generic removal fallback accepted: %d", result.Code)
	}
}
