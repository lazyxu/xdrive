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

func TestAdminPhotoHostDesiredAuditedRevisionRollbackAndNoHostApply(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	gin.SetMode(gin.TestMode)
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "photo_host_desired_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.User{}, &meta.AuditEvent{},
		&meta.AdminPhotoHostSetting{}, &meta.AdminPhotoHostRevision{}); err != nil {
		t.Fatal(err)
	}
	s := &Server{
		DB: db, Auth: auth.New("photo-host-desired-test-secret", time.Hour),
		HostControlDir: t.TempDir(),
	}
	admin := meta.User{Username: "admin-photo-host", PasswordHash: "fixture", Role: meta.UserRoleAdmin, SessionVersion: 1}
	member := meta.User{Username: "member-photo-host", PasswordHash: "fixture", Role: meta.UserRoleUser, SessionVersion: 1}
	for _, user := range []*meta.User{&admin, &member} {
		if err := db.Create(user).Error; err != nil {
			t.Fatal(err)
		}
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
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		return res
	}
	const path = "/api/v1/admin/services/photo-intelligence/host"
	get := func() adminPhotoHostConfigDTO {
		t.Helper()
		res := request(http.MethodGet, path, adminToken, "")
		if res.Code != http.StatusOK || res.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("GET host %d: %s", res.Code, res.Body.String())
		}
		var cfg adminPhotoHostConfigDTO
		if err := json.Unmarshal(res.Body.Bytes(), &cfg); err != nil {
			t.Fatal(err)
		}
		return cfg
	}
	for _, tc := range []struct{ method, path, body string }{
		{http.MethodGet, path, ""},
		{http.MethodGet, path + "/revisions", ""},
		{http.MethodGet, path + "/preflight", ""},
		{http.MethodPut, path, `{"revision":0,"enabled":true}`},
		{http.MethodPost, path + "/rollback", `{"revision":1,"target_revision":0}`},
	} {
		if result := request(tc.method, tc.path, "", tc.body); result.Code != 401 {
			t.Fatalf("anonymous host operation %s %s: %d", tc.method, tc.path, result.Code)
		}
		if result := request(tc.method, tc.path, memberToken, tc.body); result.Code != 403 {
			t.Fatalf("non-admin host operation %s %s: %d", tc.method, tc.path, result.Code)
		}
	}
	preflightResult := request(http.MethodGet, path+"/preflight", adminToken, "")
	var preflight adminPhotoHostPreflightDTO
	if preflightResult.Code != http.StatusOK ||
		preflightResult.Header().Get("Cache-Control") != "no-store" ||
		json.Unmarshal(preflightResult.Body.Bytes(), &preflight) != nil ||
		preflight.Action != "unset" || preflight.ApplySupported || preflight.LocalChecksComplete ||
		len(preflight.Checks) != 7 {
		t.Fatalf("preflight of unmanaged host was unsafe: %d %s", preflightResult.Code, preflightResult.Body.String())
	}
	cfg := get()
	if cfg.Revision != 0 || cfg.Source != "default" || cfg.DesiredEnabled ||
		cfg.ApplyState != "unmanaged" || cfg.ApplySupported || cfg.HostObserved ||
		cfg.HostRuntimeState != "unknown" || cfg.HostProfileConfigured != nil {
		t.Fatalf("unmanaged default claimed host state: %+v", cfg)
	}
	for _, body := range []string{
		`{"revision":0}`, `{"enabled":true}`, `{"revision":0,"enabled":null}`,
		`{"revision":-1,"enabled":true}`, `{"revision":1152921504606846976,"enabled":true}`,
		`{"revision":0,"enabled":"yes"}`, `{"revision":0,"enabled":true`,
	} {
		if res := request(http.MethodPut, path, adminToken, body); res.Code != 400 {
			t.Fatalf("invalid host intent accepted (%s): %d", body, res.Code)
		}
	}
	if res := request(http.MethodPut, path, adminToken, `{"revision":0,"enabled":true}`); res.Code != 200 {
		t.Fatalf("stage host enable failed: %d %s", res.Code, res.Body.String())
	}
	cfg = get()
	if cfg.Revision != 1 || !cfg.DesiredEnabled || cfg.ApplyState != "pending" ||
		cfg.ApplySupported || cfg.HostObserved {
		t.Fatalf("saving desired state incorrectly applied container: %+v", cfg)
	}
	if res := request(http.MethodPut, path, adminToken, `{"revision":0,"enabled":false}`); res.Code != 409 {
		t.Fatalf("stale desired revision accepted: %d", res.Code)
	}
	// A fresh, healthy host whose Compose profile happens to match the desired
	// boolean still provides NO acknowledgement of desired revision 1.
	host, err := json.Marshal(map[string]any{"state": "healthy", "profile_configured": true})
	if err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string][]byte{
		photoIntelligenceHostStatusName: host, "heartbeat": []byte("ok"),
	} {
		if err := os.WriteFile(filepath.Join(s.HostControlDir, name), content, 0600); err != nil {
			t.Fatal(err)
		}
	}
	cfg = get()
	if !cfg.HostObserved || cfg.HostRuntimeState != "healthy" ||
		cfg.HostProfileConfigured == nil || !*cfg.HostProfileConfigured ||
		cfg.ApplyState != "pending" || cfg.ApplySupported {
		t.Fatalf("host-only observation pretended saved host revision applied: %+v", cfg)
	}
	// Host-side success is deliberately not enough until the Server implements
	// an audited exact-revision request token bridge in a follow-on phase.
	fixedHostReport := photoHostControlStatus{
		Supported: true, State: "success", Revision: 1, AppliedRevision: 1,
		Enabled: true, ProfileVerified: true, ObservedHostState: "healthy",
		RequestID: "0123456789abcdef01234567",
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	report, err := json.Marshal(fixedHostReport)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.HostControlDir, photoHostControlStatusName), report, 0600); err != nil {
		t.Fatal(err)
	}
	cfg = get()
	if !cfg.HostControlSupported || cfg.HostControlState != "success" ||
		cfg.HostAppliedRevision != 1 || !cfg.HostControlProfileVerified ||
		cfg.ApplyState != "pending" || cfg.ApplySupported {
		t.Fatalf("host-side observation falsely authorized saved revision apply: %+v", cfg)
	}
	preflightResult = request(http.MethodGet, path+"/preflight", adminToken, "")
	if json.Unmarshal(preflightResult.Body.Bytes(), &preflight) != nil ||
		preflight.Action != "enable" || !preflight.LocalChecksComplete ||
		preflight.ApplySupported || !preflight.HostControlObserved {
		t.Fatalf("healthy host preflight incorrectly authorized apply: %d %s", preflightResult.Code, preflightResult.Body.String())
	}
	if res := request(http.MethodPost, path+"/apply", adminToken, `{"revision":1}`); res.Code != 404 {
		t.Fatalf("dangerous photo host apply endpoint exposed: %d", res.Code)
	}
	revs := request(http.MethodGet, path+"/revisions", adminToken, "")
	var history struct {
		Items []adminPhotoHostRevisionDTO `json:"items"`
	}
	if revs.Code != 200 || json.Unmarshal(revs.Body.Bytes(), &history) != nil ||
		len(history.Items) != 2 || history.Items[0].Revision != 1 ||
		history.Items[1].Revision != 0 || history.Items[1].Enabled {
		t.Fatalf("initial immutable host revisions missing: %d %+v", revs.Code, history)
	}
	if res := request(http.MethodPut, path, adminToken, `{"revision":1,"enabled":false}`); res.Code != 200 {
		t.Fatalf("stage host disable failed: %d %s", res.Code, res.Body.String())
	}
	if res := request(http.MethodPost, path+"/rollback", adminToken, `{"revision":1,"target_revision":0}`); res.Code != 409 {
		t.Fatalf("stale host rollback accepted: %d", res.Code)
	}
	if res := request(http.MethodPost, path+"/rollback", adminToken, `{"revision":2,"target_revision":99}`); res.Code != 400 {
		t.Fatalf("future host rollback accepted: %d", res.Code)
	}
	if res := request(http.MethodPost, path+"/rollback", adminToken, `{"revision":2,"target_revision":1}`); res.Code != 200 {
		t.Fatalf("host desired rollback failed: %d %s", res.Code, res.Body.String())
	}
	cfg = get()
	if cfg.Revision != 3 || !cfg.DesiredEnabled || cfg.ApplyState != "pending" || cfg.ApplySupported {
		t.Fatalf("rollback incorrectly claimed host activation: %+v", cfg)
	}
	revs = request(http.MethodGet, path+"/revisions", adminToken, "")
	if revs.Code != 200 || json.Unmarshal(revs.Body.Bytes(), &history) != nil {
		t.Fatalf("host revisions cannot be reloaded: %d", revs.Code)
	}
	var audits int64
	if err := db.Model(&meta.AuditEvent{}).Where("action LIKE ?", "admin.service.photo-host.%").
		Count(&audits).Error; err != nil {
		t.Fatal(err)
	}
	if audits < 3 {
		t.Fatalf("missing atomic audit for host changes: %d", audits)
	}
	if err := db.Migrator().DropTable(&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	if res := request(http.MethodPut, path, adminToken, `{"revision":3,"enabled":false}`); res.Code != 503 {
		t.Fatalf("unaudited host desired change persisted: %d", res.Code)
	}
	var row meta.AdminPhotoHostSetting
	if err := db.Where("name = ?", photoHostSettingName).Take(&row).Error; err != nil ||
		row.Revision != 3 || !row.Enabled {
		t.Fatalf("host desired changed despite audit failure: %+v %v", row, err)
	}
}

func TestReadPhotoHostDesiredFailsClosedWithoutDB(t *testing.T) {
	var s Server
	if _, err := s.readPhotoHostDesired(nil); err == nil {
		t.Fatal("missing DB must not fabricate a saved or applied host revision")
	}
}
