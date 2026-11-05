package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
)

func newOfflineHostPlanTestServer(t *testing.T) (*Server, string) {
	t.Helper()
	hostDir := t.TempDir()
	importDir := t.TempDir()
	id := strings.Repeat("a", 32)
	candidate := filepath.Join(importDir, id)
	if err := os.Mkdir(candidate, 0o770); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(candidate, "manifest.json"), []byte("{}\n"), 0o660); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(candidate, "xdrive-offline-linux-amd64"), []byte("host installer"), 0o660); err != nil {
		t.Fatal(err)
	}
	s := &Server{HostControlDir: hostDir, OfflineUpdateImportDir: importDir}
	writeServerUpdateTestStatus(t, hostDir, serverUpdateState{
		State: "idle", Source: "github", Channel: "master",
		RunnerHeartbeatAt: time.Now().UTC().Format(time.RFC3339),
	})
	return s, id
}

func offlinePlanRequestContext(body string) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/update/offline/plan", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(res)
	ctx.Request = req
	ctx.Set("user", meta.User{Username: "admin", Role: meta.UserRoleAdmin})
	return ctx, res
}

func TestAdminStartOfflineHostPlanQueuesFixedReadOnlyRequest(t *testing.T) {
	s, id := newOfflineHostPlanTestServer(t)
	body, err := json.Marshal(map[string]any{
		"offline_id": id, "offline_trust_mode": "sigstore",
		"trusted_manifest_sha256": "", "trusted_installer_sha256": "",
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, res := offlinePlanRequestContext(string(body))
	s.adminStartOfflineHostPlan(ctx)
	if res.Code != http.StatusAccepted {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
	var queued offlineHostPlanStatus
	if err := json.Unmarshal(res.Body.Bytes(), &queued); err != nil {
		t.Fatal(err)
	}
	if queued.State != "queued" || queued.OfflineID != id || queued.TrustMode != "sigstore" || queued.RequestID == "" {
		t.Fatalf("queued=%+v", queued)
	}
	raw, err := os.ReadFile(filepath.Join(s.HostControlDir, "plan-request.json"))
	if err != nil {
		t.Fatal(err)
	}
	var request offlineHostPlanRequestFile
	if err := json.Unmarshal(raw, &request); err != nil {
		t.Fatal(err)
	}
	if request.OfflineID != id || request.TrustMode != "sigstore" ||
		request.TrustedManifestSHA256 != "" || request.TrustedInstallerSHA256 != "" ||
		request.RequestedBy != "admin" {
		t.Fatalf("request=%+v", request)
	}
	if strings.Contains(string(raw), s.OfflineUpdateImportDir) || strings.Contains(string(raw), s.HostControlDir) {
		t.Fatal("Host request leaked a filesystem path")
	}
	if !s.offlineHostPlanBusy() {
		t.Fatal("queued Host preflight was not fenced")
	}
}

func TestAdminStartOfflineHostPlanRejectsInvalidTrustAndIncompleteImport(t *testing.T) {
	s, id := newOfflineHostPlanTestServer(t)
	for _, input := range []map[string]any{
		{"offline_id": id, "offline_trust_mode": "unsafe"},
		{"offline_id": id, "offline_trust_mode": "sigstore", "trusted_manifest_sha256": strings.Repeat("a", 64)},
		{"offline_id": id, "offline_trust_mode": "sha256", "trusted_manifest_sha256": strings.Repeat("a", 64)},
		{"offline_id": "../../etc", "offline_trust_mode": "sigstore"},
	} {
		body, _ := json.Marshal(input)
		ctx, res := offlinePlanRequestContext(string(body))
		s.adminStartOfflineHostPlan(ctx)
		if res.Code != http.StatusBadRequest {
			t.Fatalf("input=%v status=%d body=%s", input, res.Code, res.Body.String())
		}
	}
	if _, err := os.Stat(filepath.Join(s.HostControlDir, "plan-request.json")); !os.IsNotExist(err) {
		t.Fatalf("invalid trust unexpectedly queued request: %v", err)
	}

	incompleteID := strings.Repeat("b", 32)
	if err := os.Mkdir(filepath.Join(s.OfflineUpdateImportDir, incompleteID), 0o770); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]any{"offline_id": incompleteID, "offline_trust_mode": "sigstore"})
	ctx, res := offlinePlanRequestContext(string(body))
	s.adminStartOfflineHostPlan(ctx)
	if res.Code != http.StatusConflict || !strings.Contains(res.Body.String(), "offline_import_not_ready") {
		t.Fatalf("incomplete import status=%d body=%s", res.Code, res.Body.String())
	}
}

func TestAdminOfflineHostPlanStatusReturnsOnlyReadOnlyResultForMatchingImport(t *testing.T) {
	s, id := newOfflineHostPlanTestServer(t)
	status := offlineHostPlanStatus{
		State: "success", RequestID: strings.Repeat("c", 24),
		OfflineID: id, TrustMode: "sigstore", Message: "preflight completed",
	}
	if err := s.writeOfflineHostPlanStatus(status); err != nil {
		t.Fatal(err)
	}
	plan := []byte(`{"schema":1,"read_only":true,"host_probe":{"read_only":true,"blockers":[]}}`)
	if err := os.WriteFile(filepath.Join(s.HostControlDir, "plan-result.json"), plan, 0o660); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/update/offline/plan/"+id, nil)
	res := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(res)
	ctx.Request = req
	ctx.Params = gin.Params{{Key: "id", Value: id}}
	s.adminOfflineHostPlanStatus(ctx)
	if res.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
	}
	var got offlineHostPlanStatus
	if err := json.Unmarshal(res.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.State != "success" || got.OfflineID != id || len(got.Plan) == 0 {
		t.Fatalf("status=%+v", got)
	}
}

func TestAdminOfflineHostPlanStatusRejectsNonReadOnlyResult(t *testing.T) {
	s, id := newOfflineHostPlanTestServer(t)
	if err := s.writeOfflineHostPlanStatus(offlineHostPlanStatus{
		State: "success", OfflineID: id, RequestID: strings.Repeat("d", 24), TrustMode: "sigstore",
	}); err != nil {
		t.Fatal(err)
	}
	plan := []byte(`{"schema":1,"read_only":false,"host_probe":{"read_only":true}}`)
	if err := os.WriteFile(filepath.Join(s.HostControlDir, "plan-result.json"), plan, 0o660); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/update/offline/plan/"+id, nil)
	res := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(res)
	ctx.Request = req
	ctx.Params = gin.Params{{Key: "id", Value: id}}
	s.adminOfflineHostPlanStatus(ctx)
	var got offlineHostPlanStatus
	if err := json.Unmarshal(res.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.State != "failed" || got.Plan != nil || got.Error == "" {
		t.Fatalf("non-read-only result escaped: %+v", got)
	}
}

func TestAdminServerUpdateAndOfflineImportAreFencedDuringHostPlan(t *testing.T) {
	s, id := newOfflineHostPlanTestServer(t)
	if err := s.writeOfflineHostPlanStatus(offlineHostPlanStatus{
		State: "running", RequestID: strings.Repeat("e", 24),
		OfflineID: id, TrustMode: "sigstore",
	}); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/update", strings.NewReader(`{"source":"github","channel":"stable"}`))
	req.Header.Set("Content-Type", "application/json")
	res := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(res)
	ctx.Request = req
	ctx.Set("user", meta.User{Username: "admin", Role: meta.UserRoleAdmin})
	s.adminStartServerUpdate(ctx)
	if res.Code != http.StatusConflict || !strings.Contains(res.Body.String(), "offline_host_preflight_in_progress") {
		t.Fatalf("update status=%d body=%s", res.Code, res.Body.String())
	}
	if !offlineImportBusy(s) {
		t.Fatal("offline import mutations were not fenced during Host preflight")
	}
}

func TestAdminStartOfflineHostPlanRejectsWhileServerUpdateIsQueued(t *testing.T) {
	s, id := newOfflineHostPlanTestServer(t)
	writeServerUpdateTestStatus(t, s.HostControlDir, serverUpdateState{
		State: "queued", Source: "github", Channel: "stable",
		RunnerHeartbeatAt: time.Now().UTC().Format(time.RFC3339),
	})
	body, _ := json.Marshal(map[string]any{"offline_id": id, "offline_trust_mode": "sigstore"})
	ctx, res := offlinePlanRequestContext(string(body))
	s.adminStartOfflineHostPlan(ctx)
	if res.Code != http.StatusConflict || !strings.Contains(res.Body.String(), "update_or_preflight_in_progress") {
		t.Fatalf("plan status=%d body=%s", res.Code, res.Body.String())
	}
}
