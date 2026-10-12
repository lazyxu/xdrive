package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestPhotoHostApplyRequiresAuditAndExactCrossReplicaReceipt(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL not configured")
	}
	gin.SetMode(gin.TestMode)
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "photo_host_apply_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := u.Query()
	query.Set("search_path", schema)
	u.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.User{}, &meta.AuditEvent{},
		&meta.AdminPhotoHostSetting{}, &meta.AdminPhotoHostRevision{},
		&meta.AdminPhotoHostApply{}); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	s := &Server{DB: db, Auth: auth.New("photo-host-apply-test", time.Hour), HostControlDir: dir}
	other := &Server{DB: db, Auth: s.Auth, HostControlDir: dir}
	admin := meta.User{Username: "photo-host-apply-admin", Role: meta.UserRoleAdmin, SessionVersion: 1}
	member := meta.User{Username: "photo-host-apply-member", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&member).Error; err != nil {
		t.Fatal(err)
	}
	adminToken, err := s.Auth.Issue(admin.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	memberToken, err := s.Auth.Issue(member.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	router, otherRouter := s.Router(), other.Router()
	call := func(r *gin.Engine, method, path, token, body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		out := httptest.NewRecorder()
		r.ServeHTTP(out, req)
		return out
	}
	const endpoint = "/api/v1/admin/services/photo-intelligence/host"
	for _, tc := range []struct {
		token  string
		status int
	}{{"", 401}, {memberToken, 403}} {
		if out := call(router, http.MethodPost, endpoint+"/apply", tc.token, `{"revision":1}`); out.Code != tc.status {
			t.Fatalf("non-admin apply %d expected %d", out.Code, tc.status)
		}
	}
	for _, body := range []string{`{}`, `{"revision":0}`, `{"revision":-1}`, `{"revision":"1"}`, `{"revision":1152921504606846976}`, `{"revision":1,"enabled":false}`, `{"revision":1}{"revision":2}`} {
		if out := call(router, http.MethodPost, endpoint+"/apply", adminToken, body); out.Code != http.StatusBadRequest {
			t.Fatalf("bad host revision accepted: %s: %d", body, out.Code)
		}
	}
	if out := call(router, http.MethodPut, endpoint, adminToken, `{"revision":0,"enabled":true}`); out.Code != http.StatusOK {
		t.Fatalf("saving global desired state failed: %d %s", out.Code, out.Body.String())
	}
	// Operator-controlled, fixed-key local evidence. The Server must never
	// invent capability from saved state or let unaudited callers queue work.
	write := func(name string, value []byte) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), value, 0600); err != nil {
			t.Fatal(err)
		}
	}
	write("heartbeat", []byte("ok"))
	write(photoIntelligenceHostStatusName, []byte(`{"state":"stopped","profile_configured":false}`))
	idle := photoHostControlStatus{Supported: true, State: "idle", ObservedHostState: "stopped",
		UpdatedAt: time.Now().UTC().Format(time.RFC3339)}
	idleJSON, err := json.Marshal(idle)
	if err != nil {
		t.Fatal(err)
	}
	write(photoHostControlStatusName, idleJSON)
	probe := call(router, http.MethodGet, endpoint+"/preflight", adminToken, "")
	var preflight adminPhotoHostPreflightDTO
	if probe.Code != http.StatusOK || json.Unmarshal(probe.Body.Bytes(), &preflight) != nil ||
		!preflight.LocalChecksComplete || !preflight.ApplySupported ||
		preflight.Checks[5].State != "pass" || preflight.Checks[6].State != "unknown" {
		t.Fatalf("global enable dispatch preflight not truthful: %d %s", probe.Code, probe.Body.String())
	}
	// Failed metadata-only audit must prevent any command file or active gate.
	if err := db.Migrator().DropTable(&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	if out := call(router, http.MethodPost, endpoint+"/apply", adminToken, `{"revision":1}`); out.Code != http.StatusServiceUnavailable {
		t.Fatalf("unaudited host operation accepted: %d %s", out.Code, out.Body.String())
	}
	if _, err := os.Lstat(filepath.Join(dir, photoHostApplyRequestName)); !os.IsNotExist(err) {
		t.Fatal("unaudited host request escaped")
	}
	var count int64
	if err := db.Model(&meta.AdminPhotoHostApply{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("unaudited reservation persisted: %d %v", count, err)
	}
	if err := db.Migrator().CreateTable(&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	out := call(router, http.MethodPost, endpoint+"/apply", adminToken, `{"revision":1}`)
	if out.Code != http.StatusAccepted {
		t.Fatalf("audited host enable was not queued: %d %s", out.Code, out.Body.String())
	}
	var queued photoHostApplyResult
	if err := json.Unmarshal(out.Body.Bytes(), &queued); err != nil || queued.State != "queued" ||
		queued.Revision != 1 || !photoHostControlRequestID.MatchString(queued.RequestID) {
		t.Fatalf("unsafe queue result: %+v %v", queued, err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, photoHostApplyRequestName))
	if err != nil {
		t.Fatal(err)
	}
	var request photoHostApplyRequest
	if json.Unmarshal(raw, &request) != nil || !request.Enabled || request.Revision != 1 ||
		request.RequestID != queued.RequestID || request.CreatedAt == "" {
		t.Fatalf("untrusted host command: %+v", request)
	}
	if out := call(otherRouter, http.MethodPost, endpoint+"/apply", adminToken, `{"revision":1}`); out.Code != http.StatusConflict {
		t.Fatalf("cross-replica duplicate not fenced: %d", out.Code)
	}
	if out := call(otherRouter, http.MethodPut, endpoint, adminToken, `{"revision":1,"enabled":false}`); out.Code != http.StatusConflict {
		t.Fatalf("cross-replica desired edit bypassed pending gate: %d", out.Code)
	}
	if out := call(router, http.MethodPost, endpoint+"/rollback", adminToken, `{"revision":1,"target_revision":0}`); out.Code != http.StatusConflict {
		t.Fatalf("rollback bypassed pending host operation: %d", out.Code)
	}
	var gate meta.AdminPhotoHostApply
	if err := db.Where("name = ?", photoHostSettingName).Take(&gate).Error; err != nil ||
		gate.RequestID != queued.RequestID || gate.State != "queued" {
		t.Fatalf("global gate mismatch: %+v %v", gate, err)
	}
	if err := os.Remove(filepath.Join(dir, photoHostApplyRequestName)); err != nil {
		t.Fatal(err)
	}
	// Fake an otherwise valid real host success with a different request ID.
	// A revision match alone must neither close the gate nor claim applied.
	write(photoIntelligenceHostStatusName, []byte(`{"state":"healthy","profile_configured":true}`))
	success := photoHostControlStatus{
		Supported: true, State: "success", Revision: 1, AppliedRevision: 1,
		Enabled: true, ProfileVerified: true, ObservedHostState: "healthy",
		RequestID: "ffffffffffffffffffffffff", UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	encoded, err := json.Marshal(success)
	if err != nil {
		t.Fatal(err)
	}
	write(photoHostControlStatusName, encoded)
	stale := call(router, http.MethodGet, endpoint, adminToken, "")
	var cfg adminPhotoHostConfigDTO
	if stale.Code != http.StatusOK || json.Unmarshal(stale.Body.Bytes(), &cfg) != nil ||
		cfg.ApplyState != "queued" {
		t.Fatalf("forged receipt released global gate: %d %s", stale.Code, stale.Body.String())
	}
	if out := call(router, http.MethodPut, endpoint, adminToken, `{"revision":1,"enabled":false}`); out.Code != http.StatusConflict {
		t.Fatalf("mismatched token allowed new desired revision: %d", out.Code)
	}
	success.RequestID = queued.RequestID
	encoded, err = json.Marshal(success)
	if err != nil {
		t.Fatal(err)
	}
	write(photoHostControlStatusName, encoded)
	verified := call(otherRouter, http.MethodGet, endpoint, adminToken, "")
	if verified.Code != http.StatusOK || json.Unmarshal(verified.Body.Bytes(), &cfg) != nil ||
		cfg.ApplyState != "host-verified" || cfg.ApplyRevision != 1 ||
		cfg.ApplyRequestID != queued.RequestID {
		t.Fatalf("exact verified host receipt not recognized: %d %s", verified.Code, verified.Body.String())
	}
	// Host-only receipt may allow a new desire; model Info remains separately
	// unverified and the previous receipt cannot prove any new revision.
	if out := call(router, http.MethodPut, endpoint, adminToken, `{"revision":1,"enabled":false}`); out.Code != http.StatusOK {
		t.Fatalf("new desired revision remained fenced after trusted host receipt: %d %s", out.Code, out.Body.String())
	}
	if out := call(router, http.MethodPost, endpoint+"/apply", adminToken, `{"revision":2}`); out.Code != http.StatusConflict {
		t.Fatalf("disable must never reach the enable-only host runner: %d", out.Code)
	}
}

func TestPhotoHostApplyRequestAtomicNoClobber(t *testing.T) {
	dir := t.TempDir()
	now := time.Now().UTC().Format(time.RFC3339)
	req := photoHostApplyRequest{
		RequestID: "0123456789abcdef01234567", Revision: 3, Enabled: true, CreatedAt: now,
	}
	if err := writePhotoHostApplyRequest(dir, req); err != nil {
		t.Fatal(err)
	}
	if err := writePhotoHostApplyRequest(dir, req); !os.IsExist(err) {
		t.Fatalf("fixed request file was overwritten: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(dir, photoHostApplyRequestName))
	if err != nil {
		t.Fatal(err)
	}
	var got photoHostApplyRequest
	if json.Unmarshal(data, &got) != nil || got != req {
		t.Fatalf("no-clobber failed: %+v", got)
	}
	for _, bad := range []photoHostApplyRequest{
		{RequestID: "not-a-token", Revision: 1, Enabled: true, CreatedAt: now},
		{RequestID: req.RequestID, Revision: 1, Enabled: false, CreatedAt: now},
		{RequestID: req.RequestID, Revision: 0, Enabled: true, CreatedAt: now},
	} {
		if err := writePhotoHostApplyRequest(dir, bad); err == nil {
			t.Fatalf("unsafe host apply request accepted: %+v", bad)
		}
	}
}
