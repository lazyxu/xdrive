package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/conflictstate"
	"github.com/lazyxu/xdrive/internal/mount"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

type fakeDesktopIPCController struct {
	snapshot agentSnapshot
	revision uint64
	settings userconfig.Config
	root     string
	items    []conflictstate.Record

	loginServer   string
	loginUsername string
	loginPassword string
	loginMount    string
	currentPass   string
	newPass       string
	logouts       int
	paused        *bool
	syncs         int
	updateMount   *string
	updateCache   *int64
	rulePath      string
	ruleMode      string
	filePath      string
	fileAction    string
	fileState     mount.FileAvailability
	openFolderN   int
	openID        string
	openBoth      bool
	resolveID     string
	resolveChoice string
	err           error
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
