package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func caddyStatusFromAdmin(t *testing.T, server *Server) serviceDependency {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/admin/services", nil)
	server.adminServiceDependencies(ctx)
	if recorder.Code != http.StatusOK {
		t.Fatalf("admin services status %d: %s", recorder.Code, recorder.Body.String())
	}
	var snapshot serviceDependenciesSnapshot
	if err := json.Unmarshal(recorder.Body.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	for _, svc := range snapshot.Services {
		if svc.ID == "caddy" {
			return svc
		}
	}
	t.Fatal("missing Caddy dependency row")
	return serviceDependency{}
}

func TestAdminCaddyHostHealthFailsClosedWithoutClaimingExternalTLS(t *testing.T) {
	dir := t.TempDir()
	server := &Server{HostControlDir: dir}
	if got := caddyStatusFromAdmin(t, server); got.Status != "unknown" {
		t.Fatalf("absent Host Manager incorrectly reported Caddy ready: %+v", got)
	}
	statusPath := filepath.Join(dir, caddyHostStatusName)
	heartbeat := filepath.Join(dir, "heartbeat")
	write := func(state string, https bool) {
		t.Helper()
		payload, err := json.Marshal(caddyHostStatus{State: state, HTTPSConfigured: https})
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(statusPath, payload, 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(heartbeat, []byte("live"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	write("healthy", true)
	good := caddyStatusFromAdmin(t, server)
	if good.Status != "ready" || !strings.Contains(good.Detail, "内部 HTTP") ||
		!strings.Contains(good.Detail, "未独立验证证书") || strings.Contains(good.Detail, "证书已验证") {
		t.Fatalf("internal proxy readiness falsely claimed external TLS: %+v", good)
	}
	write("healthy", false)
	if got := caddyStatusFromAdmin(t, server); got.Status != "ready" ||
		!strings.Contains(got.Detail, "未要求自定义 HTTPS") {
		t.Fatalf("HTTP-mode intent not identified: %+v", got)
	}
	for _, tc := range []struct {
		state, expected string
	}{
		{"unhealthy", "unavailable"},
		{"stopped", "unavailable"},
		{"starting", "unknown"},
		{"running-unverified", "unknown"},
		{"unknown", "unknown"},
	} {
		write(tc.state, true)
		if got := caddyStatusFromAdmin(t, server); got.Status != tc.expected {
			t.Fatalf("state %q returned %q instead of %q", tc.state, got.Status, tc.expected)
		}
	}
	write("healthy", false)
	old := time.Now().Add(-2 * time.Minute)
	if err := os.Chtimes(statusPath, old, old); err != nil {
		t.Fatal(err)
	}
	if got := caddyStatusFromAdmin(t, server); got.Status != "unknown" {
		t.Fatalf("stale healthy file trusted: %+v", got)
	}
	write("healthy", false)
	if err := os.Chtimes(heartbeat, old, old); err != nil {
		t.Fatal(err)
	}
	if got := caddyStatusFromAdmin(t, server); got.Status != "unknown" {
		t.Fatalf("stale Host Manager heartbeat trusted: %+v", got)
	}
	write("healthy", false)
	future := time.Now().Add(time.Minute)
	if err := os.Chtimes(statusPath, future, future); err != nil {
		t.Fatal(err)
	}
	if got := caddyStatusFromAdmin(t, server); got.Status != "unknown" {
		t.Fatalf("future-dated health file trusted: %+v", got)
	}
	write("invalid", false)
	if got := caddyStatusFromAdmin(t, server); got.Status != "unknown" {
		t.Fatalf("invalid host status trusted: %+v", got)
	}
	if err := os.WriteFile(statusPath, []byte("{invalid JSON"), 0600); err != nil {
		t.Fatal(err)
	}
	if got := caddyStatusFromAdmin(t, server); got.Status != "unknown" {
		t.Fatalf("corrupted host status trusted: %+v", got)
	}
}
