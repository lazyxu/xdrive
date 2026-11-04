package main

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

// Embedding the existing fake verifies the optional interface does not
// inflate desktopIPCController or break all unrelated IPC test fixtures.
type recentFolderOptionalDesktopController struct {
	*fakeDesktopIPCController
	touched uint64
	cleared bool
}

func (f *recentFolderOptionalDesktopController) CloudFileRecentFolder(context.Context, int) ([]client.FileRecentItem, error) {
	return []client.FileRecentItem{}, nil
}

func (f *recentFolderOptionalDesktopController) CloudTouchFileRecentFolder(_ context.Context, id uint64) (client.FileRecentItem, error) {
	f.touched = id
	return client.FileRecentItem{Node: client.Node{ID: id}}, nil
}

func (f *recentFolderOptionalDesktopController) CloudClearFileRecentFolder(context.Context) error {
	f.cleared = true
	return nil
}

func recentFoldersAdvertised(t *testing.T, h http.Handler) bool {
	t.Helper()
	response := desktopIPCRequest(t, h, http.MethodGet, "/v1/hello", "")
	if response.Code != http.StatusOK {
		t.Fatalf("hello status=%d body=%s", response.Code, response.Body.String())
	}
	var hello desktopIPCHello
	if err := json.Unmarshal(response.Body.Bytes(), &hello); err != nil {
		t.Fatal(err)
	}
	for _, capability := range hello.Capabilities {
		if capability == "file-recent-folders" {
			return true
		}
	}
	return false
}

func TestDesktopIPCRecentFoldersAreOptionalAndCapabilityGated(t *testing.T) {
	legacy := newDesktopIPCHandler(&fakeDesktopIPCController{}, "secret", nil)
	if recentFoldersAdvertised(t, legacy) {
		t.Fatal("legacy controller must not advertise confirmed folder history")
	}
	for _, request := range []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodGet, "/v1/cloud/recent-folders", ""},
		{http.MethodPost, "/v1/cloud/recent-folders/touch", `{"id":42}`},
		{http.MethodDelete, "/v1/cloud/recent-folders", ""},
	} {
		result := desktopIPCRequest(t, legacy, request.method, request.path, request.body)
		if result.Code != http.StatusNotImplemented {
			t.Fatalf("legacy folder request %s %s returned %d: %s",
				request.method, request.path, result.Code, result.Body.String())
		}
	}

	controller := &recentFolderOptionalDesktopController{
		fakeDesktopIPCController: &fakeDesktopIPCController{},
	}
	enabled := newDesktopIPCHandler(controller, "secret", nil)
	if !recentFoldersAdvertised(t, enabled) {
		t.Fatal("capability must be advertised only by supported controller")
	}
	if got := desktopIPCRequest(t, enabled, http.MethodGet, "/v1/cloud/recent-folders", ""); got.Code != http.StatusOK {
		t.Fatalf("list recent folders: %d %s", got.Code, got.Body.String())
	}
	if got := desktopIPCRequest(t, enabled, http.MethodPost, "/v1/cloud/recent-folders/touch", `{"id":42}`); got.Code != http.StatusOK || controller.touched != 42 {
		t.Fatalf("touch recent folder: %d %s", got.Code, got.Body.String())
	}
	if got := desktopIPCRequest(t, enabled, http.MethodDelete, "/v1/cloud/recent-folders", ""); got.Code != http.StatusOK || !controller.cleared {
		t.Fatalf("clear recent folders: %d %s", got.Code, got.Body.String())
	}

	if recentFoldersAdvertised(t, newDesktopIPCHandler(controller, "secret", nil, true)) {
		t.Fatal("backup-only Agent must not advertise file Recent folder controls")
	}
}
