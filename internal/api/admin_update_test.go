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
		RunnerHeartbeatAt: time.Now().UTC().Add(-2 * time.Minute).Format(time.RFC3339),
	})
	state = server.serverUpdateStatus()
	if state.Supported || state.State != "unavailable" {
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
