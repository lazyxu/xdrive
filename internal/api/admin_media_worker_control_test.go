package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/mediaworker"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func writeMediaWorkerHostStatusFixture(t *testing.T, dir string, status mediaWorkerHostStatus) {
	t.Helper()
	raw, err := json.Marshal(status)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, mediaWorkerControlStatusName), raw, 0660); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "heartbeat"), []byte("ok"), 0660); err != nil {
		t.Fatal(err)
	}
}

func TestMediaWorkerHostStatusRequiresFreshSanitizedRunner(t *testing.T) {
	dir := t.TempDir()
	s := &Server{HostControlDir: dir}
	if status := s.readMediaWorkerHostStatus(); status.Supported || status.State != "unavailable" {
		t.Fatalf("absent runner claimed supported: %+v", status)
	}
	writeMediaWorkerHostStatusFixture(t, dir, mediaWorkerHostStatus{
		State: "success", Revision: 1, AppliedRevision: 1, Enabled: true, ObservedEnabled: true,
	})
	stale := time.Now().UTC().Add(-2 * time.Minute)
	if err := os.Chtimes(filepath.Join(dir, "heartbeat"), stale, stale); err != nil {
		t.Fatal(err)
	}
	if status := s.readMediaWorkerHostStatus(); status.Supported {
		t.Fatalf("stale runner appeared online: %+v", status)
	}
	writeMediaWorkerHostStatusFixture(t, dir, mediaWorkerHostStatus{
		State: "success", Revision: 1, AppliedRevision: 2, Enabled: true, ObservedEnabled: true,
	})
	if status := s.readMediaWorkerHostStatus(); status.Supported {
		t.Fatalf("impossible applied revision accepted: %+v", status)
	}
	writeMediaWorkerHostStatusFixture(t, dir, mediaWorkerHostStatus{State: "idle"})
	st := s.readMediaWorkerHostStatus()
	if !st.Supported || st.State != "idle" {
		t.Fatalf("live host status unavailable: %+v", st)
	}
}

func TestMediaWorkerHostRequestAtomicNoClobber(t *testing.T) {
	dir := t.TempDir()
	req := mediaWorkerHostRequest{
		RequestID: "0123456789abcdef01234567",
		Revision:  2, Enabled: true, CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	if err := writeMediaWorkerHostRequest(dir, req); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(dir, mediaWorkerControlRequestName))
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0660 {
		t.Fatalf("host request file must be group readable: %#o", info.Mode().Perm())
	}
	if err := writeMediaWorkerHostRequest(dir, req); !os.IsExist(err) {
		t.Fatalf("overwrote an outstanding host request: %v", err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, mediaWorkerControlRequestName))
	if err != nil {
		t.Fatal(err)
	}
	var got mediaWorkerHostRequest
	if json.Unmarshal(raw, &got) != nil || got != req {
		t.Fatalf("host request corrupted: %+v", got)
	}
	if err := writeMediaWorkerHostRequest(dir, mediaWorkerHostRequest{
		RequestID: "contains-a-host-path", Revision: 3,
	}); err == nil {
		t.Fatal("untrusted host control request ID accepted")
	}
}

