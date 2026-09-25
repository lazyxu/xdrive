package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/conflictstate"
	"github.com/lazyxu/xdrive/internal/diagnostics"
	"github.com/lazyxu/xdrive/internal/mount"
	"github.com/lazyxu/xdrive/internal/transfer"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

type fakeDesktopIPCController struct {
	snapshot agentSnapshot
	revision uint64
	settings userconfig.Config
	root     string
	items    []conflictstate.Record

	loginServer      string
	loginUsername    string
	loginPassword    string
	loginMount       string
	currentPass      string
	newPass          string
	logouts          int
	paused           *bool
	syncs            int
	updateMount      *string
	updateCache      *int64
	rulePath         string
	ruleMode         string
	filePath         string
	fileAction       string
	fileState        mount.FileAvailability
	openFolderN      int
	openID           string
	openBoth         bool
	resolveID        string
	resolveChoice    string
	err              error
	transfers        *transfer.Manager
	diagnosticReport diagnostics.Report
	reconnectN       int
	repairN          int
	openLogsN        int
	storageTree      agentStorageTreeNode
	cacheStats       mount.CacheStats
	cacheRelease     mount.CacheReleaseResult
	cloudRoot        client.Node
	cloudChildren    []client.Node
	cloudSearch      []agentCloudSearchResult
	cloudQuota       client.QuotaUsage
	cloudTrash       []client.Node
	cloudVersions    []client.FileVersion
	cloudShares      []client.FileShare
	cloudCreated     agentCreatedShare
	cloudRestored    client.Node
	cloudRevokeID    uint64
	cloudDeleteID    uint64
	cloudDeleteRev   uint64
}

func (f *fakeDesktopIPCController) SnapshotWithRevision() (agentSnapshot, uint64) {
	return f.snapshot, f.revision
}

func (f *fakeDesktopIPCController) WaitSnapshot(_ context.Context, after uint64) (agentSnapshot, uint64, bool) {
	return f.snapshot, f.revision, f.revision != after
}

func (f *fakeDesktopIPCController) Authenticate(server, username, password, mountPath string) error {
	f.loginServer, f.loginUsername, f.loginPassword, f.loginMount = server, username, password, mountPath
	return f.err
}

func (f *fakeDesktopIPCController) ChangePassword(currentPassword, newPassword string) error {
	f.currentPass, f.newPass = currentPassword, newPassword
	return f.err
}

func (f *fakeDesktopIPCController) Logout() error {
	f.logouts++
	return f.err
}

func (f *fakeDesktopIPCController) SetPaused(paused bool) error {
	f.paused = &paused
	return f.err
}

func (f *fakeDesktopIPCController) SyncNow() error {
	f.syncs++
	return f.err
}

func (f *fakeDesktopIPCController) Settings() (userconfig.Config, string, error) {
	return f.settings, f.root, f.err
}

func (f *fakeDesktopIPCController) UpdateSettings(mountPath *string, cacheLimitBytes *int64) error {
	f.updateMount, f.updateCache = mountPath, cacheLimitBytes
	return f.err
}

func (f *fakeDesktopIPCController) SetSelectiveSyncRule(path, mode string) error {
	f.rulePath, f.ruleMode = path, mode
	return f.err
}

func (f *fakeDesktopIPCController) StorageTree(context.Context) (agentStorageTreeNode, error) {
	return f.storageTree, f.err
}

func (f *fakeDesktopIPCController) CacheStats() (mount.CacheStats, error) {
	return f.cacheStats, f.err
}

func (f *fakeDesktopIPCController) ReleaseReclaimableCache() (mount.CacheReleaseResult, error) {
	return f.cacheRelease, f.err
}

func (f *fakeDesktopIPCController) CloudRoot(context.Context) (client.Node, error) {
	return f.cloudRoot, f.err
}

func (f *fakeDesktopIPCController) CloudList(context.Context, uint64) ([]client.Node, error) {
	return append([]client.Node(nil), f.cloudChildren...), f.err
}

