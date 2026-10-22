package api

import (
	"context"
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

func TestBaiduJSAPISeparateBrowserAKEncryptedAndAdminScoped(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	gin.SetMode(gin.TestMode)
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "admin_jsapi_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()
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
	if err := db.AutoMigrate(&meta.User{}, &meta.AdminServiceSecret{}, &meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	keyring, err := connectorsecret.NewKeyring(1, map[uint32]string{1: strings.Repeat("ab", 32)})
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{DB: db, Auth: auth.New("jsapi-owner-auth-secret", time.Hour), ConnectorSecrets: keyring, BaiduMapEnabled: true, BaiduMapAK: "keep-static-server-ak"}
	router := server.Router()
	admin := meta.User{Username: "jsapi-admin", PasswordHash: "unused", Role: meta.UserRoleAdmin, SessionVersion: 1}
	member := meta.User{Username: "jsapi-user", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
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
	userToken, err := server.Auth.Issue(member.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	request := func(method, endpoint, token, body string) *httptest.ResponseRecorder {
		t.Helper()
		response := httptest.NewRecorder()
		req := httptest.NewRequest(method, endpoint, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		router.ServeHTTP(response, req)
		return response
	}
	adminEndpoint := "/api/v1/admin/services/baidu-jsapi"
	ownerEndpoint := "/api/v1/media/places/baidu-jsapi/status"
	payload := `{"desired_enabled":true,"browser_ak":"private-browser-ak-v4","revision":0}`
	if r := request(http.MethodGet, adminEndpoint, "", ""); r.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous admin GET %d", r.Code)
	}
	if r := request(http.MethodPut, adminEndpoint, userToken, payload); r.Code != http.StatusForbidden {
		t.Fatalf("ordinary member admin PUT %d", r.Code)
	}
	if r := request(http.MethodGet, adminEndpoint, userToken, ""); r.Code != http.StatusForbidden {
		t.Fatalf("ordinary member admin GET %d", r.Code)
	}
	if r := request(http.MethodGet, ownerEndpoint, "", ""); r.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous status %d", r.Code)
	}
	public := request(http.MethodGet, ownerEndpoint, userToken, "")
	if public.Code != http.StatusOK || !strings.Contains(public.Body.String(), `"enabled":false`) ||
		strings.Contains(public.Body.String(), "keep-static-server-ak") {
		t.Fatalf("status must fail closed without Browser AK exposure: %d %s", public.Code, public.Body.String())
	}
	if r := request(http.MethodPut, adminEndpoint, adminToken, `{"desired_enabled":true,"revision":0}`); r.Code != http.StatusBadRequest {
		t.Fatalf("desired enable without Browser AK %d", r.Code)
	}
	created := request(http.MethodPut, adminEndpoint, adminToken, payload)
	if created.Code != http.StatusOK ||
		!strings.Contains(created.Body.String(), `"desired_enabled":true`) ||
		!strings.Contains(created.Body.String(), `"configured":true`) ||
		!strings.Contains(created.Body.String(), `"runtime_enabled":false`) ||
		created.Header().Get("Cache-Control") != "no-store" ||
		strings.Contains(created.Body.String(), "private-browser-ak-v4") {
		t.Fatalf("admin intent did not remain fail closed: %d %s", created.Code, created.Body.String())
	}
	var row meta.AdminServiceSecret
	if err := db.Where("name = ?", baiduJSAPISecretName).Take(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.Name != baiduJSAPISecretName || row.Revision != 1 ||
		len(row.Ciphertext) == 0 || strings.Contains(string(row.Ciphertext), "private-browser-ak-v4") {
		t.Fatal("Browser AK was not independently encrypted")
	}
	plaintext, err := keyring.Open(baiduJSAPISecretAADID, baiduJSAPISecretKind, row.KeyVersion, row.Ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	if string(plaintext) != "private-browser-ak-v4" {
		t.Fatal("decrypted Browser AK mismatch")
	}
	clear(plaintext)
	if static, err := server.effectiveBaiduMapConfig(context.Background()); err != nil ||
		static.AK != "keep-static-server-ak" {
		t.Fatal("JSAPI Browser AK altered existing static Server AK")
	}
	if stale := request(http.MethodPut, adminEndpoint, adminToken, payload); stale.Code != http.StatusConflict {
		t.Fatalf("stale Browser AK revision accepted %d", stale.Code)
	}
	// Reveal is an explicit POST only. A saved revision, administrative
	// authorization, successful audit and no-store are all required.
	revealEndpoint := adminEndpoint + "/reveal"
	for _, tc := range []struct {
		token  string
		status int
	}{
		{"", http.StatusUnauthorized}, {userToken, http.StatusForbidden},
	} {
		response := request(http.MethodPost, revealEndpoint, tc.token, `{"revision":1}`)
		if response.Code != tc.status || strings.Contains(response.Body.String(), "private-browser-ak-v4") {
			t.Fatalf("unauthorized Browser AK reveal status=%d", response.Code)
		}
	}
	if r := request(http.MethodGet, revealEndpoint, adminToken, ""); r.Code == http.StatusOK {
		t.Fatal("Browser AK accessible via GET")
	}
	for _, body := range []string{
		`{"revision":0}`, `{"revision":2}`, `{"revision":1,"extra":true}`,
		`{"revision":1}{"revision":1}`, `{"revision":"1"}`,
	} {
		if r := request(http.MethodPost, revealEndpoint, adminToken, body); r.Code == http.StatusOK {
			t.Fatal("accepted invalid Browser AK reveal input")
		}
	}
	revealed := request(http.MethodPost, revealEndpoint, adminToken, `{"revision":1}`)
	if revealed.Code != http.StatusOK ||
		!strings.Contains(revealed.Body.String(), `"field":"browser_ak"`) ||
		!strings.Contains(revealed.Body.String(), `"value":"private-browser-ak-v4"`) ||
		!strings.Contains(revealed.Body.String(), `"revision":1`) ||
		!strings.Contains(revealed.Body.String(), `"expires_in_seconds":30`) ||
		revealed.Header().Get("Cache-Control") != "no-store" ||
		revealed.Header().Get("Referrer-Policy") != "no-referrer" {
		t.Fatalf("Browser AK explicit reveal failed: %d", revealed.Code)
	}
	var audits []meta.AuditEvent
	if err := db.Find(&audits).Error; err != nil {
		t.Fatal(err)
	}
	foundReveal := false
	for _, event := range audits {
		serialized, err := json.Marshal(event)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(serialized), "private-browser-ak-v4") {
			t.Fatal("Browser AK leaked into audit")
		}
		if strings.Contains(string(serialized), "admin.service.baidu_jsapi.reveal") {
			foundReveal = true
		}
	}
	if !foundReveal {
		t.Fatal("explicit Browser AK reveal was not audited")
	}
	cleared := request(http.MethodPut, adminEndpoint, adminToken,
		`{"desired_enabled":false,"clear_ak":true,"revision":1}`)
	if cleared.Code != http.StatusOK ||
		!strings.Contains(cleared.Body.String(), `"configured":false`) ||
		!strings.Contains(cleared.Body.String(), `"runtime_enabled":false`) {
		t.Fatalf("disable/clear must be safe: %d %s", cleared.Code, cleared.Body.String())
	}
	if err := db.Where("name = ?", baiduJSAPISecretName).Take(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.Revision != 2 || len(row.Ciphertext) != 0 || row.Enabled {
		t.Fatal("cleared Browser AK remains usable or stale")
	}
}
