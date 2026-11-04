package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

const ipcNotesTestID = "12345678-1234-1234-1234-123456789abc"

type notesIPCControllerFixture struct {
	desktopIPCController
	calls []string
}

func (f *notesIPCControllerFixture) receipt(markdown string, revision uint64) client.NotesRow {
	sum := sha256.Sum256([]byte(markdown))
	return client.NotesRow{
		ID: ipcNotesTestID, Source: "mine", Title: "Test",
		NodeID: 87, Revision: revision, SHA256: hex.EncodeToString(sum[:]),
		Bytes: int64(len([]byte(markdown))),
	}
}

func (f *notesIPCControllerFixture) CloudNotesInitialize(context.Context) (client.NotesNamespace, error) {
	f.calls = append(f.calls, "initialize")
	return client.NotesNamespace{SystemNodeID: 5, NotesNodeID: 6,
		IOSBackupNodeID: 7, MyNotesNodeID: 8}, nil
}
func (f *notesIPCControllerFixture) CloudNotesList(_ context.Context, source, q string, offset int) (client.NotesPage, error) {
	f.calls = append(f.calls, "list:"+source+":"+q)
	return client.NotesPage{Items: []client.NotesRow{f.receipt("text", 1)}}, nil
}
func (f *notesIPCControllerFixture) CloudNotesRead(_ context.Context, id string) (client.NotesDetail, error) {
	f.calls = append(f.calls, "read:"+id)
	return client.NotesDetail{NotesRow: f.receipt("text", 1), Markdown: "text"}, nil
}
func (f *notesIPCControllerFixture) CloudNotesCreate(_ context.Context, write client.NotesWrite) (client.NotesRow, error) {
	f.calls = append(f.calls, "create:"+write.Title)
	return f.receipt(write.Markdown, 1), nil
}
func (f *notesIPCControllerFixture) CloudNotesImportIOS(
	_ context.Context, write client.NotesImportWrite,
) (client.NotesRow, error) {
	f.calls = append(f.calls, "import-ios:"+write.ExternalID)
	row := f.receipt(write.Markdown, 1)
	row.Source = "ios_notes"
	row.Title = write.Title
	return row, nil
}
func (f *notesIPCControllerFixture) CloudNotesUpdate(_ context.Context, id string, write client.NotesWrite) (client.NotesRow, error) {
	f.calls = append(f.calls, "update:"+id)
	return f.receipt(write.Markdown, 2), nil
}
func (f *notesIPCControllerFixture) CloudNotesDelete(_ context.Context, id string, revision uint64) error {
	f.calls = append(f.calls, "delete:"+id)
	return nil
}
func (f *notesIPCControllerFixture) CloudNotesVersions(_ context.Context, id string) (client.NotesVersions, error) {
	f.calls = append(f.calls, "versions:"+id)
	return client.NotesVersions{NodeID: 87, Items: []client.NotesVersion{
		{ID: 91, Revision: 1, SHA256: f.receipt("text", 1).SHA256, Bytes: 4},
	}}, nil
}
func (f *notesIPCControllerFixture) CloudNotesReadVersion(_ context.Context, nodeID, versionID uint64) (string, error) {
	f.calls = append(f.calls, "history")
	return "text", nil
}

func invokeNotesIPC(h http.Handler, method, path, body, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.RemoteAddr = "127.0.0.1:1234"
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	result := httptest.NewRecorder()
	h.ServeHTTP(result, req)
	return result
}