func (f *fakeDesktopIPCController) CloudSearch(context.Context, string) ([]agentCloudSearchResult, error) {
	return append([]agentCloudSearchResult(nil), f.cloudSearch...), f.err
}

func (f *fakeDesktopIPCController) CloudQuota(context.Context) (client.QuotaUsage, error) {
	return f.cloudQuota, f.err
}

func (f *fakeDesktopIPCController) CloudTrash(context.Context) ([]client.Node, error) {
	return append([]client.Node(nil), f.cloudTrash...), f.err
}

func (f *fakeDesktopIPCController) CloudRestoreTrash(_ context.Context, _, _ uint64) (client.Node, error) {
	return f.cloudRestored, f.err
}

func (f *fakeDesktopIPCController) CloudDeleteTrash(_ context.Context, id, revision uint64) error {
	f.cloudDeleteID, f.cloudDeleteRev = id, revision
	return f.err
}

func (f *fakeDesktopIPCController) CloudVersions(context.Context, uint64) ([]client.FileVersion, error) {
	return append([]client.FileVersion(nil), f.cloudVersions...), f.err
}

func (f *fakeDesktopIPCController) CloudRestoreVersion(context.Context, uint64, uint64, uint64) (client.Node, error) {
	return f.cloudRestored, f.err
}

func (f *fakeDesktopIPCController) CloudShares(context.Context, uint64) ([]client.FileShare, error) {
	return append([]client.FileShare(nil), f.cloudShares...), f.err
}

func (f *fakeDesktopIPCController) CloudCreateShare(context.Context, uint64, client.CreateShareInput) (agentCreatedShare, error) {
	return f.cloudCreated, f.err
}

func (f *fakeDesktopIPCController) CloudRevokeShare(_ context.Context, id uint64) error {
	f.cloudRevokeID = id
	return f.err
}

func (f *fakeDesktopIPCController) FileAvailability(path string) (mount.FileAvailability, error) {
	f.filePath = path
	state := f.fileState
	if state.Path == "" {
		state.Path = path
	}
	return state, f.err
}

func (f *fakeDesktopIPCController) SetFileAvailability(path, action string) error {
	f.filePath, f.fileAction = path, action
	return f.err
}

func (f *fakeDesktopIPCController) Transfers() (uint64, []transfer.Task) {
	if f.transfers == nil {
		return 1, nil
	}
	return f.transfers.Snapshot()
}

func (f *fakeDesktopIPCController) WaitTransfers(ctx context.Context, after uint64) (uint64, []transfer.Task, bool) {
	if f.transfers == nil {
		return 1, nil, after != 1
	}
	return f.transfers.Wait(ctx, after)
}

func (f *fakeDesktopIPCController) RetryTransfer(ctx context.Context, id string) error {
	if f.transfers == nil {
		return errors.New("transfer manager unavailable")
	}
	return f.transfers.Retry(ctx, id)
}

func (f *fakeDesktopIPCController) Diagnostics(context.Context) diagnostics.Report {
	if len(f.diagnosticReport.Checks) == 0 {
		return diagnostics.NewReport([]diagnostics.Check{{Name: "agent process", Status: diagnostics.Pass, Detail: "test"}})
	}
	return f.diagnosticReport
}

func (f *fakeDesktopIPCController) Reconnect(context.Context) error {
	f.reconnectN++
	return f.err
}

func (f *fakeDesktopIPCController) RepairSyncRoot(context.Context) error {
	f.repairN++
	return f.err
}

func (f *fakeDesktopIPCController) OpenLogs() error {
	f.openLogsN++
	return f.err
}

func (f *fakeDesktopIPCController) Conflicts() []conflictstate.Record {
	return append([]conflictstate.Record(nil), f.items...)
}

func (f *fakeDesktopIPCController) OpenConflict(id string, both bool) error {
	f.openID, f.openBoth = id, both
	return f.err
}

