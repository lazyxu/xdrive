package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestCaddyPendingDBFenceBlocksAdminHTTPSAndAliDNSMutations(t *testing.T) {
	db, second, ring := testCaddyDBPendingFixture(t)
	gin.SetMode(gin.TestMode)
	if err := db.AutoMigrate(&meta.User{}, &meta.AuditEvent{},
		&meta.AdminCaddyHTTPSRevision{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.AdminCaddyHTTPSRevision{
		Name: caddyHTTPSSettingName, Revision: 6,
		LANEnabled: true, LANIP: "192.168.2.3",
		Origin: "saved", CreatedAt: time.Now().UTC(),
	}).Error; err != nil {
		t.Fatal(err)
	}
	admin := meta.User{
		Username: "pending-caddy-admin", PasswordHash: "test",
		Role: meta.UserRoleAdmin, SessionVersion: 1,
	}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	const jwtSecret = "caddy-host-pending-edit-fence-local-test"
	first := &Server{DB: db, Auth: auth.New(jwtSecret, time.Hour), ConnectorSecrets: ring}
	other := &Server{DB: second, Auth: auth.New(jwtSecret, time.Hour), ConnectorSecrets: ring}
	token, err := first.Auth.Issue(admin.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	routerA, routerB := first.Router(), other.Router()
	call := func(router http.Handler, method, path, body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)
		resp := httptest.NewRecorder()
		router.ServeHTTP(resp, req)
		return resp
	}

	// An internal DB-only reservation has no new Host mutation route and no
	// capability to imply that an HTTPS revision was actually applied.
	input := testCaddyDBPendingRequest(t, 7, 0, false, "", true, "192.168.2.4")
	if err := stageCaddyHostDBPendingUnapplied(context.Background(), db, ring, input); err != nil {
		t.Fatalf("initial private DB pending fence: %v", err)
	}
	var before int64
	if err := db.Model(&meta.AuditEvent{}).Count(&before).Error; err != nil {
		t.Fatal(err)
	}
	const base = "/api/v1/admin/services/caddy"
	for _, tc := range []struct {
		name   string
		router http.Handler
		method string
		path   string
		body   string
	}{
		{"edit HTTPS through first Server", routerA, http.MethodPut, base + "/https",
			`{"revision":7,"enabled":false,"domain":"","lan_enabled":true,"lan_ip":"192.168.2.5"}`},
		{"rollback HTTPS through second Server", routerB, http.MethodPost, base + "/https/rollback",
			`{"revision":7,"target_revision":6}`},
		{"create AliDNS through other Server", routerB, http.MethodPut, base + "/alidns",
			`{"revision":0,"access_key_id":"LTAIExampleCaddyID","access_key_secret":"ExampleCaddySecret123456"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resp := call(tc.router, tc.method, tc.path, tc.body)
			if resp.Code != http.StatusConflict {
				t.Fatalf("pending Caddy DB fence returned %d, expected 409", resp.Code)
			}
			for _, raw := range []string{"192.168.2.4", "192.168.2.5", "LTAIExampleCaddyID", "ExampleCaddySecret123456"} {
				if strings.Contains(resp.Body.String(), raw) {
					t.Fatal("blocked Caddy mutation leaked an IP or secret")
				}
			}
		})
	}
	var desired meta.AdminCaddyHTTPSSetting
	if err := db.Where("name = ?", caddyHTTPSSettingName).Take(&desired).Error; err != nil {
		t.Fatal(err)
	}
	if desired.Revision != 7 || !desired.LANEnabled || desired.LANIP != "192.168.2.4" ||
		desired.Enabled || desired.Domain != "" {
		t.Fatalf("pending edit mutated HTTPS desired settings: %+v", desired)
	}
	var credentials int64
	if err := db.Model(&meta.AdminServiceSecret{}).
		Where("name = ?", caddyAliDNSSecretName).Count(&credentials).Error; err != nil {
		t.Fatal(err)
	}
	var after int64
	if err := db.Model(&meta.AuditEvent{}).Count(&after).Error; err != nil {
		t.Fatal(err)
	}
	if credentials != 0 || after != before {
		t.Fatalf("blocked HTTPS/AliDNS edits wrote credentials or audit: creds=%d audits=%d->%d", credentials, before, after)
	}
	httpsStatus := call(routerA, http.MethodGet, base+"/https", "")
	var config adminCaddyHTTPSConfigDTO
	if httpsStatus.Code != http.StatusOK ||
		json.Unmarshal(httpsStatus.Body.Bytes(), &config) != nil {
		t.Fatalf("read-only HTTPS state lost while pending: %d", httpsStatus.Code)
	}
	if config.ApplySupported || config.ApplyState != "pending" {
		t.Fatalf("DB pending reservation falsely presented applied Caddy: %+v", config)
	}
	// The same pending remains sticky. No automatic expiry or unsafe discard.
	var count int64
	if err := db.Model(&meta.AdminCaddyHostApplyReservation{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("pending reservation was unexpectedly consumed: %d %v", count, err)
	}
}
