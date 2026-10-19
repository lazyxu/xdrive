package api

import (
	"bytes"
	"context"
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

// No production network is accessed. A real HTTP client is injected only as
// the controlled seam to check the exact upstream, size/MIME and AK leakage.
func TestBaiduJSAPI4ManualFixedLoaderOnlyNoRelease(t *testing.T) {
	ak := "private-browser-ak-fixture-a3d1"
	for _, tc := range []struct {
		name, mime, body, encoding, want string
		code                             int
	}{
		{"fixed valid loader", "application/javascript", "window.BMap = function () {};", "", "loader_accepted", 200},
		{"AK leaked in JS", "application/javascript", "window.BMap='" + ak + "';", "", "unavailable", 200},
		{"JSON not a loader", "application/json", "{}", "", "unavailable", 200},
		{"explicitly rejected", "application/json", "{}", "", "denied", 403},
		{"redirect to untrusted", "text/plain", "redirect", "", "unavailable", 302},
		{"compressed", "application/javascript", "function f() {}", "gzip", "unavailable", 200},
		{"oversized", "application/javascript", strings.Repeat("x", (2<<20)+1), "", "unavailable", 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			client := &http.Client{Transport: baiduMapRoundTripFunc(func(req *http.Request) (*http.Response, error) {
				calls++
				if req.Method != http.MethodGet || req.URL.Scheme != "https" ||
					req.URL.Host != "api.map.baidu.com" || req.URL.EscapedPath() != "/api" ||
					req.URL.Query().Get("v") != "4.0" || req.URL.Query().Get("ak") != ak ||
					len(req.URL.Query()) != 2 ||
					req.Header.Get("BMAP_PROXY_URL") != "https://gallery.example.invalid/_BMapService/" ||
					req.Header.Get("Referer") != "https://gallery.example.invalid/" ||
					req.Header.Get("Accept-Encoding") != "identity" ||
					req.Header.Get("Authorization") != "" || req.Header.Get("Cookie") != "" {
					t.Fatal("unexpected Loader request or missing credential isolation")
				}
				return &http.Response{StatusCode: tc.code,
					Header: http.Header{
						"Content-Type":     []string{tc.mime},
						"Content-Encoding": []string{tc.encoding},
					},
					Body: io.NopCloser(strings.NewReader(tc.body)),
				}, nil
			})}
			got := checkFixedBaiduJSAPI4Loader(context.Background(),
				"https://gallery.example.invalid", ak, client)
			if got != tc.want || calls != 1 {
				t.Fatalf("Loader outcome incorrect; state=%s calls=%d", got, calls)
			}
		})
	}
	calls := 0
	client := &http.Client{Transport: baiduMapRoundTripFunc(func(_ *http.Request) (*http.Response, error) {
		calls++
		return nil, context.Canceled
	})}
	for _, bad := range []string{
		"", "http://gallery.example.invalid", "https://evil.example.invalid/path",
		"https://gallery.example.invalid?u=1",
	} {
		if got := checkFixedBaiduJSAPI4Loader(context.Background(), bad, ak, client); got != "unavailable" {
			t.Fatal("untrusted origin unexpectedly accepted")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if got := checkFixedBaiduJSAPI4Loader(ctx, "https://gallery.example.invalid", ak, client); got != "unavailable" || calls != 0 {
		t.Fatal("cancelled probe reached Baidu")
	}
}

func TestBaiduJSAPI4ProbeRequiresAuditAndAdminOnly(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := &Server{AllowedOrigin: "https://gallery.example.invalid"}
	r := s.Router()
	for _, payload := range []string{`{"revision":1}`, `{"revision":0}`, `{"revision":999999999999999999999}`} {
		out := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost,
			"/api/v1/admin/services/baidu-jsapi/verify-loader", strings.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		r.ServeHTTP(out, req)
		if out.Code != http.StatusUnauthorized || strings.Contains(out.Body.String(), "ak") {
			t.Fatalf("non-admin probe allowed or leaked response: %d", out.Code)
		}
	}
}

func TestBaiduJSAPI4AdminLoaderProbeRealPostgresRevisionAndAudit(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("requires real PostgreSQL XD_TEST_DATABASE_URL")
	}
	gin.SetMode(gin.TestMode)
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "jsapi_loader_probe_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	if err := db.AutoMigrate(&meta.User{}, &meta.AdminServiceSecret{}, &meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	ring, err := connectorsecret.NewKeyring(1, map[uint32]string{1: strings.Repeat("ab", 32)})
	if err != nil {
		t.Fatal(err)
	}
	secret := "independent-browser-ak-loader-probe"
	s := &Server{
		DB: db, Auth: auth.New("a3d1-test-session-auth", time.Hour),
		ConnectorSecrets: ring, AllowedOrigin: "https://gallery.example.invalid",
		BaiduMapAK: "static-server-ak-should-never-leak",
	}
	clientCalls := 0
	s.BaiduJSAPIProbeHTTPClient = &http.Client{Transport: baiduMapRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		clientCalls++
		if req.URL.Host != "api.map.baidu.com" || req.URL.Path != "/api" ||
			req.URL.Query().Get("ak") != secret || req.URL.Query().Get("v") != "4.0" ||
			req.Header.Get("BMAP_PROXY_URL") != "https://gallery.example.invalid/_BMapService/" ||
			req.Header.Get("Referer") != "https://gallery.example.invalid/" {
			t.Fatal("Browser AK Loader audit probe did not use fixed upstream")
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"application/javascript"}},
			Body:       io.NopCloser(bytes.NewReader([]byte("window.BMap = {};"))),
		}, nil
	})}
	admin := meta.User{Username: "probe-admin", PasswordHash: "none", Role: meta.UserRoleAdmin, SessionVersion: 1}
	member := meta.User{Username: "probe-user", PasswordHash: "none", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&member).Error; err != nil {
		t.Fatal(err)
	}
	adminToken, err := s.Auth.Issue(admin.ID, admin.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	memberToken, err := s.Auth.Issue(member.ID, member.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	router := s.Router()
	call := func(method, path, token, body string) *httptest.ResponseRecorder {
		t.Helper()
		out := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		router.ServeHTTP(out, req)
		return out
	}
	adminURI := "/api/v1/admin/services/baidu-jsapi"
	probeURI := adminURI + "/verify-loader"
	for _, token := range []string{"", memberToken} {
		res := call(http.MethodPost, probeURI, token, `{"revision":1}`)
		want := http.StatusUnauthorized
		if token != "" {
			want = http.StatusForbidden
		}
		if res.Code != want || clientCalls != 0 {
			t.Fatal("unauthorized probe called external provider")
		}
	}
	configured := call(http.MethodPut, adminURI, adminToken,
		`{"desired_enabled":true,"revision":0,"browser_ak":"`+secret+`"}`)
	if configured.Code != http.StatusOK {
		t.Fatal("unable to store encrypted test Browser AK")
	}
	badRevision := call(http.MethodPost, probeURI, adminToken, `{"revision":0}`)
	if badRevision.Code != http.StatusBadRequest || clientCalls != 0 {
		t.Fatal("stale or zero revision reached provider")
	}
	badRevision = call(http.MethodPost, probeURI, adminToken, `{"revision":2}`)
	if badRevision.Code != http.StatusConflict || clientCalls != 0 {
		t.Fatal("non-current revision reached provider")
	}
	verified := call(http.MethodPost, probeURI, adminToken, `{"revision":1}`)
	if verified.Code != http.StatusOK || clientCalls != 1 ||
		!strings.Contains(verified.Body.String(), `"state":"loader_accepted"`) ||
		!strings.Contains(verified.Body.String(), `"loader_accepted":true`) ||
		!strings.Contains(verified.Body.String(), `"runtime_enabled":false`) ||
		strings.Contains(verified.Body.String(), secret) ||
		strings.Contains(verified.Body.String(), s.BaiduMapAK) {
		t.Fatal("manual Browser AK probe falsely authorized runtime or leaked secrets")
	}
	if verified.Header().Get("Cache-Control") != "no-store" ||
		verified.Header().Get("Referrer-Policy") != "no-referrer" {
		t.Fatal("private probe result is cacheable or includes referrer")
	}
	blocked := call(http.MethodPost, probeURI, adminToken, `{"revision":1}`)
	if blocked.Code != http.StatusTooManyRequests || clientCalls != 1 {
		t.Fatal("duplicate manual Loader probe bypassed rate limit")
	}
	status := call(http.MethodGet, "/api/v1/media/places/baidu-jsapi/status", memberToken, "")
	if status.Code != http.StatusOK || !strings.Contains(status.Body.String(), `"enabled":false`) {
		t.Fatal("Loader canary mistakenly activated JSAPI4")
	}
	var auditCount int64
	if err := db.Model(&meta.AuditEvent{}).
		Where("action = ?", "admin.service.baidu_jsapi.verify_loader").Count(&auditCount).Error; err != nil || auditCount != 1 {
		t.Fatal("expected exactly one metadata-only committed admin Loader attempt audit")
	}
}