func (f *fakeDesktopIPCController) ResolveConflict(id, choice string) error {
	f.resolveID, f.resolveChoice = id, choice
	return f.err
}

func (f *fakeDesktopIPCController) OpenFolder() error {
	f.openFolderN++
	return f.err
}

func desktopIPCRequest(t *testing.T, handler http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, "http://127.0.0.1"+path, strings.NewReader(body))
	req.RemoteAddr = "127.0.0.1:43210"
	req.Header.Set("Authorization", "Bearer secret")
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	return res
}

func TestDesktopIPCHelloAndShutdown(t *testing.T) {
	ctrl := &fakeDesktopIPCController{revision: 1}
	shutdown := make(chan struct{}, 1)
	handler := newDesktopIPCHandler(ctrl, "secret", func() {
		select {
		case shutdown <- struct{}{}:
		default:
		}
	})

	res := desktopIPCRequest(t, handler, http.MethodGet, "/v1/hello", "")
	if res.Code != http.StatusOK {
		t.Fatalf("hello status=%d body=%s", res.Code, res.Body.String())
	}
	var hello desktopIPCHello
	if err := json.NewDecoder(res.Body).Decode(&hello); err != nil {
		t.Fatal(err)
	}
	if hello.ProtocolMin != desktopIPCProtocolMin || hello.ProtocolMax != desktopIPCProtocolMax {
		t.Fatalf("unexpected protocol range: %+v", hello)
	}
	if hello.DiscoveryVersion != desktopIPCAPIVersion || hello.AgentVersion == "" || hello.PID <= 0 {
		t.Fatalf("unexpected hello: %+v", hello)
	}
	if len(hello.Capabilities) == 0 {
		t.Fatal("hello capabilities are empty")
	}

	res = desktopIPCRequest(t, handler, http.MethodPost, "/v1/lifecycle/shutdown", "")
	if res.Code != http.StatusOK {
		t.Fatalf("shutdown status=%d body=%s", res.Code, res.Body.String())
	}
	select {
	case <-shutdown:
	case <-time.After(time.Second):
		t.Fatal("shutdown callback was not invoked")
	}
}

func TestDesktopIPCRequiresLoopbackAndToken(t *testing.T) {
	ctrl := &fakeDesktopIPCController{revision: 1}
	handler := newDesktopIPCHandler(ctrl, "secret", func() {})

	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/v1/status", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("missing token status=%d", res.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "http://127.0.0.1/v1/status", nil)
	req.RemoteAddr = "192.0.2.10:1234"
	req.Header.Set("Authorization", "Bearer secret")
	res = httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusForbidden {
		t.Fatalf("non-loopback status=%d", res.Code)
	}
}

func TestDesktopIPCStatusAndEvents(t *testing.T) {
	ctrl := &fakeDesktopIPCController{
		revision: 7,
		snapshot: agentSnapshot{
			Configured:    true,
			Username:      "alice",
			AuthStatus:    "已登录",
			SyncStatus:    "同步正常",
			ConflictCount: 2,
			HasConflict:   true,
			Version:       "test",
		},
	}
	handler := newDesktopIPCHandler(ctrl, "secret", func() {})

	res := desktopIPCRequest(t, handler, http.MethodGet, "/v1/status", "")
	if res.Code != http.StatusOK {
		t.Fatalf("status code=%d body=%s", res.Code, res.Body.String())
	}
	if !strings.Contains(res.Body.String(), "\"revision\":7") || !strings.Contains(res.Body.String(), "\"username\":\"alice\"") {
		t.Fatalf("unexpected status body: %s", res.Body.String())
	}
	if res.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("missing no-store header")
	}

	res = desktopIPCRequest(t, handler, http.MethodGet, "/v1/events?after_revision=6&timeout_ms=10", "")
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "\"type\":\"status.changed\"") {
		t.Fatalf("event response status=%d body=%s", res.Code, res.Body.String())
	}

	res = desktopIPCRequest(t, handler, http.MethodGet, "/v1/events?after_revision=7&timeout_ms=10", "")
	if res.Code != http.StatusNoContent {
		t.Fatalf("unchanged event status=%d body=%s", res.Code, res.Body.String())
	}
}