func TestDesktopNotesIPCRequiresLoopbackAndOwnerMethods(t *testing.T) {
	f := &notesIPCControllerFixture{}
	h := newDesktopIPCHandler(f, "secret", nil)
	unauthorized := invokeNotesIPC(h, http.MethodPost, "/v1/cloud/notes/namespace", "", "")
	if unauthorized.Code != http.StatusUnauthorized || len(f.calls) != 0 {
		t.Fatalf("unverified IPC accessed Notes: %d, %v", unauthorized.Code, f.calls)
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/cloud/notes/namespace", nil)
	req.RemoteAddr = "203.0.113.1:1234"
	req.Header.Set("Authorization", "Bearer secret")
	result := httptest.NewRecorder()
	h.ServeHTTP(result, req)
	if result.Code != http.StatusForbidden {
		t.Fatalf("non-loopback Notes IPC accepted: %d", result.Code)
	}
	ns := invokeNotesIPC(h, http.MethodPost, "/v1/cloud/notes/namespace", "", "secret")
	if ns.Code != http.StatusOK || !strings.Contains(ns.Body.String(), "\"ios_backup_node_id\":7") {
		t.Fatalf("Notes namespace not returned: %d %s", ns.Code, ns.Body.String())
	}
	list := invokeNotesIPC(h, http.MethodGet, "/v1/cloud/notes?source=mine&q=%E4%B8%AD%E6%96%87", "", "secret")
	if list.Code != http.StatusOK || len(f.calls) < 2 || f.calls[1] != "list:mine:中文" {
		t.Fatalf("unexpected Notes list: %d %v", list.Code, f.calls)
	}
	read := invokeNotesIPC(h, http.MethodGet, "/v1/cloud/notes/"+ipcNotesTestID, "", "secret")
	var detail client.NotesDetail
	if err := json.Unmarshal(read.Body.Bytes(), &detail); err != nil || detail.Markdown != "text" {
		t.Fatalf("Owner notes detail failed: %v %s", err, read.Body.String())
	}
	created := invokeNotesIPC(h, http.MethodPost, "/v1/cloud/notes", `{"title":"Test","markdown":"# Test"}`, "secret")
	if created.Code != http.StatusCreated {
		t.Fatalf("notes create returned %d: %s", created.Code, created.Body.String())
	}
	saved := invokeNotesIPC(h, http.MethodPut, "/v1/cloud/notes/"+ipcNotesTestID, `{"title":"Test","markdown":"updated","expected_revision":1}`, "secret")
	if saved.Code != http.StatusOK || !strings.Contains(saved.Body.String(), "\"revision\":2") {
		t.Fatalf("notes save failed: %d %s", saved.Code, saved.Body.String())
	}
	deleteFail := invokeNotesIPC(h, http.MethodDelete, "/v1/cloud/notes/"+ipcNotesTestID, "", "secret")
	if deleteFail.Code != http.StatusBadRequest {
		t.Fatalf("missing revision did not fail: %d", deleteFail.Code)
	}
	deleted := invokeNotesIPC(h, http.MethodDelete, "/v1/cloud/notes/"+ipcNotesTestID+"?revision=2", "", "secret")
	if deleted.Code != http.StatusNoContent {
		t.Fatalf("Notes delete failed: %d %s", deleted.Code, deleted.Body.String())
	}
	versions := invokeNotesIPC(h, http.MethodGet, "/v1/cloud/notes/"+ipcNotesTestID+"/versions", "", "secret")
	if versions.Code != http.StatusOK {
		t.Fatalf("Notes versions failed: %d", versions.Code)
	}
	old := invokeNotesIPC(h, http.MethodGet, "/v1/cloud/notes/version-content?node_id=87&version_id=91", "", "secret")
	if old.Code != http.StatusOK || !strings.Contains(old.Body.String(), "\"markdown\":\"text\"") {
		t.Fatalf("Notes old Markdown was not preserved: %d %s", old.Code, old.Body.String())
	}
}


func TestDesktopNotesManualIOSImportIsExplicitAndBackupOnlyBounded(t *testing.T) {
	f := &notesIPCControllerFixture{}
	h := newDesktopIPCHandler(f, "secret", nil)
	body := `{"title":"Manual export","markdown":"# Apple","external_id":"manual:00000000-0000-4000-8000-000000000001"}`
	res := invokeNotesIPC(h, http.MethodPost, "/v1/cloud/notes/import-ios", body, "secret")
	if res.Code != http.StatusCreated {
		t.Fatalf("manual iOS Notes import failed: %d %s", res.Code, res.Body.String())
	}
	var row client.NotesRow
	if err := json.Unmarshal(res.Body.Bytes(), &row); err != nil {
		t.Fatal(err)
	}
	if row.Source != "ios_notes" || row.Title != "Manual export" || row.Revision != 1 {
		t.Fatalf("manual import did not return a read-only archive row: %+v", row)
	}
	if len(f.calls) != 1 || !strings.HasPrefix(f.calls[0], "import-ios:manual:") {
		t.Fatalf("unexpected manual import calls: %v", f.calls)
	}
	backup := newDesktopIPCHandler(f, "secret", nil, true)
	res = invokeNotesIPC(backup, http.MethodPost, "/v1/cloud/notes/import-ios", body, "secret")
	if res.Code != http.StatusCreated {
		t.Fatalf("Backup-only manual iOS import unavailable: %d %s", res.Code, res.Body.String())
	}
	if fullAgentOnlyRequest(http.MethodPost, "/v1/cloud/notes/import-ios") ||
		!fullAgentOnlyRequest(http.MethodGet, "/v1/cloud/notes/import-ios") ||
		!fullAgentOnlyRequest(http.MethodPut, "/v1/cloud/notes/import-ios") {
		t.Fatal("Backup-only iOS import route must admit POST only")
	}
	before := len(f.calls)
	for _, invalid := range []string{
		`{"title":"Manual export","markdown":"# Apple","external_id":"native-apple-id"}`,
		`{"title":"Manual export","markdown":"# Apple","external_id":"manual:00000000-0000-4000-8000-000000000001","unexpected":true}`,
	} {
		res = invokeNotesIPC(h, http.MethodPost, "/v1/cloud/notes/import-ios", invalid, "secret")
		if res.Code < 400 {
			t.Fatalf("invalid manual import body admitted: %d %s", res.Code, res.Body.String())
		}
	}
	if len(f.calls) != before {
		t.Fatalf("invalid manual import reached Owner controller: %v", f.calls)
	}
}
