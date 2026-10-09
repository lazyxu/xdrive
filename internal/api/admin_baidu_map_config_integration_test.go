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

func TestAdminBaiduAKEncryptedHotReloadAndAccessControl(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	gin.SetMode(gin.TestMode)
	base, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "admin_baidu_map_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := base.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = base.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()

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
	if err := db.AutoMigrate(&meta.User{}, &meta.AdminServiceSecret{}, &meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}

	ring, err := connectorsecret.NewKeyring(1, map[uint32]string{1: strings.Repeat("ab", 32)})
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		DB: db, Auth: auth.New("baidu-map-access-secret", time.Hour),
		ConnectorSecrets: ring, BaiduMapEnabled: true, BaiduMapAK: "environment-original-ak",
	}
	router := server.Router()
	admin := meta.User{Username: "map-admin", PasswordHash: "test", Role: meta.UserRoleAdmin, SessionVersion: 1}
	member := meta.User{Username: "map-user", PasswordHash: "test", Role: meta.UserRoleUser, SessionVersion: 1}
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
	request := func(method, path, token, body string) *httptest.ResponseRecorder {
		t.Helper()
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		router.ServeHTTP(rec, req)
		return rec
	}

	endpoint := "/api/v1/admin/services/baidu-map"
	revealEndpoint := endpoint + "/reveal"
	for _, tc := range []struct {
		token string
		want  int
	}{
		{"", http.StatusUnauthorized},
		{memberToken, http.StatusForbidden},
	} {
		for _, method := range []string{http.MethodGet, http.MethodPut} {
			rec := request(method, endpoint, tc.token, `{"enabled":true,"ak":"not-allowed","revision":0}`)
			if rec.Code != tc.want {
				t.Fatalf("nonadmin method=%s status=%d, want %d", method, rec.Code, tc.want)
			}
		}
		rec := request(http.MethodPost, revealEndpoint, tc.token, `{"revision":0}`)
		if rec.Code != tc.want {
			t.Fatalf("nonadmin reveal status=%d, want %d", rec.Code, tc.want)
		}
	}

	initial := request(http.MethodGet, endpoint, adminToken, "")
	if initial.Code != http.StatusOK ||
		!strings.Contains(initial.Body.String(), `"source":"environment"`) ||
		strings.Contains(initial.Body.String(), "environment-original-ak") {
		t.Fatalf("unsafe initial response: %d %s", initial.Code, initial.Body.String())
	}

	envReveal := request(http.MethodPost, revealEndpoint, adminToken, `{"revision":0}`)
	if envReveal.Code != http.StatusOK ||
		!strings.Contains(envReveal.Body.String(), `"field":"ak"`) ||
		!strings.Contains(envReveal.Body.String(), `"value":"environment-original-ak"`) ||
		!strings.Contains(envReveal.Body.String(), `"expires_in_seconds":30`) ||
		envReveal.Header().Get("Cache-Control") != "no-store" ||
		envReveal.Header().Get("Pragma") != "no-cache" {
		t.Fatalf("admin-only environment AK reveal failed: %d %s", envReveal.Code, envReveal.Body.String())
	}

	firstAK := "test-baidu-ak-replaced-001"
	updated := request(http.MethodPut, endpoint, adminToken,
		`{"enabled":true,"revision":0,"ak":"`+firstAK+`"}`)
	if updated.Code != http.StatusOK || strings.Contains(updated.Body.String(), firstAK) ||
		!strings.Contains(updated.Body.String(), `"requires_restart":false`) ||
		!strings.Contains(updated.Body.String(), `"revision":1`) {
		t.Fatalf("bad save response: %d %s", updated.Code, updated.Body.String())
	}
	revealed := request(http.MethodPost, revealEndpoint, adminToken, `{"revision":1}`)
	if revealed.Code != http.StatusOK || !strings.Contains(revealed.Body.String(), firstAK) ||
		revealed.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("saved AK reveal failed: HTTP %d %s", revealed.Code, revealed.Body.String())
	}
	staleReveal := request(http.MethodPost, revealEndpoint, adminToken, `{"revision":0}`)
	if staleReveal.Code != http.StatusConflict {
		t.Fatalf("stale reveal revision should fail, got %d", staleReveal.Code)
	}

	var row meta.AdminServiceSecret
	if err := db.Where("name = ?", baiduMapSecretName).First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(row.Ciphertext, []byte(firstAK)) || len(row.Ciphertext) == 0 || row.KeyVersion != 1 {
		t.Fatal("map AK must be persisted only as authenticated ciphertext")
	}
	decoded, err := ring.Open(baiduMapSecretAADID, baiduMapSecretKind, row.KeyVersion, row.Ciphertext)
	if err != nil || string(decoded) != firstAK {
		t.Fatal("persisted map AK could not be decrypted")
	}
	clear(decoded)

	upstreamCalls := 0
	server.BaiduMapHTTPClient = &http.Client{Transport: baiduMapRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		upstreamCalls++
		if req.URL.Query().Get("ak") != firstAK {
			t.Fatal("subsequent map requests did not use the newly saved AK")
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     http.Header{"Content-Type": []string{"image/png"}},
			Body:       bytesReadCloser(baiduMapPNG(t)),
		}, nil
	})}
	mapResponse := request(http.MethodGet,
		"/api/v1/media/places/baidu-static?lat=1&lng=103&zoom=12&width=400&height=240",
		adminToken, "")
	if mapResponse.Code != http.StatusOK || upstreamCalls != 1 {
		t.Fatalf("map request must use the saved AK immediately, got status=%d calls=%d", mapResponse.Code, upstreamCalls)
	}
	// The original deployment variable is still present but the saved record wins.
	if server.BaiduMapAK != "environment-original-ak" {
		t.Fatal("runtime editing unexpectedly mutated the deployment environment")
	}

	stale := request(http.MethodPut, endpoint, adminToken,
		`{"enabled":true,"revision":0,"ak":"stale-key"}`)
	if stale.Code != http.StatusConflict {
		t.Fatalf("stale optimistic revision must return 409, got %d", stale.Code)
	}

	disable := request(http.MethodPut, endpoint, adminToken, `{"enabled":false,"revision":1}`)
	if disable.Code != http.StatusOK || !strings.Contains(disable.Body.String(), `"revision":2`) {
		t.Fatalf("disable response=%d %s", disable.Code, disable.Body.String())
	}
	mapResponse = request(http.MethodGet,
		"/api/v1/media/places/baidu-static?lat=1&lng=103&zoom=12&width=400&height=240",
		adminToken, "")
	if mapResponse.Code != http.StatusServiceUnavailable || upstreamCalls != 1 {
		t.Fatalf("disabling map must not use fallback map or call upstream: %d %d", mapResponse.Code, upstreamCalls)
	}

	disabledReveal := request(http.MethodPost, revealEndpoint, adminToken, `{"revision":2}`)
	if disabledReveal.Code != http.StatusOK || !strings.Contains(disabledReveal.Body.String(), firstAK) {
		t.Fatalf("disabled-but-stored AK should remain explicitly revealable, got %d", disabledReveal.Code)
	}

	cleared := request(http.MethodPut, endpoint, adminToken,
		`{"enabled":false,"revision":2,"clear_ak":true}`)
	if cleared.Code != http.StatusOK ||
		!strings.Contains(cleared.Body.String(), `"configured":false`) {
		t.Fatalf("cleared map settings response: %d %s", cleared.Code, cleared.Body.String())
	}
	clearedReveal := request(http.MethodPost, revealEndpoint, adminToken, `{"revision":3}`)
	if clearedReveal.Code != http.StatusConflict ||
		strings.Contains(clearedReveal.Body.String(), firstAK) ||
		strings.Contains(clearedReveal.Body.String(), "environment-original-ak") {
		t.Fatalf("cleared AK must never reveal environment fallback or old key: HTTP %d", clearedReveal.Code)
	}
	row = meta.AdminServiceSecret{}
	if err := db.Where("name = ?", baiduMapSecretName).First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if len(row.Ciphertext) != 0 || row.Enabled {
		t.Fatal("clear must remove persisted ciphertext and disable the map")
	}
	var events []meta.AuditEvent
	if err := db.Order("id ASC").Find(&events).Error; err != nil {
		t.Fatal(err)
	}
	if len(events) != 6 {
		t.Fatalf("expected three updates plus three explicit reveal audits, got %d", len(events))
	}
	var revealCount int
	for _, event := range events {
		if event.Action == "admin.service.baidu_map.reveal" {
			revealCount++
		}
	}
	if revealCount != 3 {
		t.Fatalf("expected 3 audited successful reveals, got %d", revealCount)
	}
	for _, event := range events {
		raw, _ := json.Marshal(event)
		if strings.Contains(string(raw), firstAK) || strings.Contains(string(raw), "environment-original-ak") {
			t.Fatal("audit event leaked a map AK")
		}
	}
}

func bytesReadCloser(data []byte) *readCloser {
	return &readCloser{Reader: bytes.NewReader(data)}
}

type readCloser struct{ *bytes.Reader }

func (*readCloser) Close() error { return nil }