func TestDesktopIPCActions(t *testing.T) {
	mountPath := "/tmp/xdrive"
	cache := int64(5 << 30)
	ctrl := &fakeDesktopIPCController{
		revision: 1,
		settings: userconfig.Config{
			CacheLimitBytes: 2 << 30,
			SyncRules:       []userconfig.SyncRule{{Path: "archive", Mode: userconfig.SyncModeExclude}},
		},
		root:      "/existing",
		fileState: mount.FileAvailability{Path: "/tmp/xdrive/a.txt", Mode: "always-local", Placeholder: true, Pinned: true, InSync: true},
		items:     []conflictstate.Record{{ID: "c1", OriginalPath: "a.txt", ConflictPath: "a-conflict.txt"}},
	}
	handler := newDesktopIPCHandler(ctrl, "secret", func() {})

	cases := []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodPost, "/v1/auth/login", `{"server":"https://drive.test","username":"alice","password":"pw","mount_path":"/mnt/x"}`},
		{http.MethodPost, "/v1/auth/change-password", `{"current_password":"old","new_password":"new"}`},
		{http.MethodPost, "/v1/auth/logout", ""},
		{http.MethodPost, "/v1/sync/pause", ""},
		{http.MethodPost, "/v1/sync/resume", ""},
		{http.MethodPost, "/v1/sync/now", ""},
		{http.MethodGet, "/v1/settings", ""},
		{http.MethodPatch, "/v1/settings", `{"mount_path":"/tmp/xdrive","cache_limit_bytes":5368709120}`},
		{http.MethodPut, "/v1/settings/sync-rule", `{"path":"Projects/Archive","mode":"exclude"}`},
		{http.MethodGet, "/v1/file-availability?path=%2Ftmp%2Fxdrive%2Fa.txt", ""},
		{http.MethodPost, "/v1/file-availability", `{"path":"/tmp/xdrive/a.txt","action":"keep"}`},
		{http.MethodGet, "/v1/conflicts", ""},
		{http.MethodPost, "/v1/conflicts/open", `{"id":"c1","both":true}`},
		{http.MethodPost, "/v1/conflicts/resolve", `{"id":"c1","choice":"server"}`},
		{http.MethodPost, "/v1/open-folder", ""},
	}
	for _, tc := range cases {
		res := desktopIPCRequest(t, handler, tc.method, tc.path, tc.body)
		if res.Code != http.StatusOK {
			t.Fatalf("%s %s status=%d body=%s", tc.method, tc.path, res.Code, res.Body.String())
		}
	}

	if ctrl.loginServer != "https://drive.test" || ctrl.loginUsername != "alice" || ctrl.loginPassword != "pw" || ctrl.loginMount != "/mnt/x" {
		t.Fatalf("login args not forwarded")
	}
	if ctrl.currentPass != "old" || ctrl.newPass != "new" || ctrl.logouts != 1 || ctrl.syncs != 1 {
		t.Fatalf("auth/sync actions not forwarded")
	}
	if ctrl.paused == nil || *ctrl.paused {
		t.Fatalf("resume did not leave paused=false")
	}
	if ctrl.updateMount == nil || *ctrl.updateMount != mountPath || ctrl.updateCache == nil || *ctrl.updateCache != cache {
		t.Fatalf("settings update not forwarded: mount=%v cache=%v", ctrl.updateMount, ctrl.updateCache)
	}
	if ctrl.rulePath != "Projects/Archive" || ctrl.ruleMode != "exclude" {
		t.Fatalf("sync rule not forwarded: path=%q mode=%q", ctrl.rulePath, ctrl.ruleMode)
	}
	if ctrl.filePath != "/tmp/xdrive/a.txt" || ctrl.fileAction != "keep" {
		t.Fatalf("file availability action not forwarded: path=%q action=%q", ctrl.filePath, ctrl.fileAction)
	}
	if ctrl.openID != "c1" || !ctrl.openBoth || ctrl.resolveID != "c1" || ctrl.resolveChoice != "server" || ctrl.openFolderN != 1 {
		t.Fatalf("conflict/folder actions not forwarded")
	}
}

