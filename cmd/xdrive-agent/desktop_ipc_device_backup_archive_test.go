package main

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

type localBoundBackupArchiveFake struct {
	*fakeDesktopIPCController
	loadedID                   uint64
	archiveID, archiveRevision uint64
	restoreID, restoreRevision uint64
}

func (f *localBoundBackupArchiveFake) CloudLocalBoundBackupArchiveSettings(_ context.Context, sourceID uint64) (client.LocalBoundBackupSettings, error) {
	f.loadedID = sourceID
	return client.LocalBoundBackupSettings{SourceID: sourceID, Name: "Photos", Revision: 7, Status: "active"}, nil
}

func (f *localBoundBackupArchiveFake) CloudArchiveLocalBoundBackup(_ context.Context, sourceID, revision uint64) (client.LocalBoundBackupSettings, error) {
	f.archiveID, f.archiveRevision = sourceID, revision
	return client.LocalBoundBackupSettings{SourceID: sourceID, Name: "Photos", Revision: revision + 1, Status: "archived"}, nil
}

func (f *localBoundBackupArchiveFake) CloudRestoreLocalBoundBackup(_ context.Context, sourceID, revision uint64) (client.LocalBoundBackupSettings, error) {
	f.restoreID, f.restoreRevision = sourceID, revision
	return client.LocalBoundBackupSettings{SourceID: sourceID, Name: "Photos", Revision: revision + 1, Status: "paused"}, nil
}

func TestDesktopIPCLocalBackupArchiveRestoreRequiresAuthenticatedOwningAgentPort(t *testing.T) {
	f := &localBoundBackupArchiveFake{fakeDesktopIPCController: &fakeDesktopIPCController{revision: 1}}
	h := newDesktopIPCHandler(f, "secret", func() {})

	read := desktopIPCRequest(t, h, http.MethodGet, "/v1/device-backups/local-archive-status?source_id=42", "")
	if read.Code != http.StatusOK || f.loadedID != 42 || read.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("archive settings read failed: status=%d body=%s", read.Code, read.Body.String())
	}
	for _, forbidden := range []string{"root_id", "root_fingerprint", "device_token", "local_path"} {
		if strings.Contains(read.Body.String(), forbidden) {
			t.Fatalf("archive settings leaked %s: %s", forbidden, read.Body.String())
		}
	}

	archived := desktopIPCRequest(t, h, http.MethodPost, "/v1/device-backups/local-archive", `{"source_id":42,"revision":7}`)
	if archived.Code != http.StatusOK || f.archiveID != 42 || f.archiveRevision != 7 ||
		!strings.Contains(archived.Body.String(), `"status":"archived"`) {
		t.Fatalf("archive request mismatch: status=%d body=%s", archived.Code, archived.Body.String())
	}
	restored := desktopIPCRequest(t, h, http.MethodPost, "/v1/device-backups/local-restore", `{"source_id":42,"revision":8}`)
	if restored.Code != http.StatusOK || f.restoreID != 42 || f.restoreRevision != 8 ||
		!strings.Contains(restored.Body.String(), `"status":"paused"`) {
		t.Fatalf("restore request mismatch: status=%d body=%s", restored.Code, restored.Body.String())
	}

	for _, body := range []string{
		`{"source_id":0,"revision":7}`,
		`{"source_id":42,"revision":0}`,
		`{"source_id":42,"revision":7,"root_id":"forged"}`,
	} {
		bad := desktopIPCRequest(t, h, http.MethodPost, "/v1/device-backups/local-archive", body)
		if bad.Code != http.StatusBadRequest {
			t.Fatalf("invalid archive body accepted (%s): %d", body, bad.Code)
		}
	}
}

func TestDesktopIPCLocalBackupArchiveCannotFallBackToGenericSourcePort(t *testing.T) {
	h := newDesktopIPCHandler(&fakeDesktopIPCController{revision: 1}, "secret", func() {})
	for _, request := range []struct{ method, path, body string }{
		{http.MethodGet, "/v1/device-backups/local-archive-status?source_id=42", ""},
		{http.MethodPost, "/v1/device-backups/local-archive", `{"source_id":42,"revision":7}`},
		{http.MethodPost, "/v1/device-backups/local-restore", `{"source_id":42,"revision":7}`},
	} {
		result := desktopIPCRequest(t, h, request.method, request.path, request.body)
		if result.Code != http.StatusNotImplemented {
			t.Fatalf("generic Source fallback accepted %s %s: %d", request.method, request.path, result.Code)
		}
	}
}
