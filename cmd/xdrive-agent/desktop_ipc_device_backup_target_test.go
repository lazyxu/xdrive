package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

type localTargetWriterFake struct {
	*fakeDesktopIPCController
	sourceID uint64
	revision uint64
	targetID uint64
}

func (f *localTargetWriterFake) CloudRetargetLocalBoundBackup(_ context.Context, sourceID, revision, targetID uint64) (client.LocalBoundBackupSettings, error) {
	f.sourceID, f.revision, f.targetID = sourceID, revision, targetID
	return client.LocalBoundBackupSettings{SourceID: sourceID, Name: "backup", Revision: revision + 1, TargetNodeID: &targetID, TargetPath: "Archive"}, nil
}

func TestDesktopIPCLocalTargetRequiresAuthAndNarrowIDs(t *testing.T) {
	f := &localTargetWriterFake{fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1}}
	h := newDesktopIPCHandler(f, "secret", func() {})
	valid := desktopIPCRequest(t, h, http.MethodPatch, "/v1/device-backups/local-target", `{"source_id":42,"revision":7,"target_node_id":81}`)
	if valid.Code != http.StatusOK || f.sourceID != 42 || f.revision != 7 || f.targetID != 81 {
		t.Fatalf("bad target update status=%d body=%s", valid.Code, valid.Body.String())
	}
	if valid.Header().Get("Cache-Control") != "private, no-store" ||
		!strings.Contains(valid.Body.String(), `"target_node_id":81`) {
		t.Fatalf("target response invalid or cacheable: %s", valid.Body.String())
	}
	for _, forbidden := range []string{"device_token", "root_id", "root_fingerprint", "local_path", "checkpoint"} {
		if strings.Contains(valid.Body.String(), forbidden) {
			t.Fatalf("local target response leaked %s", forbidden)
		}
	}
	for _, body := range []string{
		`{"source_id":0,"revision":7,"target_node_id":81}`,
		`{"source_id":42,"revision":0,"target_node_id":81}`,
		`{"source_id":42,"revision":7,"target_node_id":0}`,
		`{"source_id":42,"revision":7,"target_node_id":81,"device_id":"forged"}`,
		`{"source_id":42,"revision":7,"target_node_id":81,"root_id":"spoofed"}`,
	} {
		if bad := desktopIPCRequest(t, h, http.MethodPatch, "/v1/device-backups/local-target", body); bad.Code != http.StatusBadRequest {
			t.Fatalf("invalid native target accepted (%s): %d", body, bad.Code)
		}
	}
	anon := httptest.NewRequest(http.MethodPatch, "http://127.0.0.1/v1/device-backups/local-target", strings.NewReader(`{"source_id":42,"revision":7,"target_node_id":81}`))
	anon.RemoteAddr = "127.0.0.1:43210"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, anon)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized local target edit accepted: %d", rec.Code)
	}
}

func TestDesktopIPCLocalTargetCannotFallBackToGenericSources(t *testing.T) {
	h := newDesktopIPCHandler(&fakeDesktopIPCController{revision: 1}, "secret", func() {})
	result := desktopIPCRequest(t, h, http.MethodPatch, "/v1/device-backups/local-target", `{"source_id":42,"revision":7,"target_node_id":81}`)
	if result.Code != http.StatusNotImplemented {
		t.Fatalf("unexpected generic Source mutation fallback: %d", result.Code)
	}
}
