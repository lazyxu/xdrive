package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestBackupOnlyNotesUsesExactRouteAndCurrentOwnerPort(t *testing.T) {
	ctrl := &notesIPCControllerFixture{desktopIPCController: &fakeDesktopIPCController{revision: 1}}
	backup := newDesktopIPCHandler(ctrl, "secret", nil, true)

	hello := invokeNotesIPC(backup, http.MethodGet, "/v1/hello", "", "secret")
	var identity desktopIPCHello
	if hello.Code != http.StatusOK || json.Unmarshal(hello.Body.Bytes(), &identity) != nil {
		t.Fatalf("Backup-only Notes hello unavailable: %d %s", hello.Code, hello.Body.String())
	}
	if identity.RuntimeMode != agentRuntimeBackupOnly {
		t.Fatalf("unexpected Agent runtime: %q", identity.RuntimeMode)
	}
	notesPresent := false
	for _, capability := range identity.Capabilities {
		if capability == "cloud-notes" {
			notesPresent = true
		}
		if capability == "sync-control" || capability == "client-update" ||
			capability == "cloud-files" {
			t.Fatalf("Backup-only advertised full Agent capability %q", capability)
		}
	}
	if !notesPresent {
		t.Fatal("Owner Notes capability was not advertised")
	}

	for _, tc := range []struct{ method, path, body string; want int }{
		{http.MethodPost, "/v1/cloud/notes/namespace", "", http.StatusOK},
		{http.MethodGet, "/v1/cloud/notes?source=mine", "", http.StatusOK},
		{http.MethodGet, "/v1/cloud/notes/" + ipcNotesTestID, "", http.StatusOK},
		{http.MethodPost, "/v1/cloud/notes", `{"title":"Test","markdown":"text"}`, http.StatusCreated},
		{http.MethodPut, "/v1/cloud/notes/" + ipcNotesTestID, `{"title":"Test","markdown":"text","expected_revision":1}`, http.StatusOK},
		{http.MethodDelete, "/v1/cloud/notes/" + ipcNotesTestID + "?revision=2", "", http.StatusNoContent},
		{http.MethodGet, "/v1/cloud/notes/" + ipcNotesTestID + "/versions", "", http.StatusOK},
		{http.MethodGet, "/v1/cloud/notes/version-content?node_id=87&version_id=91", "", http.StatusOK},
	} {
		result := invokeNotesIPC(backup, tc.method, tc.path, tc.body, "secret")
		if result.Code != tc.want {
			t.Fatalf("Notes route %s %s: HTTP %d, expected %d, %s",
				tc.method, tc.path, result.Code, tc.want, result.Body.String())
		}
	}
	if len(ctrl.calls) != 8 {
		t.Fatalf("expected exactly eight Owner Notes methods, got %v", ctrl.calls)
	}

	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/v1/cloud/notes/not-a-uuid"},
		{http.MethodGet, "/v1/cloud/notes/" + ipcNotesTestID + "/images/anything"},
		{http.MethodPost, "/v1/cloud/notes/" + ipcNotesTestID},
		{http.MethodDelete, "/v1/cloud/notes"},
		{http.MethodPut, "/v1/cloud/notes/namespace"},
		{http.MethodPost, "/v1/cloud/notes/version-content"},
		{http.MethodGet, "/v1/cloud/notes/" + strings.ToUpper(ipcNotesTestID)},
		{http.MethodGet, "/v1/cloud/notes/" + ipcNotesTestID + "/versions/anything"},
		{http.MethodPost, "/v1/cloud/root"},
		{http.MethodGet, "/v1/admin/users"},
	} {
		if !fullAgentOnlyRequest(tc.method, tc.path) {
			t.Fatalf("unlisted Backup-only route admitted: %s %s", tc.method, tc.path)
		}
	}
	unauthorized := invokeNotesIPC(backup, http.MethodGet,
		"/v1/cloud/notes?source=mine", "", "wrong")
	if unauthorized.Code != http.StatusUnauthorized || len(ctrl.calls) != 8 {
		t.Fatalf("unauthorized Notes read invoked Owner: %d %v", unauthorized.Code, ctrl.calls)
	}
	unknown := newDesktopIPCHandler(&fakeDesktopIPCController{revision: 1}, "secret", nil, true)
	noCapability := invokeNotesIPC(unknown, http.MethodGet, "/v1/hello", "", "secret")
	var h desktopIPCHello
	if json.Unmarshal(noCapability.Body.Bytes(), &h) != nil {
		t.Fatal("Agent without Notes returned invalid hello")
	}
	for _, cap := range h.Capabilities {
		if cap == "cloud-notes" {
			t.Fatal("Agent without Notes Owner methods advertised them")
		}
	}
	noNotes := invokeNotesIPC(unknown, http.MethodGet, "/v1/cloud/notes?source=mine", "", "secret")
	if noNotes.Code != http.StatusNotImplemented {
		t.Fatalf("Agent without Notes methods did not fail closed: HTTP %d", noNotes.Code)
	}
}
