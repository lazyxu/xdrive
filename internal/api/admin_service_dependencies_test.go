package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestAdminServiceDependenciesFailClosed(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/admin/services", nil)
	(&Server{}).adminServiceDependencies(ctx)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
	if recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("status response must not be cached")
	}
	var response serviceDependenciesSnapshot
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.CheckedAt == "" || len(response.Services) != 11 {
		t.Fatalf("unexpected snapshot: %+v", response)
	}
	expected := map[string]string{
		"database":          "unavailable",
		"storage":           "unavailable",
		"media-worker":      "disabled",
		"photo-face":        "disabled",
		"photo-smart":       "disabled",
		"photo-semantic":    "disabled",
		"geonames":          "disabled",
		"baidu-map":         "disabled",
		"photo-creative":    "disabled",
		"background-worker": "unknown",
		"caddy":             "unknown",
	}
	for _, item := range response.Services {
		// Source credentials are per-user, not global service dependencies.
		if item.Group == "connectors" || item.ID == "yike" || item.ID == "synology-photos" || item.ID == "synology-files" {
			t.Fatalf("user-scoped source exposed in admin services: %q", item.ID)
		}
		if want, ok := expected[item.ID]; !ok || item.Status != want {
			t.Fatalf("invalid status for %q: got %q, expected %q", item.ID, item.Status, want)
		}
		if item.Detail == "" {
			t.Fatalf("missing detail for %q", item.ID)
		}
		if item.ConfigMode == "" || item.ApplyMode == "" || item.ConfigHint == "" {
			t.Fatalf("missing safe service configuration contract for %q", item.ID)
		}
		for field, value := range map[string]string{
			"configuration_state": item.ConfigurationState,
			"installation_state":  item.InstallationState,
			"health_state":        item.HealthState,
			"activation_state":    item.ActivationState,
		} {
			if value == "" {
				t.Fatalf("missing %s for %q", field, item.ID)
			}
		}
		if item.ActivationState == "verified" || item.InstallationState == "observed" {
			t.Fatalf("empty Server fabricated activation or installation: %+v", item)
		}
	}
}

func TestAdminServiceDependencyLifecycleBaiduAndCaddyNoFalseApplied(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := &Server{BaiduMapEnabled: true, BaiduMapAK: "test-example-AK"}
	read := func() map[string]serviceDependency {
		t.Helper()
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/admin/services", nil)
		s.adminServiceDependencies(ctx)
		if recorder.Code != http.StatusOK {
			t.Fatalf("services HTTP %d", recorder.Code)
		}
		var response serviceDependenciesSnapshot
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		byID := make(map[string]serviceDependency)
		for _, item := range response.Services {
			byID[item.ID] = item
		}
		return byID
	}
	before := read()
	baidu := before["baidu-map"]
	if baidu.Status != "unknown" || baidu.ConfigurationState != "configured" ||
		baidu.InstallationState != "external" || baidu.HealthState != "not-checked" ||
		baidu.ActivationState != "local-effective" {
		t.Fatalf("configured AK must not fabricate remote Baidu health: %+v", baidu)
	}
	if !strings.Contains(baidu.Detail, "管理员手动在线验证会消耗一次 Static Map API 配额") ||
		strings.Contains(baidu.Detail, "不消耗额外 API 配额") {
		t.Fatalf("Baidu status must distinguish saved AK from a quota-consuming live PNG probe: %q", baidu.Detail)
	}
	if before["caddy"].InstallationState != "unknown" ||
		before["caddy"].ActivationState != "deployment-only" {
		t.Fatalf("no Host Manager must not prove Caddy applied: %+v", before["caddy"])
	}
	s.HostControlDir = t.TempDir()
	if err := os.WriteFile(filepath.Join(s.HostControlDir, "heartbeat"), []byte("ok"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.HostControlDir, caddyHostStatusName),
		[]byte(`{"state":"healthy","https_configured":true,"tls_check_supported":true,"tls_state":"verified"}`), 0600); err != nil {
		t.Fatal(err)
	}
	gateway := read()["caddy"]
	if gateway.Status != "ready" || gateway.ConfigurationState != "configured" ||
		gateway.InstallationState != "observed" || gateway.HealthState != "ready" ||
		gateway.ActivationState != "deployment-only" ||
		gateway.LocalTLSState != "verified" || gateway.HTTPSConfigured == nil || !*gateway.HTTPSConfigured {
		t.Fatalf("local HTTPS cannot promote unbound desired revision: %+v", gateway)
	}
}

func TestAdminServiceDependenciesRequiresAuthentication(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/admin/services", nil)
	(&Server{}).Router().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated admin endpoint returned %d", recorder.Code)
	}
}

func TestAdminServiceDependenciesCaddyDeclaredIngressWithoutHostWitness(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("XD_DOMAIN", "existing.example.test")
	t.Setenv("XD_LAN_HTTPS_IP", "")
	s := &Server{HostControlDir: t.TempDir()}
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/admin/services", nil)
	s.adminServiceDependencies(ctx)
	if recorder.Code != http.StatusOK {
		t.Fatalf("services HTTP %d", recorder.Code)
	}
	var response serviceDependenciesSnapshot
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	for _, item := range response.Services {
		if item.ID != "caddy" {
			continue
		}
		if item.ConfigurationState != "configured" || item.InstallationState != "unknown" ||
			item.HealthState != "unknown" || item.ActivationState != "deployment-only" ||
			item.Status != "unknown" || item.CaddyInternalHTTPState != "" ||
			item.HTTPSConfigured != nil || item.LocalTLSState != "" {
			t.Fatalf("declared ingress may not fabricate installed Caddy or TLS: %+v", item)
		}
		return
	}
	t.Fatal("missing Caddy service")
}