func TestAdminMediaWorkerSaveApplyRollbackAndAudit(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	gin.SetMode(gin.TestMode)
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "media_worker_ctl_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	params := parsed.Query()
	params.Set("search_path", schema)
	parsed.RawQuery = params.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.User{}, &meta.AuditEvent{},
		&meta.AdminMediaWorkerSetting{}, &meta.AdminMediaWorkerRevision{}); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	s := &Server{DB: db, Auth: auth.New("media-worker-control-ci-auth-secret", time.Hour), HostControlDir: dir}
	admin := meta.User{Username: "media-admin", PasswordHash: "fixture", Role: meta.UserRoleAdmin, SessionVersion: 1}
	member := meta.User{Username: "media-member", PasswordHash: "fixture", Role: meta.UserRoleUser, SessionVersion: 1}
	if db.Create(&admin).Error != nil || db.Create(&member).Error != nil {
		t.Fatal("create roles")
	}
	adminToken, err := s.Auth.Issue(admin.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	memberToken, err := s.Auth.Issue(member.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	router := s.Router()
	request := func(method, path, token, body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	const endpoint = "/api/v1/admin/services/media-worker"
	if response := request(http.MethodGet, endpoint, adminToken, ""); response.Code != 200 {
		t.Fatalf("initial admin GET %d", response.Code)
	}
	if response := request(http.MethodGet, endpoint, "", ""); response.Code != 401 {
		t.Fatalf("anonymous GET %d", response.Code)
	}
	if response := request(http.MethodGet, endpoint, memberToken, ""); response.Code != 403 {
		t.Fatalf("non-admin GET %d", response.Code)
	}
	body := `{"revision":0,"enabled":true}`
	if response := request(http.MethodPut, endpoint, "", body); response.Code != 401 {
		t.Fatalf("anonymous PUT %d", response.Code)
	}
	if response := request(http.MethodPut, endpoint, memberToken, body); response.Code != 403 {
		t.Fatalf("member PUT %d", response.Code)
	}
	if response := request(http.MethodPut, endpoint, adminToken, `{"revision":0}`); response.Code != 400 {
		t.Fatalf("incomplete edit %d", response.Code)
	}
	if response := request(http.MethodPut, endpoint, adminToken, body); response.Code != 200 {
		t.Fatalf("save desired %d %s", response.Code, response.Body.String())
	}
	if response := request(http.MethodPut, endpoint, adminToken, body); response.Code != 409 {
		t.Fatalf("stale edit %d", response.Code)
	}
	var saved meta.AdminMediaWorkerSetting
	if err := db.Where("name = ?", mediaWorkerSettingName).Take(&saved).Error; err != nil || saved.Revision != 1 || !saved.Enabled {
		t.Fatalf("desired not persisted correctly: %+v %v", saved, err)
	}
	// A saved policy cannot be called applied without a Host Manager.
	var cfg adminMediaWorkerConfigDTO
	got := request(http.MethodGet, endpoint, adminToken, "")
	if json.Unmarshal(got.Body.Bytes(), &cfg) != nil || cfg.ApplyState != "unavailable" || cfg.RuntimeReady {
		t.Fatalf("saved-only configuration incorrectly applied: %+v", cfg)
	}
	writeMediaWorkerHostStatusFixture(t, dir, mediaWorkerHostStatus{State: "idle"})
	// Audit table unavailable: no host request is allowed to escape.
	if err := db.Migrator().DropTable(&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	if response := request(http.MethodPost, endpoint+"/apply", adminToken, `{"revision":1}`); response.Code != 503 {
		t.Fatalf("unaudited apply accepted: %d", response.Code)
	}
	if _, err := os.Stat(filepath.Join(dir, mediaWorkerControlRequestName)); !os.IsNotExist(err) {
		t.Fatal("host request escaped while auditing failed")
	}
	if err := db.Migrator().CreateTable(&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	if response := request(http.MethodPost, endpoint+"/apply", memberToken, `{"revision":1}`); response.Code != 403 {
		t.Fatalf("member apply %d", response.Code)
	}
	if response := request(http.MethodPost, endpoint+"/apply", adminToken, `{"revision":9}`); response.Code != 409 {
		t.Fatalf("stale apply %d", response.Code)
	}
	enqueued := request(http.MethodPost, endpoint+"/apply", adminToken, `{"revision":1}`)
	if enqueued.Code != 202 {
		t.Fatalf("host apply not queued: %d %s", enqueued.Code, enqueued.Body.String())
	}
	if response := request(http.MethodPost, endpoint+"/apply", adminToken, `{"revision":1}`); response.Code != 409 {
		t.Fatalf("duplicate host apply accepted: %d", response.Code)
	}
	raw, err := os.ReadFile(filepath.Join(dir, mediaWorkerControlRequestName))
	if err != nil {
		t.Fatal(err)
	}
	var command mediaWorkerHostRequest
	if json.Unmarshal(raw, &command) != nil || command.Revision != 1 || !command.Enabled ||
		!mediaWorkerRequestIDPattern.MatchString(command.RequestID) {
		t.Fatalf("unsafe host command: %+v", command)
	}
	// Pretend the operator runner has completed ONLY the target service
	// change. Still require independently proven FFmpeg/FFprobe health.
	if err := os.Remove(filepath.Join(dir, mediaWorkerControlRequestName)); err != nil {
		t.Fatal(err)
	}
	writeMediaWorkerHostStatusFixture(t, dir, mediaWorkerHostStatus{
		State: "success", Revision: 1, AppliedRevision: 1, Enabled: true, ObservedEnabled: true, RequestID: command.RequestID,
	})
	got = request(http.MethodGet, endpoint, adminToken, "")
	if json.Unmarshal(got.Body.Bytes(), &cfg) != nil || cfg.ApplyState == "applied" {
		t.Fatal("unprobed media worker falsely marked applied")
	}
	s.MediaWorkerProbe = mediaworker.ProbeFunc(func(context.Context) (mediaworker.Info, error) {
		return mediaworker.Info{
			ProtocolVersion: 1, Ready: true, FFmpegVersion: "ffmpeg version fixture",
			FFprobeVersion: "ffprobe version fixture", TaskExecutionSupported: false,
		}, nil
	})
	got = request(http.MethodGet, endpoint, adminToken, "")
	if json.Unmarshal(got.Body.Bytes(), &cfg) != nil || cfg.ApplyState != "applied" || !cfg.RuntimeReady {
		t.Fatalf("applied worker not really verified: %s", got.Body.String())
	}
	// Disable must be its own revision and own host acknowledgement.
	disabled := request(http.MethodPut, endpoint, adminToken, `{"revision":1,"enabled":false}`)
	if disabled.Code != 200 {
		t.Fatalf("disable desired %d %s", disabled.Code, disabled.Body.String())
	}
	if response := request(http.MethodPost, endpoint+"/apply", adminToken, `{"revision":2}`); response.Code != 202 {
		t.Fatalf("disable not queued: %d %s", response.Code, response.Body.String())
	}
	_ = os.Remove(filepath.Join(dir, mediaWorkerControlRequestName))
	writeMediaWorkerHostStatusFixture(t, dir, mediaWorkerHostStatus{
		State: "success", Revision: 2, AppliedRevision: 2, Enabled: false, ObservedEnabled: false,
	})
	got = request(http.MethodGet, endpoint, adminToken, "")
	if json.Unmarshal(got.Body.Bytes(), &cfg) != nil || cfg.ApplyState != "applied" || cfg.DesiredEnabled {
		t.Fatalf("disabled worker not verified: %s", got.Body.String())
	}
	history := request(http.MethodGet, endpoint+"/revisions", adminToken, "")
	var page struct {
		Items []mediaWorkerRevisionDTO `json:"items"`
	}
	if history.Code != 200 || json.Unmarshal(history.Body.Bytes(), &page) != nil ||
		len(page.Items) != 3 || page.Items[0].Revision != 2 || page.Items[2].Revision != 0 {
		t.Fatalf("media worker history incomplete: %d %+v", history.Code, page)
	}
	rollback := request(http.MethodPost, endpoint+"/rollback", adminToken, `{"revision":2,"target_revision":1}`)
	if rollback.Code != 200 {
		t.Fatalf("rollback desired %d %s", rollback.Code, rollback.Body.String())
	}
	got = request(http.MethodGet, endpoint, adminToken, "")
	if json.Unmarshal(got.Body.Bytes(), &cfg) != nil || cfg.Revision != 3 || !cfg.DesiredEnabled ||
		cfg.ApplyState == "applied" {
		t.Fatalf("rollback falsely or incompletely acknowledged: %+v", cfg)
	}
	if response := request(http.MethodPost, endpoint+"/rollback", memberToken, `{"revision":3,"target_revision":1}`); response.Code != 403 {
		t.Fatalf("non-admin rollback accepted: %d", response.Code)
	}
	var audits int64
	if err := db.Model(&meta.AuditEvent{}).Count(&audits).Error; err != nil || audits < 4 {
		t.Fatalf("missing audit evidence count=%d err=%v", audits, err)
	}
}

func TestMediaWorkerPendingHostRequestFencesNewConfigDuringHeartbeatOutage(t *testing.T) {
	dir := t.TempDir()
	s := &Server{HostControlDir: dir}
	if s.mediaWorkerHostBusy() {
		t.Fatal("empty host directory falsely busy")
	}
	if err := os.WriteFile(filepath.Join(dir, mediaWorkerControlRequestName), []byte("queued"), 0600); err != nil {
		t.Fatal(err)
	}
	if !s.mediaWorkerHostBusy() {
		t.Fatal("queued host work lost its fence because heartbeat is missing")
	}
	if err := os.Remove(filepath.Join(dir, mediaWorkerControlRequestName)); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "media-worker-control-active.json"), []byte("running"), 0600); err != nil {
		t.Fatal(err)
	}
	if !s.mediaWorkerHostBusy() {
		t.Fatal("in-flight host work lost its fence")
	}
}
