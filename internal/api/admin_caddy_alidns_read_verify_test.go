package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
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

type caddyDNSProbeRoundTripper func(*http.Request) (*http.Response, error)

func (f caddyDNSProbeRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestCaddyAliDNSACS3SignedReadRequestVector(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, "https://dns.aliyuncs.com/?SubDomain=photos.example.com&PageSize=1&PageNumber=1", nil)
	if err != nil {
		t.Fatal(err)
	}
	signCaddyAliDNSACS3(req, caddyAliDNSSecretPair{AccessKeyID: "LTAIexampleKey", AccessKeySecret: "SampleAliDNSSecret123"},
		time.Date(2023, 10, 26, 10, 22, 32, 0, time.UTC), "3156853299f313e23d1673dc12e1703d")
	if req.URL.RawQuery != "PageNumber=1&PageSize=1&SubDomain=photos.example.com" {
		t.Fatalf("canonical query wrong: %s", req.URL.RawQuery)
	}
	const signature = "1edcc377408ca4f3ac0a0942dc209042d5e73ae31399fa228a32f3fc9cdcf353"
	if !strings.HasSuffix(req.Header.Get("Authorization"), "Signature="+signature) ||
		req.Header.Get("x-acs-action") != "DescribeSubDomainRecords" {
		t.Fatal("ACS3 HMAC signature does not match independent reference vector")
	}
}

func TestCaddyAliDNSReadProbeResponseFailsClosed(t *testing.T) {
	s := &Server{}
	pair := caddyAliDNSSecretPair{AccessKeyID: "LTAITest1234", AccessKeySecret: "TestSecret1234"}
	for _, tc := range []struct {
		status int
		body   string
		want   string
	}{
		{200, `{"RequestId":"id","TotalCount":0}`, "read_authorized"},
		{200, `{"RequestId":"id","TotalCount":0,"Code":"Forbidden.RAM"}`, "denied"},
		{200, `{"RequestId":"id"}`, "unavailable"},
		{200, "not-json", "unavailable"},
		{200, strings.Repeat("x", caddyAliDNSMaxResponse+1), "unavailable"},
		{500, "broken", "unavailable"},
		{302, "", "unavailable"},
	} {
		s.CaddyAliDNSProbeTransport = caddyDNSProbeRoundTripper(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: tc.status, Body: io.NopCloser(strings.NewReader(tc.body))}, nil
		})
		if got := s.caddyAliDNSReadProbe(context.Background(), pair, "photos.example.com"); got != tc.want {
			t.Fatalf("HTTP %d body length %d: got %s want %s", tc.status, len(tc.body), got, tc.want)
		}
	}
}

