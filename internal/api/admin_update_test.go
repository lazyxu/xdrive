package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
)

func writeServerUpdateTestStatus(t *testing.T, dir string, state serverUpdateState) {
	t.Helper()
	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "status.json"), append(raw, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
	heartbeatPath := filepath.Join(dir, "heartbeat")
	if err := os.WriteFile(heartbeatPath, []byte("ok\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if state.RunnerHeartbeatAt != "" {
		parsed, err := time.Parse(time.RFC3339, state.RunnerHeartbeatAt)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(heartbeatPath, parsed, parsed); err != nil {
			t.Fatal(err)
		}
	}
}

func TestServerUpdateStatusRequiresFreshHostRunner(t *testing.T) {
	dir := t.TempDir()
	server := &Server{HostControlDir: dir}

	state := server.serverUpdateStatus()
	if state.Supported || state.State != "unavailable" {
		t.Fatalf("missing runner state=%+v", state)
	}

	writeServerUpdateTestStatus(t, dir, serverUpdateState{
		State:             "idle",
		Source:            "gitlab",
		Channel:           "master",
		BackupFileData:    true,
		RunnerHeartbeatAt: time.Now().UTC().Add(-2 * time.Minute).Format(time.RFC3339),
	})
	state = server.serverUpdateStatus()
	if state.Supported || state.State != "unavailable" || !state.BackupFileData {
		t.Fatalf("stale runner state=%+v", state)
	}

	writeServerUpdateTestStatus(t, dir, serverUpdateState{
		State:             "idle",
		Source:            "gitlab",
		Channel:           "master",
		RunnerHeartbeatAt: time.Now().UTC().Format(time.RFC3339),
	})
	state = server.serverUpdateStatus()
	if !state.Supported || state.State != "idle" || state.Source != "gitlab" || state.Channel != "master" {
		t.Fatalf("fresh runner state=%+v", state)
	}
}

func TestAdminStartServerUpdateQueuesRestrictedRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	server := &Server{HostControlDir: dir}
	writeServerUpdateTestStatus(t, dir, serverUpdateState{
		State:             "idle",
		Source:            "github",
		Channel:           "stable",
		RunnerHeartbeatAt: time.Now().UTC().Format(time.RFC3339),
	})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/update", strings.NewReader(`{"source":"gitlab","channel":"master","backup_file_data":true}`))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(res)
	ctx.Request = req
	ctx.Set("user", meta.User{Username: "admin", Role: meta.UserRoleAdmin})

	server.adminStartServerUpdate(ctx)
	if res.Code != http.StatusAccepted {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}

	var queued serverUpdateState
	if err := json.Unmarshal(res.Body.Bytes(), &queued); err != nil {
		t.Fatal(err)
	}
	if queued.State != "queued" || queued.Source != "gitlab" || queued.Channel != "master" || queued.RequestID == "" {
		t.Fatalf("queued=%+v", queued)
	}

	requestPath := filepath.Join(dir, "request.json")
	info, err := os.Stat(requestPath)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" {
		if got := info.Mode().Perm(); got != 0o660 {
			t.Fatalf("request mode=%#o want 0660", got)
		}
	}
	raw, err := os.ReadFile(requestPath)
	if err != nil {
		t.Fatal(err)
	}
	var request serverUpdateRequestFile
	if err := json.Unmarshal(raw, &request); err != nil {
		t.Fatal(err)
	}
	if request.Source != "gitlab" || request.Channel != "master" || !request.BackupFileData || request.RequestedBy != "admin" {
		t.Fatalf("request=%+v", request)
	}

	state := server.serverUpdateStatus()
	if state.State != "queued" || state.RequestID != request.RequestID {
		t.Fatalf("status after queue=%+v", state)
	}

	second := httptest.NewRequest(http.MethodPost, "/api/v1/admin/update", strings.NewReader(`{"source":"github","channel":"stable"}`))
	second.Header.Set("Content-Type", "application/json")
	secondRes := httptest.NewRecorder()
	secondCtx, _ := gin.CreateTestContext(secondRes)
	secondCtx.Request = second
	server.adminStartServerUpdate(secondCtx)
	if secondRes.Code != http.StatusConflict {
		t.Fatalf("second status=%d body=%s", secondRes.Code, secondRes.Body.String())
	}
}

