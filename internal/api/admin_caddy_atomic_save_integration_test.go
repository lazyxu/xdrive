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
	"sync"
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

func TestCaddyAtomicDesiredSaveRealPostgres(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	gin.SetMode(gin.TestMode)
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "caddy_atomic_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	if err := db.AutoMigrate(&meta.User{}, &meta.AdminServiceSecret{},
		&meta.AdminCaddyHTTPSSetting{}, &meta.AdminCaddyHTTPSRevision{},
		&meta.AdminCaddyHostApplyReservation{}, &meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	keyring, err := connectorsecret.NewKeyring(1, map[uint32]string{1: strings.Repeat("ac", 32)})
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{DB: db, Auth: auth.New("caddy-atomic-db-test-secret", time.Hour),
		ConnectorSecrets: keyring, HostControlDir: t.TempDir()}
	admin := meta.User{Username: "atomic-admin", PasswordHash: "fixture",
		Role: meta.UserRoleAdmin, SessionVersion: 1}
	member := meta.User{Username: "atomic-member", PasswordHash: "fixture",
		Role: meta.UserRoleUser, SessionVersion: 1}
	for _, u := range []*meta.User{&admin, &member} {
		if err := db.Create(u).Error; err != nil {
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
	route := "/api/v1/admin/services/caddy/config"
	request := func(router http.Handler, method, token, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, route, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		return out
	}
	router := s.Router()
	id, secret := "LTAI8AtomicTestID", "AtomicExampleSecret-1001+/=="
	initial := fmt.Sprintf(`{"https_revision":0,"alidns_revision":0,
        "https":{"enabled":true,"domain":"PHOTOS.EXAMPLE.COM","lan_enabled":true,"lan_ip":"192.168.10.2"},
        "alidns":{"action":"replace","access_key_id":%q,"access_key_secret":%q}}`, id, secret)
	for _, tt := range []struct {
		token  string
		status int
	}{
		{"", http.StatusUnauthorized}, {memberToken, http.StatusForbidden},
	} {
		if got := request(router, http.MethodPut, tt.token, initial); got.Code != tt.status {
			t.Fatalf("auth bypass: HTTP %d, expected %d", got.Code, tt.status)
		}
	}
	for _, bad := range []string{
		`{}`,
		`{"https_revision":0,"alidns_revision":0}`,
		`{"https_revision":0,"alidns_revision":0,"alidns":{"action":"keep"}}`,
		`{"https_revision":0,"alidns_revision":0,"https":{"enabled":false,"domain":"","lan_enabled":false,"lan_ip":""}}`,
		`{"https_revision":0,"alidns_revision":0,"https":{"enabled":true,"domain":"https://bad.example.com","lan_enabled":true,"lan_ip":"192.168.10.2"}}`,
		`{"https_revision":0,"alidns_revision":0,"https":{"enabled":true,"domain":"ok.example.com","lan_enabled":true,"lan_ip":"8.8.8.8"}}`,
		`{"https_revision":0,"alidns_revision":0,"alidns":{"action":"replace","access_key_id":"short","access_key_secret":"short"}}`,
		`{"https_revision":0,"alidns_revision":0,"unexpected":true,"https":{"enabled":true,"domain":"ok.example.com","lan_enabled":false,"lan_ip":""}}`,
	} {
		if got := request(router, http.MethodPut, adminToken, bad); got.Code != http.StatusBadRequest {
			t.Fatalf("bad request admitted: HTTP %d for %s", got.Code, bad)
		}
	}

	first := request(router, http.MethodPut, adminToken, initial)
	if first.Code != http.StatusOK || !strings.Contains(first.Body.String(), `"https_revision":1`) ||
		!strings.Contains(first.Body.String(), `"alidns_revision":1`) ||
		strings.Contains(first.Body.String(), id) || strings.Contains(first.Body.String(), secret) ||
		!strings.Contains(first.Body.String(), `"apply_supported":false`) ||
		!strings.Contains(first.Body.String(), `"host_applied":false`) {
		t.Fatalf("atomic first save or redaction failed: HTTP %d: %s", first.Code, first.Body.String())
	}
	if first.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("private response cacheable")
	}

	readSaved := func() (meta.AdminCaddyHTTPSSetting, meta.AdminServiceSecret) {
		t.Helper()
		var h meta.AdminCaddyHTTPSSetting
		var a meta.AdminServiceSecret
		if err := db.Where("name = ?", caddyHTTPSSettingName).Take(&h).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Where("name = ?", caddyAliDNSSecretName).Take(&a).Error; err != nil {
			t.Fatal(err)
		}
		return h, a
	}
	https, alidns := readSaved()
	if https.Revision != 1 || https.Domain != "photos.example.com" ||
		!https.Enabled || !https.LANEnabled || https.LANIP != "192.168.10.2" ||
		alidns.Revision != 1 || !alidns.Enabled || alidns.KeyVersion == 0 ||
		len(alidns.Ciphertext) == 0 || bytes.Contains(alidns.Ciphertext, []byte(secret)) {
		t.Fatal("partial save or unencrypted credentials detected")
	}
	plain, err := keyring.Open(caddyAliDNSSecretAADID, caddyAliDNSSecretKind, alidns.KeyVersion, alidns.Ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	var pair caddyAliDNSSecretPair
	decodeErr := json.Unmarshal(plain, &pair)
	clear(plain)
	if decodeErr != nil || pair.AccessKeyID != id || pair.AccessKeySecret != secret {
		t.Fatal("Caddy AliDNS AAD or ciphertext does not match")
	}
	var originalHistory meta.AdminCaddyHTTPSRevision
	if err := db.Where("name = ? AND revision = ?", caddyHTTPSSettingName, 1).
		Take(&originalHistory).Error; err != nil || originalHistory.Domain != "photos.example.com" {
		t.Fatalf("immutable HTTPS desired history unavailable: %v", err)
	}

	// Any stale revision rejects the ENTIRE pair, even when just one group
	// changes. Failed operations must not rotate the ciphertext or add history.
	stale := fmt.Sprintf(`{"https_revision":0,"alidns_revision":1,
        "https":{"enabled":true,"domain":"wrong.example.com","lan_enabled":true,"lan_ip":"192.168.10.2"},
        "alidns":{"action":"replace","access_key_id":%q,"access_key_secret":%q}}`, id, "DifferentSampleSecret87654")
	if got := request(router, http.MethodPut, adminToken, stale); got.Code != http.StatusConflict {
		t.Fatalf("stale HTTPS did not fail entire transaction: %d", got.Code)
	}
	if got := request(router, http.MethodPut, adminToken,
		`{"https_revision":1,"alidns_revision":0,"https":{"enabled":true,"domain":"wrong.example.com","lan_enabled":true,"lan_ip":"192.168.10.2"}}`); got.Code != http.StatusConflict {
		t.Fatalf("stale AliDNS did not fail entire transaction: %d", got.Code)
	}
	h2, a2 := readSaved()
	if h2.Revision != 1 || a2.Revision != 1 || !bytes.Equal(alidns.Ciphertext, a2.Ciphertext) {
		t.Fatal("stale operation partially persisted")
	}

	// A credential-only clear leaves the HTTPS revision intact.
	cleared := request(router, http.MethodPut, adminToken,
		`{"https_revision":1,"alidns_revision":1,"alidns":{"action":"clear"}}`)
	if cleared.Code != http.StatusOK {
		t.Fatalf("credential-only clear: %d: %s", cleared.Code, cleared.Body.String())
	}
	h3, a3 := readSaved()
	if h3.Revision != 1 || a3.Revision != 2 || a3.Enabled || len(a3.Ciphertext) != 0 || a3.KeyVersion != 0 {
		t.Fatal("clear changed HTTPS or retained credential bytes")
	}
	if r := request(router, http.MethodPut, adminToken,
		`{"https_revision":1,"alidns_revision":2,"alidns":{"action":"clear"}}`); r.Code != http.StatusConflict {
		t.Fatalf("duplicate clear did not reject: %d", r.Code)
	}

	// Two independently configured API replicas compete for one CAS commit.
	db2, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	s2 := &Server{DB: db2, Auth: auth.New("caddy-atomic-db-test-secret", time.Hour),
		ConnectorSecrets: keyring, HostControlDir: t.TempDir()}
	router2 := s2.Router()
	var wg sync.WaitGroup
	results := make(chan int, 2)
	for _, item := range []struct {
		handler http.Handler
		name    string
	}{
		{router, "a.example.com"}, {router2, "b.example.com"},
	} {
		wg.Add(1)
		go func(handler http.Handler, name string) {
			defer wg.Done()
			body := fmt.Sprintf(`{"https_revision":1,"alidns_revision":2,
                "https":{"enabled":true,"domain":%q,"lan_enabled":true,"lan_ip":"192.168.10.2"}}`, name)
			results <- request(handler, http.MethodPut, adminToken, body).Code
		}(item.handler, item.name)
	}
	wg.Wait()
	close(results)
	okCount, conflictCount := 0, 0
	for status := range results {
		if status == http.StatusOK {
			okCount++
		}
		if status == http.StatusConflict {
			conflictCount++
		}
	}
	if okCount != 1 || conflictCount != 1 {
		t.Fatalf("cross-replica CAS must allow exactly one success: %d / %d", okCount, conflictCount)
	}
	h4, a4 := readSaved()
	if h4.Revision != 2 || a4.Revision != 2 {
		t.Fatal("cross-replica revisions not atomic")
	}

	// Host Pending fences *every* administrator mutation with unchanged data.
	fingerprint := strings.Repeat("a", 64)
	if err := db.Create(&meta.AdminCaddyHostApplyReservation{
		Name: caddyHostDBReservationName, HTTPSRevision: 2, CredentialRevision: 2,
		OperationSHA256: fingerprint, NonceSHA256: fingerprint,
		IntentSHA256: fingerprint, PlanSHA256: fingerprint,
		CandidateEnvironmentSHA256: fingerprint, State: "pending-unapplied",
		CreatedAt: time.Now().UTC(),
	}).Error; err != nil {
		t.Fatal(err)
	}
	next := fmt.Sprintf(`{"https_revision":2,"alidns_revision":2,
        "https":{"enabled":true,"domain":%q,"lan_enabled":true,"lan_ip":"192.168.10.2"}}`, "blocked.example.com")
	if r := request(router, http.MethodPut, adminToken, next); r.Code != http.StatusConflict {
		t.Fatalf("Host pending save bypassed: %d", r.Code)
	}
	h5, a5 := readSaved()
	if h5.Revision != 2 || a5.Revision != 2 {
		t.Fatal("Host pending modified revisions")
	}
	if err := db.Where("name = ?", caddyHostDBReservationName).
		Delete(&meta.AdminCaddyHostApplyReservation{}).Error; err != nil {
		t.Fatal(err)
	}

	// An audit write failure must roll back both new versions, not merely
	// return HTTP 503 after committing one of the groups.
	if err := db.Migrator().DropTable(&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	doomed := fmt.Sprintf(`{"https_revision":2,"alidns_revision":2,
        "https":{"enabled":true,"domain":"audit-fail.example.com","lan_enabled":true,"lan_ip":"192.168.10.2"},
        "alidns":{"action":"replace","access_key_id":%q,"access_key_secret":%q}}`, id, secret)
	if r := request(router, http.MethodPut, adminToken, doomed); r.Code != http.StatusServiceUnavailable {
		t.Fatalf("missing audit should fail closed: %d", r.Code)
	}
	h6, a6 := readSaved()
	if h6.Revision != 2 || a6.Revision != 2 ||
		!bytes.Equal(a4.Ciphertext, a6.Ciphertext) {
		t.Fatal("audit failure partially committed HTTPS or AliDNS")
	}
}
