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

func TestAdminCaddyHTTPSDesiredRevisionAndActualStatus(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	gin.SetMode(gin.TestMode)
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "caddy_https_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	if err := db.AutoMigrate(&meta.User{}, &meta.AuditEvent{}, &meta.AdminCaddyHTTPSSetting{},
		&meta.AdminCaddyHTTPSRevision{}); err != nil {
		t.Fatal(err)
	}
	s := &Server{DB: db, Auth: auth.New("caddy-https-config-test-secret", time.Hour), HostControlDir: t.TempDir()}
	admin := meta.User{Username: "admin-caddy", PasswordHash: "fixture", Role: meta.UserRoleAdmin, SessionVersion: 1}
	member := meta.User{Username: "member-caddy", PasswordHash: "fixture", Role: meta.UserRoleUser, SessionVersion: 1}
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
	const path = "/api/v1/admin/services/caddy/https"
	get := func() adminCaddyHTTPSConfigDTO {
		t.Helper()
		res := request(http.MethodGet, path, adminToken, "")
		if res.Code != http.StatusOK {
			t.Fatalf("GET Caddy HTTPS %d: %s", res.Code, res.Body.String())
		}
		var cfg adminCaddyHTTPSConfigDTO
		if err := json.Unmarshal(res.Body.Bytes(), &cfg); err != nil {
			t.Fatal(err)
		}
		return cfg
	}
	if r := request(http.MethodGet, path, "", ""); r.Code != 401 {
		t.Fatalf("anonymous Caddy GET %d", r.Code)
	}
	if r := request(http.MethodGet, path, memberToken, ""); r.Code != 403 {
		t.Fatalf("non-admin Caddy GET %d", r.Code)
	}
	if r := request(http.MethodPut, path, memberToken, `{"revision":0,"enabled":true,"domain":"photos.example.com"}`); r.Code != 403 {
		t.Fatalf("non-admin staged Caddy mutation %d", r.Code)
	}
	cfg := get()
	if cfg.Revision != 0 || cfg.ApplyState != "unmanaged" || cfg.ApplySupported ||
		cfg.HostObserved || cfg.DesiredEnabled || cfg.DesiredDomain != "" {
		t.Fatalf("unmanaged default pretended host config: %+v", cfg)
	}
	// The first read after a fresh, IP-only installation should make the
	// validated host LAN address editable as the unsaved default, while never
	// mistaking it for an applied or audited database revision.
	t.Setenv("XD_LAN_HTTPS_IP", "192.168.2.4")
	freshIP := get()
	if freshIP.Revision != 0 || freshIP.Source != "default" ||
		!freshIP.DesiredLANEnabled || freshIP.DesiredLANIP != "192.168.2.4" ||
		!freshIP.HostLANConfigured || freshIP.ApplyState != "unmanaged" ||
		freshIP.ApplySupported || freshIP.HostLANIP != "192.168.2.4" {
		t.Fatalf("fresh IP deployment did not initialize an honest default: %+v", freshIP)
	}
	// On a fresh deployment, the domain is an optional SECOND entry, sourced
	// only from a canonical operator declaration. It stays unsaved/unapplied.
	t.Setenv("XD_DOMAIN", "PHOTOS.EXAMPLE.COM")
	dualDefault := get()
	if dualDefault.Revision != 0 || dualDefault.Source != "default" ||
		!dualDefault.DesiredEnabled || dualDefault.DesiredDomain != "photos.example.com" ||
		!dualDefault.DesiredLANEnabled || dualDefault.DesiredLANIP != "192.168.2.4" ||
		dualDefault.ApplyState != "unmanaged" || dualDefault.ApplySupported {
		t.Fatalf("dual-entry deployment defaults were not independently reflected: %+v", dualDefault)
	}
	t.Setenv("XD_LAN_HTTPS_IP", "")
	domainOnlyDefault := get()
	if domainOnlyDefault.Revision != 0 || !domainOnlyDefault.DesiredEnabled ||
		domainOnlyDefault.DesiredDomain != "photos.example.com" ||
		domainOnlyDefault.DesiredLANEnabled || domainOnlyDefault.DesiredLANIP != "" ||
		domainOnlyDefault.ApplySupported || domainOnlyDefault.ApplyState != "unmanaged" {
		t.Fatalf("domain-only deployment default was inaccurate: %+v", domainOnlyDefault)
	}
	// Invalid or spoofed host domains must never become enabled admin intent.
	for _, badDomain := range []string{"https://example.com", "localhost", "8.8.8.8",
		"*.example.com", " photos.example.com", "photos.example.com:8443"} {
		t.Setenv("XD_DOMAIN", badDomain)
		invalidDomain := get()
		if invalidDomain.DesiredEnabled || invalidDomain.DesiredDomain != "" ||
			invalidDomain.ApplySupported {
			t.Fatalf("unsafe host domain became an initial HTTPS choice %q: %+v", badDomain, invalidDomain)
		}
	}
	t.Setenv("XD_DOMAIN", "")
	// Invalid public or spoofed host environment never becomes a login option.
	t.Setenv("XD_LAN_HTTPS_IP", "8.8.8.8")
	unsafeIP := get()
	if unsafeIP.DesiredLANEnabled || unsafeIP.DesiredLANIP != "" ||
		unsafeIP.HostLANConfigured || unsafeIP.HostLANIP != "" {
		t.Fatalf("unsafe deployment IP became a default HTTPS entry: %+v", unsafeIP)
	}
	t.Setenv("XD_LAN_HTTPS_IP", "")
	for _, body := range []string{
		`{"revision":0}`,
		`{"revision":0,"enabled":true,"domain":""}`,
		`{"revision":0,"enabled":true,"domain":"https://example.com"}`,
		`{"revision":0,"enabled":true,"domain":"127.0.0.1"}`,
		`{"revision":0,"enabled":false,"domain":"bad.example.com/path"}`,
		`{"revision":0,"enabled":false,"domain":""}`,
		`{"revision":0,"enabled":false,"domain":"","lan_enabled":true,"lan_ip":"8.8.8.8"}`,
		`{"revision":0,"enabled":false,"domain":"","lan_enabled":true,"lan_ip":"192.168.02.4"}`,
	} {
		if r := request(http.MethodPut, path, adminToken, body); r.Code != 400 {
			t.Fatalf("invalid/incomplete desired Caddy HTTPS edit accepted: %d %s", r.Code, body)
		}
	}
	const first = `{"revision":0,"enabled":true,"domain":"PHOTOS.EXAMPLE.COM"}`
	if r := request(http.MethodPut, path, adminToken, first); r.Code != 200 {
		t.Fatalf("save desired HTTPS failed: %d %s", r.Code, r.Body.String())
	}
	// Ordinary global health must never expose the staged administrator domain.
	inventory := request(http.MethodGet, "/api/v1/admin/services", adminToken, "")
	if inventory.Code != http.StatusOK || strings.Contains(inventory.Body.String(), "photos.example.com") {
		t.Fatalf("Caddy HTTPS domain leaked into global health: %d", inventory.Code)
	}
	cfg = get()
	if cfg.Revision != 1 || !cfg.DesiredEnabled || cfg.DesiredDomain != "photos.example.com" ||
		cfg.ApplyState != "pending" || cfg.ApplySupported || !cfg.RequiresRestrictedMaintenance {
		t.Fatalf("desired config incorrectly acknowledged as host applied: %+v", cfg)
	}
	if r := request(http.MethodPut, path, adminToken, first); r.Code != 409 {
		t.Fatalf("stale write %d", r.Code)
	}
	// Even when a real Caddy host observation reports locally verified HTTPS,
	// that bridge contains no domain/revision proof. Desired revision stays pending.
	hostBytes, err := json.Marshal(caddyHostStatus{
		State: "healthy", HTTPSConfigured: true, TLSCheckSupported: true, TLSState: "verified",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.HostControlDir, caddyHostStatusName), hostBytes, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.HostControlDir, "heartbeat"), []byte("ok"), 0600); err != nil {
		t.Fatal(err)
	}
	cfg = get()
	if !cfg.HostObserved || cfg.HostTLSState != "verified" || cfg.ApplyState != "pending" || cfg.ApplySupported {
		t.Fatalf("host-only TLS observation falsely applied desired settings: %+v", cfg)
	}
	if r := request(http.MethodPost, path+"/apply", adminToken, `{"revision":1}`); r.Code != 404 {
		t.Fatalf("dangerous Caddy deployment action was exposed: %d", r.Code)
	}
	revisions := request(http.MethodGet, path+"/revisions", adminToken, "")
	var history struct {
		Items []adminCaddyHTTPSRevisionDTO `json:"items"`
	}
	if revisions.Code != 200 || json.Unmarshal(revisions.Body.Bytes(), &history) != nil ||
		len(history.Items) != 2 || history.Items[0].Revision != 1 || history.Items[1].Revision != 0 ||
		history.Items[1].Enabled || history.Items[1].Domain != "" {
		t.Fatalf("untrusted revision journal: %d %+v", revisions.Code, history)
	}
	const second = `{"revision":1,"enabled":false,"domain":"photos.example.com","lan_enabled":true,"lan_ip":"192.168.2.4"}`
	if r := request(http.MethodPut, path, adminToken, second); r.Code != 200 {
		t.Fatalf("domain disable with preserved LAN entry failed: %d", r.Code)
	}
	cfg = get()
	if cfg.DesiredEnabled || !cfg.DesiredLANEnabled || cfg.DesiredLANIP != "192.168.2.4" ||
		cfg.ApplySupported || cfg.ApplyState != "pending" {
		t.Fatalf("LAN-only desired state was not persisted or falsely applied: %+v", cfg)
	}
	// Old clients that omit lan_enabled/lan_ip preserve current LAN settings;
	// removing the last enabled endpoint must still fail.
	if r := request(http.MethodPut, path, adminToken,
		`{"revision":2,"enabled":false,"domain":"","lan_enabled":false,"lan_ip":""}`); r.Code != 400 {
		t.Fatalf("accepted disabled LAN and domain: %d", r.Code)
	}
	if r := request(http.MethodPost, path+"/rollback", memberToken, `{"revision":2,"target_revision":1}`); r.Code != 403 {
		t.Fatalf("non-admin HTTPS rollback accepted: %d", r.Code)
	}
	if r := request(http.MethodPost, path+"/rollback", adminToken, `{"revision":1,"target_revision":0}`); r.Code != 409 {
		t.Fatalf("stale HTTPS rollback must conflict before unsafe history: %d", r.Code)
	}
	// Old revision zero is preserved for audit, not restorable: both
	// trusted HTTPS entry points were disabled at that legacy default.
	if r := request(http.MethodPost, path+"/rollback", adminToken, `{"revision":2,"target_revision":0}`); r.Code != 400 {
		t.Fatalf("unsafe historical both-off rollback was accepted: %d", r.Code)
	}
	if current := get(); current.Revision != 2 || !current.DesiredLANEnabled {
		t.Fatalf("rejected rollback mutated current ingress: %+v", current)
	}
	if r := request(http.MethodPost, path+"/rollback", adminToken, `{"revision":2,"target_revision":1}`); r.Code != 200 {
		t.Fatalf("desired HTTPS rollback failed: %d %s", r.Code, r.Body.String())
	}
	cfg = get()
	if cfg.Revision != 3 || !cfg.DesiredEnabled || cfg.ApplyState != "pending" || cfg.ApplySupported {
		t.Fatalf("rollback pretended Caddy activation: %+v", cfg)
	}
	var row meta.AdminCaddyHTTPSSetting
	if err := db.Where("name = ?", caddyHTTPSSettingName).Take(&row).Error; err != nil || row.Revision != 3 {
		t.Fatalf("desired Caddy row inconsistent: %+v %v", row, err)
	}
	var audits int64
	if err := db.Model(&meta.AuditEvent{}).Where("action LIKE ?", "admin.service.caddy_https.%").Count(&audits).Error; err != nil {
		t.Fatal(err)
	}
	if audits < 3 {
		t.Fatalf("expected audited saves and rollback; got %d", audits)
	}
	// Failure to audit must reject rather than persisting a desired revision.
	if err := db.Migrator().DropTable(&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	if res := request(http.MethodPut, path, adminToken, `{"revision":3,"enabled":true,"domain":"photos.example.com"}`); res.Code != 503 {
		t.Fatalf("unaudited staged HTTPS change accepted: %d", res.Code)
	}
	if err := db.Where("name = ?", caddyHTTPSSettingName).Take(&row).Error; err != nil || row.Revision != 3 {
		t.Fatalf("desired HTTPS row changed despite audit failure: %+v %v", row, err)
	}
}