func TestDesktopIPCStorageAndCache(t *testing.T) {
	ctrl := &fakeDesktopIPCController{
		revision: 1,
		storageTree: agentStorageTreeNode{
			Name: "xDrive",
			Children: []agentStorageTreeNode{{
				Path: "Projects", Name: "Projects", Mode: "default", EffectiveMode: "default", FileCount: 2, TotalBytes: 30,
			}},
		},
		cacheStats: mount.CacheStats{
			Supported: true, UsedBytes: 100, LimitBytes: 200, ReclaimableBytes: 40, PinnedBytes: 60,
		},
		cacheRelease: mount.CacheReleaseResult{
			Stats:         mount.CacheStats{Supported: true, UsedBytes: 60, LimitBytes: 200, PinnedBytes: 60},
			ReleasedBytes: 40, ReleasedFiles: 2,
		},
	}
	handler := newDesktopIPCHandler(ctrl, "secret", func() {})

	res := desktopIPCRequest(t, handler, http.MethodGet, "/v1/storage-tree", "")
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "\"Projects\"") {
		t.Fatalf("storage tree status=%d body=%s", res.Code, res.Body.String())
	}
	res = desktopIPCRequest(t, handler, http.MethodGet, "/v1/cache", "")
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "\"reclaimable_bytes\":40") {
		t.Fatalf("cache status=%d body=%s", res.Code, res.Body.String())
	}
	res = desktopIPCRequest(t, handler, http.MethodPost, "/v1/cache/release", "")
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "\"released_bytes\":40") {
		t.Fatalf("cache release status=%d body=%s", res.Code, res.Body.String())
	}
}

func TestDesktopIPCCloudFiles(t *testing.T) {
	now := time.Now().UTC()
	ctrl := &fakeDesktopIPCController{
		revision:      1,
		cloudRoot:     client.Node{ID: 1, Name: "root", Type: "dir", Revision: 1},
		cloudChildren: []client.Node{{ID: 2, ParentID: ptrUint64(1), Name: "Projects", Type: "dir", Revision: 1}},
		cloudSearch: []agentCloudSearchResult{{
			Node:   client.Node{ID: 3, Name: "report.pdf", Type: "file", Revision: 2},
			Path:   "Projects/report.pdf",
			Crumbs: []agentCloudCrumb{{ID: 1, Name: "My files"}, {ID: 2, Name: "Projects"}},
		}},
		cloudQuota:    client.QuotaUsage{QuotaBytes: 1000, PhysicalUsedBytes: 400, LogicalFileBytes: 300, TrashBytes: 50, HistoryBytes: 50},
		cloudTrash:    []client.Node{{ID: 4, Name: "old.txt", Type: "file", Revision: 3, DeletedAt: &now}},
		cloudVersions: []client.FileVersion{{ID: 5, NodeID: 3, Revision: 1, Size: 12, CreatedAt: now}},
		cloudShares:   []client.FileShare{{ID: 6, NodeID: 3, Status: "active"}},
		cloudCreated: agentCreatedShare{
			Share: client.CreatedFileShare{FileShare: client.FileShare{ID: 7, NodeID: 3, Status: "active"}, Token: "token"},
			URL:   "https://drive.example/#/s/token",
		},
		cloudRestored: client.Node{ID: 3, Name: "report.pdf", Type: "file", Revision: 4},
	}
	handler := newDesktopIPCHandler(ctrl, "secret", func() {})

	cases := []struct {
		method string
		path   string
		body   string
		want   string
	}{
		{http.MethodGet, "/v1/cloud/root", "", "\"id\":1"},
		{http.MethodGet, "/v1/cloud/children?parent_id=1", "", "\"Projects\""},
		{http.MethodGet, "/v1/cloud/search?q=report", "", "\"Projects/report.pdf\""},
		{http.MethodGet, "/v1/cloud/quota", "", "\"physical_used_bytes\":400"},
		{http.MethodGet, "/v1/cloud/trash", "", "\"old.txt\""},
		{http.MethodPost, "/v1/cloud/trash/restore", `{"id":4,"revision":3}`, "\"revision\":4"},
		{http.MethodPost, "/v1/cloud/trash/delete", `{"id":4,"revision":3}`, "\"ok\":true"},
		{http.MethodGet, "/v1/cloud/versions?node_id=3", "", "\"revision\":1"},
		{http.MethodPost, "/v1/cloud/versions/restore", `{"node_id":3,"current_revision":3,"version_id":5}`, "\"revision\":4"},
		{http.MethodGet, "/v1/cloud/shares?node_id=3", "", "\"status\":\"active\""},
		{http.MethodPost, "/v1/cloud/shares", `{"node_id":3,"password":"password123","max_downloads":2}`, "\"url\":\"https://drive.example/#/s/token\""},
		{http.MethodPost, "/v1/cloud/shares/revoke", `{"id":6}`, "\"ok\":true"},
	}
	for _, tc := range cases {
		res := desktopIPCRequest(t, handler, tc.method, tc.path, tc.body)
		if res.Code < 200 || res.Code >= 300 || !strings.Contains(res.Body.String(), tc.want) {
			t.Fatalf("%s %s status=%d body=%s", tc.method, tc.path, res.Code, res.Body.String())
		}
	}
	if ctrl.cloudDeleteID != 4 || ctrl.cloudDeleteRev != 3 || ctrl.cloudRevokeID != 6 {
		t.Fatalf("cloud mutations not forwarded: delete=%d/%d revoke=%d", ctrl.cloudDeleteID, ctrl.cloudDeleteRev, ctrl.cloudRevokeID)
	}
}

