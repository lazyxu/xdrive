package api

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
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
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestAdminCaddyHTTPSPreflightReadOnlyNoFalseApplied(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	gin.SetMode(gin.TestMode)
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "caddy_preflight_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.User{}, &meta.AdminServiceSecret{}, &meta.AuditEvent{},
		&meta.AdminCaddyHTTPSSetting{}, &meta.AdminCaddyHTTPSRevision{}); err != nil {
		t.Fatal(err)
	}
	ring, err := connectorsecret.NewKeyring(1, map[uint32]string{1: strings.Repeat("da", 32)})
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{
		DB: db, Auth: auth.New("caddy-preflight-test-secret", time.Hour),
		ConnectorSecrets: ring, HostControlDir: t.TempDir(),
	}
	admin := meta.User{Username: "preflight-admin", PasswordHash: "test", Role: meta.UserRoleAdmin, SessionVersion: 1}
	member := meta.User{Username: "preflight-member", PasswordHash: "test", Role: meta.UserRoleUser, SessionVersion: 1}
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
	call := func(method, path, token, body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		return out
	}
	const path = "/api/v1/admin/services/caddy/https/preflight"
	read := func() adminCaddyPreflightDTO {
		t.Helper()
		out := call(http.MethodGet, path, adminToken, "")
		if out.Code != 200 {
			t.Fatalf("preflight HTTP %d: %s", out.Code, out.Body.String())
		}
		var dto adminCaddyPreflightDTO
		if err := json.Unmarshal(out.Body.Bytes(), &dto); err != nil {
			t.Fatal(err)
		}
		if out.Header().Get("Cache-Control") != "no-store" || dto.ApplySupported ||
			!dto.SnapshotStable || len(dto.Checks) != 7 {
			t.Fatalf("preflight must be private and never claim host apply: %+v", dto)
		}
		return dto
	}
	for _, test := range []struct {
		token  string
		status int
	}{{"", 401}, {memberToken, 403}} {
		if out := call(http.MethodGet, path, test.token, ""); out.Code != test.status {
			t.Fatalf("nonadmin HTTPS preflight got %d expected %d", out.Code, test.status)
		}
	}
	blank := read()
	if blank.Action != "unset" || blank.ConfigurationComplete || blank.HostObserved ||
		blank.DesiredRevision != 0 || blank.CredentialRevision != 0 ||
		blank.DesiredDomainLocalMatch != "unverified" || blank.IngressChangeRisk != "unverified" {
		t.Fatalf("no staged configuration should fail closed: %+v", blank)
	}
	if out := call(http.MethodPost, path+"/apply", adminToken, `{"revision":1}`); out.Code != 404 {
		t.Fatalf("unsafe preflight apply route must not exist: %d", out.Code)
	}
	if out := call(http.MethodPut, "/api/v1/admin/services/caddy/https", adminToken,
		`{"revision":0,"enabled":true,"domain":"PHOTOS.EXAMPLE.COM"}`); out.Code != 200 {
		t.Fatalf("staging desired HTTPS failed: %d %s", out.Code, out.Body.String())
	}
	const keyID = "LTAI-For-Prefight-Only-1234"
	const keySecret = "Caddy-AliDNS-Secret-Example-abcDEF0123"
	if out := call(http.MethodPut, "/api/v1/admin/services/caddy/alidns", adminToken,
		`{"revision":0,"access_key_id":"`+keyID+`","access_key_secret":"`+keySecret+`"}`); out.Code != 200 {
		t.Fatalf("encrypted AliDNS staging failed: %d %s", out.Code, out.Body.String())
	}
	var auditBefore int64
	if err := db.Model(&meta.AuditEvent{}).Count(&auditBefore).Error; err != nil {
		t.Fatal(err)
	}
	response := call(http.MethodGet, path, adminToken, "")
	if response.Code != 200 || bytes.Contains(response.Body.Bytes(), []byte(keyID)) ||
		bytes.Contains(response.Body.Bytes(), []byte(keySecret)) ||
		bytes.Contains(response.Body.Bytes(), []byte("photos.example.com")) {
		t.Fatalf("preflight leaked desired hostname or secret: HTTP %d", response.Code)
	}
	cfg := read()
	if cfg.Action != "enable" || !cfg.ConfigurationComplete || cfg.HostObserved ||
		cfg.DesiredRevision != 1 || cfg.CredentialRevision != 1 ||
		cfg.HostIngressReady || cfg.HostLocalTLSVerified || cfg.ApplySupported ||
		cfg.DesiredDomainLocalMatch != "unverified" || cfg.IngressChangeRisk != "unverified" {
		t.Fatalf("local config was not recorded, or fake host effect published: %+v", cfg)
	}
	if cfg.Checks[2].ID != "alidns" || cfg.Checks[2].State != "pass" ||
		cfg.Checks[5].ID != "restricted-apply" || cfg.Checks[5].State != "blocked" {
		t.Fatalf("local decryption cannot bypass restricted host apply: %+v", cfg.Checks)
	}
	// Even genuine current HTTP/TLS host observations belong to the *existing*
	// host settings. They do not prove which HTTPS desired revision was applied.
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
	cfg = read()
	if !cfg.HostObserved || !cfg.HostIngressReady || !cfg.HostLocalTLSVerified ||
		!cfg.ConfigurationComplete || cfg.ApplySupported || cfg.Checks[5].State != "blocked" ||
		cfg.DesiredDomainLocalMatch != "unverified" || cfg.IngressChangeRisk != "unverified" {
		t.Fatalf("trusted host TLS observation must not acknowledge new desired HTTPS: %+v", cfg)
	}
	// Explicitly compare the desired FQDN with the host's TLS-verified
	// local SNI, without disclosing either hostname or implying applied revision.
	writeVerifiedHostSNI := func(domain string) {
		t.Helper()
		sum := sha256.Sum256([]byte(domain))
		proof, marshalErr := json.Marshal(caddyHostStatus{
			State: "healthy", HTTPSConfigured: true,
			TLSCheckSupported: true, TLSState: "verified",
			TLSVerifiedDomainSHA256: fmt.Sprintf("%x", sum),
		})
		if marshalErr != nil {
			t.Fatal(marshalErr)
		}
		if writeErr := os.WriteFile(filepath.Join(s.HostControlDir, caddyHostStatusName), proof, 0600); writeErr != nil {
			t.Fatal(writeErr)
		}
	}
	writeVerifiedHostSNI("photos.example.com")
	matchedResponse := call(http.MethodGet, path, adminToken, "")
	if matchedResponse.Code != 200 ||
		bytes.Contains(matchedResponse.Body.Bytes(), []byte("photos.example.com")) {
		t.Fatalf("matched local SNI exposed hostname or failed: %d", matchedResponse.Code)
	}
	cfg = read()
	if cfg.DesiredDomainLocalMatch != "matched-local" || cfg.ApplySupported ||
		cfg.Checks[5].State != "blocked" || !cfg.HostLocalTLSVerified ||
		cfg.IngressChangeRisk != "unverified" {
		t.Fatalf("matching local SNI must not authorize Caddy apply: %+v", cfg)
	}
	writeVerifiedHostSNI("old.example.com")
	cfg = read()
	if cfg.DesiredDomainLocalMatch != "mismatch-local" || cfg.ApplySupported ||
		cfg.Checks[5].State != "blocked" || cfg.IngressChangeRisk != "local-domain-switch" {
		t.Fatalf("mismatched desired and observed TLS SNI was not detected: %+v", cfg)
	}
	// A decryption failure is a *blocked credential prerequisite*, not an
	// invented healthy AliDNS permission or a plaintext-bearing response.
	if err := db.Model(&meta.AdminServiceSecret{}).
		Where("name = ?", caddyAliDNSSecretName).
		Update("ciphertext", []byte("corrupt-aead")).Error; err != nil {
		t.Fatal(err)
	}
	cfg = read()
	if cfg.ConfigurationComplete || cfg.Checks[2].State != "blocked" {
		t.Fatalf("corrupted secret falsely cleared readiness: %+v", cfg)
	}
	s.ConnectorSecrets = nil
	cfg = read()
	if cfg.ConfigurationComplete || cfg.Checks[2].State != "blocked" {
		t.Fatalf("missing keyring falsely passed credential check: %+v", cfg)
	}
	// Disable intent never needs fresh AliDNS credentials, but still cannot
	// restart the real Caddy ingress or claim host applied.
	if out := call(http.MethodPut, "/api/v1/admin/services/caddy/https", adminToken,
		`{"revision":1,"enabled":false,"domain":""}`); out.Code != 200 {
		t.Fatalf("staging HTTPS disable failed: %d %s", out.Code, out.Body.String())
	}
	cfg = read()
	if cfg.Action != "disable" || !cfg.ConfigurationComplete ||
		cfg.Checks[2].State != "not-required" || cfg.ApplySupported ||
		cfg.DesiredDomainLocalMatch != "unverified" || cfg.IngressChangeRisk != "local-https-removal" {
		t.Fatalf("HTTPS disable preflight must not require AliDNS or be applied: %+v", cfg)
	}
	var auditAfter int64
	if err := db.Model(&meta.AuditEvent{}).Count(&auditAfter).Error; err != nil {
		t.Fatal(err)
	}
	if auditAfter != auditBefore+1 {
		t.Fatalf("read-only preflight wrote unexpected audit records before=%d after=%d", auditBefore, auditAfter)
	}

	// PostgreSQL REPEATABLE READ guarantees that two independently revisioned
	// rows in a single admin preflight observation come from one snapshot:
	// mutate the credential after the first SELECT on another SQL connection.
	tx := db.Begin(&sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if tx.Error != nil {
		t.Fatal(tx.Error)
	}
	capturedDesired, err := readCaddyHTTPSDesiredDB(tx)
	if err != nil || capturedDesired.Revision != 2 {
		_ = tx.Rollback().Error
		t.Fatalf("repeatable-read HTTPS desired: %+v, %v", capturedDesired, err)
	}
	if err := db.Model(&meta.AdminServiceSecret{}).
		Where("name = ?", caddyAliDNSSecretName).
		Update("revision", gorm.Expr("revision + ?", 1)).Error; err != nil {
		_ = tx.Rollback().Error
		t.Fatal(err)
	}
	oldCredential, exists, err := readCaddyAliDNSSettingDB(tx)
	if err != nil || !exists || oldCredential.Revision != 1 {
		_ = tx.Rollback().Error
		t.Fatalf("repeatable-read mixed new credential: %+v, %v", oldCredential, err)
	}
	if err := tx.Rollback().Error; err != nil {
		t.Fatal(err)
	}
	now, err := s.readCaddyPreflightSnapshot(t.Context())
	if err != nil || now.Credential.Revision != 2 {
		t.Fatalf("fresh preflight snapshot missed rotation: %+v, %v", now, err)
	}
}
