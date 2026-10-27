package synologyui

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

type ownerReadFixtureAgent struct {
	*fakeAgent
	overviewReads int
	historyReads  int
	forgeSource   bool
	serverError   bool
}

func (f *ownerReadFixtureAgent) DeviceBackupOverview(context.Context) (localbackupipc.DeviceBackupOverview, error) {
	f.overviewReads++
	if f.serverError {
		return localbackupipc.DeviceBackupOverview{}, errors.New("PRIVATE Server Owner token")
	}
	return client.DeviceBackupOverview{
		Devices: []client.DeviceBackupDevice{{
			ID:   "10000000-0000-4000-8000-000000000001",
			Name: "Remote Linux", Platform: "linux", ConnectionState: "offline",
			Folders: []client.DeviceBackupFolder{},
		}},
	}, nil
}

func (f *ownerReadFixtureAgent) DeviceBackupRuns(_ context.Context, sourceID uint64, limit, offset int) (localbackupipc.DeviceBackupRunPage, error) {
	f.historyReads++
	if f.serverError || sourceID != 42 {
		return localbackupipc.DeviceBackupRunPage{}, errors.New("PRIVATE foreign Server source")
	}
	if f.forgeSource {
		sourceID = 99
	}
	return client.DeviceBackupRunPage{
		Items: []client.DeviceBackupRun{{ID: "run.1", SourceID: sourceID, RunNumber: 1, Mode: "backup", Trigger: "manual", Status: "partial"}},
	}, nil
}

func TestRemoteOwnerBackupReadStillNeedsDSMAndServerAuthority(t *testing.T) {
	g, local := newFixture(t)
	remote := &ownerReadFixtureAgent{fakeAgent: local}
	g.Connect = func(context.Context) (Agent, error) { return remote, nil }
	handler := CGIHandler(g)
	ask := func(method, query string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, "https://nas.example:5001"+DSMCGIPath+query, nil)
		r.Header.Set("Cookie", "id=dsm-session")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	if w := ask(http.MethodGet, "?op=device-backups"); w.Code != http.StatusOK ||
		!strings.Contains(w.Body.String(), "Remote Linux") ||
		strings.Contains(w.Body.String(), "root_fingerprint") {
		t.Fatalf("owner device projection unavailable: HTTP %d %s", w.Code, w.Body.String())
	}
	if w := ask(http.MethodGet, "?op=device-backup-runs&source_id=42&limit=20&offset=0"); w.Code != http.StatusOK ||
		!strings.Contains(w.Body.String(), `"source_id":42`) {
		t.Fatalf("owner run projection unavailable: HTTP %d %s", w.Code, w.Body.String())
	}
	if remote.overviewReads != 1 || remote.historyReads != 1 || local.runs != 0 || local.controls != 0 {
		t.Fatal("remote Owner read triggered native task mutation")
	}
	bad := []string{
		"?op=device-backups&source_id=42",
		"?op=device-backup-runs&source_id=42&source_id=42&limit=20&offset=0",
		"?op=device-backup-runs&source_id=42&limit=21&offset=0",
		"?op=device-backup-runs&source_id=0&limit=20&offset=0",
		"?op=device-backup-runs&source_id=042&limit=20&offset=0",
		"?op=device-backup-runs&source_id=42&limit=20&offset=-1",
		"?op=device-backup-runs&source_id=42&limit=20&offset=100000",
		"?op=device-backup-runs&source_id=42&limit=20&offset=0&action=cancel",
		"?op=device-backup-runs&source_id=42&limit=20&offset=0;action=cancel",
		"?op=device-backup-runs&source_id=42&limit=20&offset=0&limit=20",
		"?op=device-backup-runs&source_id=42&limit=20&offset=0&op=run",
	}
	for _, query := range bad {
		if w := ask(http.MethodGet, query); w.Code == http.StatusOK {
			t.Fatalf("unapproved owner history read admitted: %s", query)
		}
	}
	if remote.overviewReads != 1 || remote.historyReads != 1 || local.runs != 0 {
		t.Fatal("invalid query reached Server Owner read or local writer")
	}
	if w := ask(http.MethodPost, "?op=device-backups"); w.Code == http.StatusOK {
		t.Fatal("remote read projection accepted POST")
	}
	if w := ask(http.MethodGet, "?op=device-backup-runs&source_id=99&limit=20&offset=0"); w.Code == http.StatusOK {
		t.Fatal("foreign Server Owner Source admitted")
	}
	remote.forgeSource = true
	if w := ask(http.MethodGet, "?op=device-backup-runs&source_id=42&limit=20&offset=0"); w.Code == http.StatusOK {
		t.Fatal("Agent Source mismatch leaked to DSM")
	}
	remote.forgeSource = false
	remote.serverError = true
	if w := ask(http.MethodGet, "?op=device-backups"); w.Code != http.StatusServiceUnavailable ||
		strings.Contains(w.Body.String(), "PRIVATE") {
		t.Fatal("private Server error leaked to browser")
	}
	g.Authenticate = func(context.Context) (string, error) { return "other", nil }
	before := remote.overviewReads
	if w := ask(http.MethodGet, "?op=device-backups"); w.Code != http.StatusForbidden ||
		before != remote.overviewReads {
		t.Fatal("unauthorized DSM user read Agent Server account")
	}
}