func TestAdminCaddyAliDNSLiveReadPermissionAdminAndRevision(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL missing")
	}
	gin.SetMode(gin.TestMode)
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "caddy_read_probe_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	if err := db.AutoMigrate(&meta.User{}, &meta.AuditEvent{}, &meta.AdminServiceSecret{},
		&meta.AdminCaddyHTTPSSetting{}, &meta.AdminCaddyHTTPSRevision{}); err != nil {
		t.Fatal(err)
	}
	ring, err := connectorsecret.NewKeyring(1, map[uint32]string{1: strings.Repeat("ae", 32)})
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{DB: db, Auth: auth.New("caddy-read-probe-secret", time.Hour), ConnectorSecrets: ring}
	admin := meta.User{Username: "caddy-probe-admin", PasswordHash: "test", Role: meta.UserRoleAdmin, SessionVersion: 1}
	user := meta.User{Username: "caddy-probe-member", PasswordHash: "test", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	adminToken, err := s.Auth.Issue(admin.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	userToken, err := s.Auth.Issue(user.ID, 1)
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
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	const path = "/api/v1/admin/services/caddy/alidns/verify-read"
	input := `{"desired_revision":1,"credential_revision":1}`
	for _, v := range []struct {
		token string
		want  int
	}{{"", 401}, {userToken, 403}} {
		if r := call("POST", path, v.token, input); r.Code != v.want {
			t.Fatalf("nonadmin %d", r.Code)
		}
	}
	if r := call("POST", path, adminToken, input); r.Code != 409 {
		t.Fatalf("missing intent allowed: %d", r.Code)
	}
	if r := call("POST", path, adminToken, `{"desired_revision":0,"credential_revision":1}`); r.Code != 400 {
		t.Fatalf("invalid revision %d", r.Code)
	}
	if r := call("PUT", "/api/v1/admin/services/caddy/https", adminToken,
		`{"revision":0,"enabled":true,"domain":"PHOTOS.EXAMPLE.COM"}`); r.Code != 200 {
		t.Fatalf("save intent %d", r.Code)
	}
	const id = "LTAI-AliDNS-TestCredential"
	const secret = "READ-Probe-TestSecret-abcdef123456"
	if r := call("PUT", "/api/v1/admin/services/caddy/alidns", adminToken,
		`{"revision":0,"access_key_id":"`+id+`","access_key_secret":"`+secret+`"}`); r.Code != 200 {
		t.Fatalf("save secret %d", r.Code)
	}
	var before int64
	if err := db.Model(&meta.AuditEvent{}).Count(&before).Error; err != nil {
		t.Fatal(err)
	}
	calls := 0
	s.CaddyAliDNSProbeTransport = caddyDNSProbeRoundTripper(func(req *http.Request) (*http.Response, error) {
		calls++
		if req.URL.Scheme != "https" || req.URL.Host != "dns.aliyuncs.com" || req.Method != "GET" ||
			req.URL.Query().Get("SubDomain") != "photos.example.com" ||
			req.URL.Query().Get("PageNumber") != "1" || req.URL.Query().Get("PageSize") != "1" ||
			req.Header.Get("x-acs-action") != "DescribeSubDomainRecords" ||
			!strings.HasPrefix(req.Header.Get("Authorization"), "ACS3-HMAC-SHA256 Credential="+id+",") ||
			strings.Contains(req.URL.String(), id) || strings.Contains(req.URL.String(), secret) {
			t.Fatal("signed read probe attempted unsafe endpoint/action or leaked a credential")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"RequestId":"test-id","TotalCount":0}`))}, nil
	})
	res := call("POST", path, adminToken, input)
	if res.Code != 200 {
		t.Fatalf("read verification %d %s", res.Code, res.Body.String())
	}
	var dto adminCaddyAliDNSReadProbeDTO
	if err := json.Unmarshal(res.Body.Bytes(), &dto); err != nil {
		t.Fatal(err)
	}
	if dto.State != "read_authorized" || !dto.ReadPermissionVerified ||
		dto.WritePermissionVerified || dto.ApplySupported || dto.PublicHTTPSVerified || calls != 1 {
		t.Fatalf("read verification fabricated write or HTTPS authority: %+v", dto)
	}
	if bytes.Contains(res.Body.Bytes(), []byte(id)) || bytes.Contains(res.Body.Bytes(), []byte(secret)) ||
		bytes.Contains(res.Body.Bytes(), []byte("photos.example.com")) || res.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("read verification response revealed a secret or FQDN")
	}
	var after int64
	if err := db.Model(&meta.AuditEvent{}).Count(&after).Error; err != nil {
		t.Fatal(err)
	}
	if after != before+1 {
		t.Fatalf("outbound request not audited: %d -> %d", before, after)
	}
	if r := call("POST", path, adminToken, input); r.Code != 429 || calls != 1 {
		t.Fatalf("rate limit %d calls %d", r.Code, calls)
	}
	s.caddyAliDNSProbeAt = time.Time{}
	s.CaddyAliDNSProbeTransport = caddyDNSProbeRoundTripper(func(*http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 403, Body: io.NopCloser(strings.NewReader("PRIVATE error from cloud"))}, nil
	})
	res = call("POST", path, adminToken, input)
	if res.Code != 200 || !bytes.Contains(res.Body.Bytes(), []byte(`"state":"denied"`)) ||
		bytes.Contains(res.Body.Bytes(), []byte("PRIVATE error from cloud")) {
		t.Fatalf("raw cloud error leaked: %d", res.Code)
	}
	s.caddyAliDNSProbeAt = time.Time{}
	s.CaddyAliDNSProbeTransport = caddyDNSProbeRoundTripper(func(*http.Request) (*http.Response, error) {
		calls++
		if err := db.Model(&meta.AdminServiceSecret{}).Where("name = ?", caddyAliDNSSecretName).
			Update("revision", gorm.Expr("revision + 1")).Error; err != nil {
			t.Fatal(err)
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"RequestId":"test-id","TotalCount":0}`))}, nil
	})
	if r := call("POST", path, adminToken, input); r.Code != 409 {
		t.Fatalf("stale probe wrongly accepted %d", r.Code)
	}
	s.caddyAliDNSProbeAt = time.Time{}
	if r := call("POST", path, adminToken, input); r.Code != 409 {
		t.Fatalf("old revision allowed %d", r.Code)
	}
	var events []meta.AuditEvent
	if err := db.Find(&events).Error; err != nil {
		t.Fatal(err)
	}
	for _, event := range events {
		encoded, _ := json.Marshal(event)
		for _, v := range []string{id, secret, "photos.example.com"} {
			if bytes.Contains(encoded, []byte(v)) {
				t.Fatal("audit exposed secret or hostname")
			}
		}
	}
	// An unavailable audit journal must stop the signed cloud request before dispatch.
	s.caddyAliDNSProbeAt = time.Time{}
	if err := db.Migrator().DropTable(&meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	beforeFailureCalls := calls
	s.CaddyAliDNSProbeTransport = caddyDNSProbeRoundTripper(func(*http.Request) (*http.Response, error) {
		calls++
		t.Fatal("AliDNS request escaped when the required audit was unavailable")
		return nil, nil
	})
	if response := call("POST", path, adminToken, `{"desired_revision":1,"credential_revision":2}`); response.Code != http.StatusServiceUnavailable || calls != beforeFailureCalls {
		t.Fatalf("unaudited cloud probe unexpectedly dispatched HTTP %d calls %d", response.Code, calls)
	}

}
