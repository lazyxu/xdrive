package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
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

func TestCaddyAliDNSCredentialValidation(t *testing.T) {
	for _, input := range []caddyAliDNSSecretPair{
		{AccessKeyID: "", AccessKeySecret: "sample-good-secret"},
		{AccessKeyID: "short", AccessKeySecret: "sample-good-secret"},
		{AccessKeyID: "sample-good-id", AccessKeySecret: "short"},
		{AccessKeyID: "sample-good-id", AccessKeySecret: "has\nnewline"},
		{AccessKeyID: strings.Repeat("x", 129), AccessKeySecret: "sample-good-secret"},
		{AccessKeyID: "sample-good-id", AccessKeySecret: strings.Repeat("x", 257)},
	} {
		if validCaddyAliDNSPair(input) {
			t.Fatalf("accepted invalid AliDNS credential lengths or control characters")
		}
	}
	if !validCaddyAliDNSPair(caddyAliDNSSecretPair{AccessKeyID: "LTAI8sampleKey", AccessKeySecret: "secreT+/=example-123"}) {
		t.Fatal("rejected safe sample credentials")
	}
}

func TestAdminCaddyAliDNSStagingEncryptionAndAccessControl(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL not configured")
	}
	gin.SetMode(gin.TestMode)
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "caddy_alidns_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
	uri, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := uri.Query()
	query.Set("search_path", schema)
	uri.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(uri.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.User{}, &meta.AdminServiceSecret{}, &meta.AuditEvent{},
		&meta.AdminCaddyHTTPSSetting{}, &meta.AdminCaddyHostApplyReservation{}); err != nil {
		t.Fatal(err)
	}
	ring, err := connectorsecret.NewKeyring(1, map[uint32]string{1: strings.Repeat("ba", 32)})
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{DB: db, Auth: auth.New("caddy-alidns-security-test-secret", time.Hour), ConnectorSecrets: ring}
	router := server.Router()
	admin := meta.User{Username: "alidns-admin", PasswordHash: "test", Role: meta.UserRoleAdmin, SessionVersion: 1}
	member := meta.User{Username: "alidns-member", PasswordHash: "test", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&member).Error; err != nil {
		t.Fatal(err)
	}
	adminToken, err := server.Auth.Issue(admin.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	memberToken, err := server.Auth.Issue(member.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
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
	const path = "/api/v1/admin/services/caddy/alidns"
	for _, tt := range []struct {
		token string
		want  int
	}{{"", 401}, {memberToken, 403}} {
		if r := call(http.MethodGet, path, tt.token, ""); r.Code != tt.want {
			t.Fatalf("read bypass=%d want=%d", r.Code, tt.want)
		}
		if r := call(http.MethodPut, path, tt.token, `{"revision":0,"access_key_id":"LTAI8sampleKey","access_key_secret":"secret-demo-123"}`); r.Code != tt.want {
			t.Fatalf("write bypass=%d want=%d", r.Code, tt.want)
		}
		if r := call(http.MethodPost, path+"/reveal", tt.token, `{"revision":0}`); r.Code != tt.want {
			t.Fatalf("reveal bypass=%d", r.Code)
		}
	}
	if r := call(http.MethodGet, path, adminToken, ""); r.Code != 200 ||
		!strings.Contains(r.Body.String(), `"configured":false`) ||
		!strings.Contains(r.Body.String(), `"apply_supported":false`) {
		t.Fatalf("initial status incorrect: %d %s", r.Code, r.Body.String())
	}
	for _, body := range []string{
		`{"access_key_id":"LTAI8sampleKey","access_key_secret":"secret-demo-123"}`,
		`{"revision":0,"access_key_id":"LTAI8sampleKey"}`,
		`{"revision":0,"access_key_secret":"secret-demo-123"}`,
		`{"revision":0,"access_key_id":"LTAI8sampleKey","access_key_secret":"bad\nsecret"}`,
		`{"revision":0,"access_key_id":"LTAI8sampleKey","access_key_secret":"secret-demo-123","clear":true}`,
	} {
		if r := call(http.MethodPut, path, adminToken, body); r.Code != 400 {
			t.Fatalf("invalid AliDNS write accepted: %d", r.Code)
		}
	}
	id, secret := "LTAI123SampleIDxyz", "SampleSecretABCDEFG0123+/"
	saved := call(http.MethodPut, path, adminToken,
		fmt.Sprintf(`{"revision":0,"access_key_id":%q,"access_key_secret":%q}`, id, secret))
	if saved.Code != 200 || strings.Contains(saved.Body.String(), id) ||
		strings.Contains(saved.Body.String(), secret) ||
		!strings.Contains(saved.Body.String(), `"revision":1`) ||
		!strings.Contains(saved.Body.String(), `"apply_state":"pending"`) {
		t.Fatalf("saving credentials must not reveal/apply them, HTTP %d", saved.Code)
	}
	var row meta.AdminServiceSecret
	if err := db.Where("name = ?", caddyAliDNSSecretName).First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.KeyVersion != 1 || row.Revision != 1 || !row.Enabled || len(row.Ciphertext) == 0 ||
		bytes.Contains(row.Ciphertext, []byte(id)) || bytes.Contains(row.Ciphertext, []byte(secret)) {
		t.Fatal("AliDNS must persist as authenticated ciphertext, with a new revision")
	}
	plain, err := ring.Open(caddyAliDNSSecretAADID, caddyAliDNSSecretKind, row.KeyVersion, row.Ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	var pair caddyAliDNSSecretPair
	if err := json.Unmarshal(plain, &pair); err != nil {
		t.Fatal(err)
	}
	clear(plain)
	if pair.AccessKeyID != id || pair.AccessKeySecret != secret {
		t.Fatal("encrypted credentials mismatch")
	}
	if _, err := ring.Open(baiduMapSecretAADID, baiduMapSecretKind, row.KeyVersion, row.Ciphertext); err == nil {
		t.Fatal("AliDNS ciphertext must not authenticate under the Baidu provider AAD")
	}
	inventory := call(http.MethodGet, "/api/v1/admin/services", adminToken, "")
	if strings.Contains(inventory.Body.String(), id) || strings.Contains(inventory.Body.String(), secret) {
		t.Fatal("global service list must not reveal AliDNS credentials")
	}
	if r := call(http.MethodPut, path, adminToken,
		fmt.Sprintf(`{"revision":0,"access_key_id":%q,"access_key_secret":%q}`, id, secret)); r.Code != 409 {
		t.Fatalf("stale edit must return 409, got %d", r.Code)
	}
	if r := call(http.MethodPost, path+"/reveal", adminToken, `{"revision":0}`); r.Code != 409 {
		t.Fatalf("stale reveal should return 409, got %d", r.Code)
	}
	reveal := call(http.MethodPost, path+"/reveal", adminToken, `{"revision":1}`)
	if reveal.Code != 200 || !strings.Contains(reveal.Body.String(), id) || !strings.Contains(reveal.Body.String(), secret) ||
		reveal.Header().Get("Cache-Control") != "no-store" || reveal.Header().Get("Referrer-Policy") != "no-referrer" {
		t.Fatalf("explicit audited reveal failed: %d", reveal.Code)
	}
	cleared := call(http.MethodPut, path, adminToken, `{"revision":1,"clear":true}`)
	if cleared.Code != 200 || !strings.Contains(cleared.Body.String(), `"configured":false`) ||
		!strings.Contains(cleared.Body.String(), `"revision":2`) {
		t.Fatalf("clear failed: %d", cleared.Code)
	}
	if r := call(http.MethodPost, path+"/reveal", adminToken, `{"revision":2}`); r.Code != 409 {
		t.Fatalf("cleared secret should not be revealed: %d", r.Code)
	}
	if err := db.Where("name = ?", caddyAliDNSSecretName).First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if len(row.Ciphertext) != 0 || row.Enabled {
		t.Fatal("clear must remove persisted encrypted pair")
	}
	var events []meta.AuditEvent
	if err := db.Order("id ASC").Find(&events).Error; err != nil {
		t.Fatal(err)
	}
	if len(events) != 3 {
		t.Fatalf("expected save, reveal, clear audits; got %d", len(events))
	}
	for _, event := range events {
		raw, _ := json.Marshal(event)
		if bytes.Contains(raw, []byte(id)) || bytes.Contains(raw, []byte(secret)) {
			t.Fatal("audit leaked AliDNS secret")
		}
	}
	// Prove failure of the audit transaction prevents even a new encrypted revision.
	if err := db.Migrator().DropTable(&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	res := call(http.MethodPut, path, adminToken,
		fmt.Sprintf(`{"revision":2,"access_key_id":%q,"access_key_secret":%q}`, id, secret))
	if res.Code != 503 {
		t.Fatalf("unaudited AliDNS save must fail: %d", res.Code)
	}
	if err := db.Where("name = ?", caddyAliDNSSecretName).First(&row).Error; err != nil || row.Revision != 2 || len(row.Ciphertext) != 0 {
		t.Fatalf("credential row changed despite audit failure: revision=%d err=%v", row.Revision, err)
	}
}