func ptrUint64(value uint64) *uint64 { return &value }

func TestDesktopIPCTransfers(t *testing.T) {
	manager := transfer.NewManager(10)
	task := manager.Start(transfer.Spec{
		FileName:   "demo.bin",
		Path:       "docs/demo.bin",
		Kind:       transfer.KindUpload,
		Direction:  "upload",
		TotalBytes: 100,
		Retry:      func(context.Context) error { return nil },
	})
	task.Progress(40, 100)
	task.Fail(errors.New("network down"))

	ctrl := &fakeDesktopIPCController{revision: 1, transfers: manager}
	handler := newDesktopIPCHandler(ctrl, "secret", func() {})

	res := desktopIPCRequest(t, handler, http.MethodGet, "/v1/transfers", "")
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "\"file_name\":\"demo.bin\"") {
		t.Fatalf("transfers status=%d body=%s", res.Code, res.Body.String())
	}
	var snapshot desktopIPCTransfers
	if err := json.NewDecoder(res.Body).Decode(&snapshot); err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Transfers) != 1 || snapshot.Transfers[0].State != transfer.StateFailed {
		t.Fatalf("unexpected transfer snapshot: %+v", snapshot)
	}

	res = desktopIPCRequest(t, handler, http.MethodGet, "/v1/transfer-events?after_revision=1&timeout_ms=10", "")
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "\"type\":\"transfers.changed\"") {
		t.Fatalf("transfer event status=%d body=%s", res.Code, res.Body.String())
	}

	res = desktopIPCRequest(t, handler, http.MethodPost, "/v1/transfers/retry", `{"id":"`+task.ID()+`"}`)
	if res.Code != http.StatusOK {
		t.Fatalf("retry status=%d body=%s", res.Code, res.Body.String())
	}
	_, items := manager.Snapshot()
	if len(items) != 1 || items[0].State != transfer.StateCompleted || items[0].RetryCount != 1 {
		t.Fatalf("unexpected retried transfer: %+v", items)
	}
}