func TestRemoteOwnerBackupOldAgentFailsClosed(t *testing.T) {
	g, agent := newFixture(t)
	for _, path := range []string{
		"/v1/device-backups",
		"/v1/device-backup-runs?source_id=42&limit=20&offset=0",
	} {
		if w := request(g, http.MethodGet, path, "", ""); w.Code != http.StatusNotImplemented {
			t.Fatalf("old Agent has no B-scope port: %s HTTP %d", path, w.Code)
		}
	}
	if agent.runs != 0 || agent.controls != 0 {
		t.Fatal("missing remote capability triggered a local operation")
	}
}

type remotePagerFixtureAgent struct {
	*ownerReadFixtureAgent
	devicePageReads int
	folderPageReads int
	invalidRows     bool
}

func (f *remotePagerFixtureAgent) DeviceBackupOverviewPage(_ context.Context, limit int, afterDeviceID string) (localbackupipc.DeviceBackupOverview, error) {
	f.devicePageReads++
	if limit != 100 || afterDeviceID != "10000000-0000-4000-8000-000000000001" {
		return localbackupipc.DeviceBackupOverview{}, errors.New("unexpected Owner device cursor")
	}
	return client.DeviceBackupOverview{
		Devices: []client.DeviceBackupDevice{{
			ID:   "10000000-0000-4000-8000-000000000002",
			Name: "Second device", Platform: "windows", ConnectionState: "offline",
			Folders: []client.DeviceBackupFolder{},
		}},
	}, nil
}

func (f *remotePagerFixtureAgent) DeviceBackupFoldersPage(_ context.Context, deviceID string, limit int, after uint64) (localbackupipc.DeviceBackupFolderPage, error) {
	f.folderPageReads++
	if deviceID != "10000000-0000-4000-8000-000000000001" || limit != 100 || after != 0 {
		return localbackupipc.DeviceBackupFolderPage{}, errors.New("unexpected Owner folder cursor")
	}
	id := uint64(42)
	if f.invalidRows {
		id = 0
	}
	return client.DeviceBackupFolderPage{
		Folders: []client.DeviceBackupFolder{{SourceID: id, Name: "Owned remote", SyncMode: "backup", Status: "idle"}},
	}, nil
}

func TestRemoteOwnerKeysetAndFoldersAreReadOnlyAndNeverNative(t *testing.T) {
	g, native := newFixture(t)
	pager := &remotePagerFixtureAgent{ownerReadFixtureAgent: &ownerReadFixtureAgent{fakeAgent: native}}
	g.Connect = func(context.Context) (Agent, error) { return pager, nil }
	call := func(query string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest("GET", "https://nas.example:5001"+DSMCGIPath+query, nil)
		req.Header.Set("Cookie", "id=dsm-session")
		w := httptest.NewRecorder()
		CGIHandler(g).ServeHTTP(w, req)
		return w
	}
	for _, query := range []string{
		"?op=device-backup-page&limit=100&after_device_id=10000000-0000-4000-8000-000000000001",
		"?op=device-backup-folders&limit=100&device_id=10000000-0000-4000-8000-000000000001",
	} {
		w := call(query)
		if w.Code != http.StatusOK {
			t.Fatalf("authenticated Owner keyset/folder GET failed: %s %d", query, w.Code)
		}
	}
	if pager.devicePageReads != 1 || pager.folderPageReads != 1 || native.runs != 0 || native.controls != 0 {
		t.Fatal("Owner read invoked the native Runner or extra Agent requests")
	}
	for _, invalid := range []string{
		"?op=device-backup-page&limit=0&after_device_id=10000000-0000-4000-8000-000000000001",
		"?op=device-backup-page&limit=101&after_device_id=10000000-0000-4000-8000-000000000001",
		"?op=device-backup-page&limit=100&after_device_id=not-uuid",
		"?op=device-backup-page&limit=100&after_device_id=10000000-0000-4000-8000-000000000001&action=cancel",
		"?op=device-backup-page&limit=100&after_device_id=10000000-0000-4000-8000-000000000001&after_device_id=10000000-0000-4000-8000-000000000002",
		"?op=device-backup-folders&limit=100&device_id=not-uuid",
		"?op=device-backup-folders&limit=100&device_id=10000000-0000-4000-8000-000000000001&after_source_id=0",
		"?op=device-backup-folders&limit=100&device_id=10000000-0000-4000-8000-000000000001&after_source_id=042",
		"?op=device-backup-folders&limit=100&device_id=10000000-0000-4000-8000-000000000001&foo=42",
		"?op=device-backup-folders&limit=100&device_id=10000000-0000-4000-8000-000000000001&after_source_id=42&after_source_id=43",
		"?op=device-backup-folders&limit=100&device_id=10000000-0000-4000-8000-000000000001&op=run",
	} {
		if w := call(invalid); w.Code == http.StatusOK {
			t.Fatalf("invalid Owner pagination selector accepted: %s", invalid)
		}
	}
	if pager.devicePageReads != 1 || pager.folderPageReads != 1 {
		t.Fatal("invalid Owner selector reached existing Agent")
	}
	pager.invalidRows = true
	if w := call("?op=device-backup-folders&limit=100&device_id=10000000-0000-4000-8000-000000000001"); w.Code == http.StatusOK {
		t.Fatal("invalid folder SourceID accepted")
	}
	g.Authenticate = func(context.Context) (string, error) { return "other", nil }
	if w := call("?op=device-backup-page&limit=100&after_device_id=10000000-0000-4000-8000-000000000001"); w.Code != http.StatusForbidden {
		t.Fatal("foreign DSM account read Server Owner pagination")
	}
}
