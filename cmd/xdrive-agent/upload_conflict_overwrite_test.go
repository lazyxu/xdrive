package main

import (
	"net/http"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestDesktopIPCUploadConflictOverwrite(t *testing.T) {
	ctrl := &fakeDesktopIPCController{
		revision: 1,
		cloudUploaded: client.Node{
			ID: 9, ParentID: ptrUint64(2), Name: "upload.txt", Type: "file", Revision: 2,
		},
	}
	handler := newDesktopIPCHandler(ctrl, "secret", func() {})

	preflight := desktopIPCRequest(
		t, handler, http.MethodPost, "/v1/cloud/upload/preflight",
		`{"parent_id":2,"name":"upload.txt"}`,
	)
	if preflight.Code != http.StatusOK ||
		!strings.Contains(preflight.Body.String(), "\"target_type\":\"file\"") ||
		!strings.Contains(preflight.Body.String(), "\"can_overwrite\":true") {
		t.Fatalf("preflight status=%d body=%s", preflight.Code, preflight.Body.String())
	}

	overwrite := desktopIPCRequest(
		t, handler, http.MethodPost, "/v1/cloud/upload/conflict",
		`{"parent_id":2,"local_path":"/tmp/upload.txt","name":"upload.txt","conflict_policy":"overwrite"}`,
	)
	if overwrite.Code != http.StatusOK {
		t.Fatalf("overwrite status=%d body=%s", overwrite.Code, overwrite.Body.String())
	}
	if ctrl.cloudUploadPolicy != "overwrite" {
		t.Fatalf("overwrite policy not forwarded: %q", ctrl.cloudUploadPolicy)
	}
}