func TestDesktopIPCDiagnostics(t *testing.T) {
	ctrl := &fakeDesktopIPCController{
		revision: 1,
		diagnosticReport: diagnostics.NewReport([]diagnostics.Check{
			{Name: "server health", Status: diagnostics.Pass, Detail: "HTTP 200"},
		}),
	}
	handler := newDesktopIPCHandler(ctrl, "secret", func() {})

	res := desktopIPCRequest(t, handler, http.MethodGet, "/v1/diagnostics", "")
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "\"server health\"") {
		t.Fatalf("diagnostics status=%d body=%s", res.Code, res.Body.String())
	}

	res = desktopIPCRequest(t, handler, http.MethodGet, "/v1/diagnostics/report", "")
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "xDrive diagnostic report") {
		t.Fatalf("diagnostic report status=%d body=%s", res.Code, res.Body.String())
	}

	for _, path := range []string{
		"/v1/diagnostics/reconnect",
		"/v1/diagnostics/repair-sync-root",
		"/v1/diagnostics/open-logs",
	} {
		res = desktopIPCRequest(t, handler, http.MethodPost, path, "")
		if res.Code != http.StatusOK {
			t.Fatalf("%s status=%d body=%s", path, res.Code, res.Body.String())
		}
	}
	if ctrl.reconnectN != 1 || ctrl.repairN != 1 || ctrl.openLogsN != 1 {
		t.Fatalf("diagnostic actions not forwarded: reconnect=%d repair=%d logs=%d", ctrl.reconnectN, ctrl.repairN, ctrl.openLogsN)
	}
}

func TestDesktopIPCRejectsUnknownJSONFields(t *testing.T) {
	ctrl := &fakeDesktopIPCController{revision: 1}
	handler := newDesktopIPCHandler(ctrl, "secret", func() {})
	res := desktopIPCRequest(t, handler, http.MethodPost, "/v1/auth/login", `{"server":"x","username":"u","password":"p","unexpected":true}`)
	if res.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
}

func TestAgentSnapshotRevisionAndWait(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ctrl := newAgentController(ctx, cancel)
	_, revision := ctrl.SnapshotWithRevision()

	ctrl.setSnapshot(func(s *agentSnapshot) {})
	_, same := ctrl.SnapshotWithRevision()
	if same != revision {
		t.Fatalf("no-op snapshot changed revision: %d -> %d", revision, same)
	}

	result := make(chan uint64, 1)
	go func() {
		waitCtx, waitCancel := context.WithTimeout(context.Background(), time.Second)
		defer waitCancel()
		_, next, changed := ctrl.WaitSnapshot(waitCtx, revision)
		if changed {
			result <- next
			return
		}
		result <- 0
	}()
	ctrl.setSnapshot(func(s *agentSnapshot) { s.SyncStatus = "changed" })
	if next := <-result; next <= revision {
		t.Fatalf("wait did not observe revision change: old=%d next=%d", revision, next)
	}
}

func TestDesktopIPCDiscoveryFileOwnership(t *testing.T) {
	dir := t.TempDir()
	path, err := writeDesktopIPCDiscovery(dir, desktopIPCDiscovery{
		Version: 1,
		BaseURL: "http://127.0.0.1:12345",
		Token:   "owner-token",
		PID:     42,
	})
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var discovery desktopIPCDiscovery
	if err := json.NewDecoder(bytes.NewReader(data)).Decode(&discovery); err != nil {
		t.Fatal(err)
	}
	if discovery.Token != "owner-token" || discovery.Version != 1 {
		t.Fatalf("unexpected discovery: %+v", discovery)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("discovery permissions=%o", info.Mode().Perm())
		}
	}

	removeDesktopIPCDiscoveryIfOwned(path, "other-token")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("foreign owner removed discovery: %v", err)
	}
	removeDesktopIPCDiscoveryIfOwned(path, "owner-token")
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("owned discovery still exists: %v", err)
	}
}