func TestAdminStartServerUpdateRejectsArbitraryOptions(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server := &Server{HostControlDir: t.TempDir()}
	for _, body := range []string{
		`{"source":"shell","channel":"stable"}`,
		`{"source":"github","channel":"nightly"}`,
		`{"source":"xdrive","channel":"stable"}`,
		`{"source":"offline","channel":"master"}`,
		`{"source":"offline","channel":"stable","offline_id":"00000000000000000000000000000000","trusted_manifest_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","trusted_installer_sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}`,
		`{"source":"offline","channel":"master","offline_id":"../../admin","trusted_manifest_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","trusted_installer_sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}`,
		`{"source":"offline","channel":"master","offline_id":"00000000000000000000000000000000","trusted_manifest_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`,
		`{"source":"offline","channel":"master","offline_id":"00000000000000000000000000000000","trusted_manifest_sha256":"bad","trusted_installer_sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}`,
		`{"source":"github","channel":"master","offline_id":"00000000000000000000000000000000"}`,
	} {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/update", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(res)
		ctx.Request = req
		server.adminStartServerUpdate(ctx)
		if res.Code != http.StatusBadRequest {
			t.Fatalf("body=%s status=%d response=%s", body, res.Code, res.Body.String())
		}
	}
}

func TestAdminStartServerShareUpdatePreservesMasterSource(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	server := &Server{HostControlDir: dir}
	writeServerUpdateTestStatus(t, dir, serverUpdateState{
		State: "idle", Source: "xdrive", Channel: "master",
		RunnerHeartbeatAt: time.Now().UTC().Format(time.RFC3339),
	})
	if state := server.serverUpdateStatus(); state.Source != "xdrive" || !state.Supported {
		t.Fatalf("Share source lost in idle status: %+v", state)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/update", strings.NewReader(`{"source":"xdrive","channel":"master","backup_file_data":true}`))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(res)
	ctx.Request = req
	ctx.Set("user", meta.User{Username: "admin", Role: meta.UserRoleAdmin})
	server.adminStartServerUpdate(ctx)
	if res.Code != http.StatusAccepted {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
	state := server.serverUpdateStatus()
	if state.State != "queued" || state.Source != "xdrive" || state.Channel != "master" || !state.BackupFileData {
		t.Fatalf("Share request lost in queued status: %+v", state)
	}
}

func TestAdminOfflineGoUpdateQueuesOnlyExactTrustedImport(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	s := &Server{HostControlDir: dir}
	writeServerUpdateTestStatus(t, dir, serverUpdateState{
		State: "idle", Source: "github", Channel: "master",
		RunnerHeartbeatAt: time.Now().UTC().Format(time.RFC3339),
	})
	id, manifest, goBinary := strings.Repeat("a", 32),
		strings.Repeat("b", 64), strings.Repeat("c", 64)
	body, err := json.Marshal(map[string]any{
		"source": "offline", "channel": "master", "offline_id": id,
		"trusted_manifest_sha256":  manifest,
		"trusted_installer_sha256": goBinary, "backup_file_data": true,
	})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/update", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(res)
	ctx.Request = req
	ctx.Set("user", meta.User{Username: "admin", Role: meta.UserRoleAdmin})
	s.adminStartServerUpdate(ctx)
	if res.Code != http.StatusAccepted {
		t.Fatalf("status %d: %s", res.Code, res.Body.String())
	}
	queuedRaw, err := os.ReadFile(filepath.Join(dir, "request.json"))
	if err != nil {
		t.Fatal(err)
	}
	var queued serverUpdateRequestFile
	if err := json.Unmarshal(queuedRaw, &queued); err != nil {
		t.Fatal(err)
	}
	if queued.Source != "offline" || queued.Channel != "master" || queued.OfflineID != id ||
		queued.TrustedManifestSHA256 != manifest || queued.TrustedInstallerSHA256 != goBinary ||
		!queued.BackupFileData || queued.RequestedBy != "admin" {
		t.Fatalf("unsupported imported Host request: %+v", queued)
	}
	if got := s.serverUpdateStatus(); got.Source != "offline" || got.State != "queued" {
		t.Fatalf("offline status lost: %+v", got)
	}
}
