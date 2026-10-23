package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestCaddyHostDeployErrorCodesDoNotLeakRawHostErrors(t *testing.T) {
	id := strings.Repeat("a", 24)
	sha := strings.Repeat("b", 64)
	dir := t.TempDir()
	server := &Server{HostControlDir: dir, CaddyHostEnvAuthoritative: true}
	tests := []struct {
		name       string
		state      string
		errorCode  string
		rolledBack bool
		wantError  string
		wantBack   bool
	}{
		{"busy", "failed", "installer-busy", false, "installer-busy", false},
		{"rejected", "failed", "deploy-refused", false, "deploy-refused", false},
		{"interrupted", "failed", "interrupted-deploy", true, "interrupted-deploy", true},
		{"rollback failed", "failed", "caddy-deploy-or-verify-failed", false, "caddy-deploy-or-verify-failed", false},
		{"rollback success", "failed", "caddy-deploy-or-verify-failed", true, "caddy-deploy-or-verify-failed", true},
		{"secret leak", "failed", "/home/owner/.xd/config/.env: SECRET-DO-NOT-LEAK", true, "", true},
		{"unknown", "failed", "", false, "", false},
		{"running cannot report error", "deploying", "installer-busy", true, "", false},
		{"success cannot report error", "deployed", "interrupted-deploy", true, "", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			value := map[string]any{
				"protocol":    caddyHostEnvProtocol,
				"request_id":  id,
				"sha256":      sha,
				"state":       tc.state,
				"rolled_back": tc.rolledBack,
				"error":       tc.errorCode,
			}
			if tc.name == "success cannot report error" {
				// Host-private immutable local observation is NOT a public
				// live Applied Receipt or a browser-visible runtime identity.
				value["host_local_generation_sha256"] = strings.Repeat("c", 64)
				value["host_local_live_config_sha256"] = strings.Repeat("d", 64)
			}
			payload, err := json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, caddyHostEnvResultName), payload, 0600); err != nil {
				t.Fatal(err)
			}
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest(http.MethodGet,
				"/api/v1/admin/services/caddy/config/deploy?request_id="+id, nil)
			server.adminCaddyEnvDeployStatus(c)
			if w.Code != http.StatusOK {
				t.Fatalf("get status: HTTP %d: %s", w.Code, w.Body.String())
			}
			if strings.Contains(w.Body.String(), "SECRET-DO-NOT-LEAK") ||
				strings.Contains(w.Body.String(), "host_local_") ||
				strings.Contains(w.Body.String(), strings.Repeat("c", 64)) {
				t.Fatal("private Host runtime witness or diagnostic leaked to administrator")
			}
			var output caddyEnvDeployStatus
			if err := json.Unmarshal(w.Body.Bytes(), &output); err != nil {
				t.Fatal(err)
			}
			if output.Error != tc.wantError || output.RolledBack != tc.wantBack {
				t.Fatalf("unexpected bounded status: %#v; want error %q, rollback %v",
					output, tc.wantError, tc.wantBack)
			}
			if w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("Caddy deploy status must be no-store")
			}
		})
	}
}

func TestCaddyDeployTerminalArchiveSurvivesSingletonOverwrite(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Caddy Host archive relies on POSIX directory permissions and symlink behavior; Linux CI verifies these guarantees")
	}
	dir := t.TempDir()
	archive := filepath.Join(dir, "caddy-deploy-results")
	if err := os.Mkdir(archive, 0750); err != nil {
		t.Fatal(err)
	}
	id := strings.Repeat("a", 24)
	other := strings.Repeat("c", 24)
	sha := strings.Repeat("b", 64)
	previous := map[string]any{
		"protocol": caddyHostEnvProtocol, "request_id": id, "sha256": sha,
		"state": "failed", "error": "installer-busy",
	}
	later := map[string]any{
		"protocol": caddyHostEnvProtocol, "request_id": other, "sha256": sha,
		"state": "deployed",
	}
	for path, value := range map[string]any{
		filepath.Join(archive, id+".json"):         previous,
		filepath.Join(dir, caddyHostEnvResultName): later,
	} {
		data, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, data, 0640); err != nil {
			t.Fatal(err)
		}
	}
	terminalPath := filepath.Join(archive, id+".json")
	dayAgo := time.Now().Add(-24 * time.Hour)
	if err := os.Chtimes(terminalPath, dayAgo, dayAgo); err != nil {
		t.Fatal(err)
	}
	server := &Server{HostControlDir: dir, CaddyHostEnvAuthoritative: true}
	record, err := server.readCaddyEnvDeployStatus(id)
	if err != nil || record.RequestID != id || record.Error != "installer-busy" ||
		record.State != "failed" {
		t.Fatalf("per-request terminal lost after singleton overwrite: %#v %v", record, err)
	}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/admin/services/caddy/config/deploy?request_id="+id, nil)
	server.adminCaddyEnvDeployStatus(c)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "installer-busy") {
		t.Fatalf("bounded terminal GET unavailable: %d %s", w.Code, w.Body.String())
	}
	if err := os.Remove(terminalPath); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(dir, caddyHostEnvResultName), terminalPath); err != nil {
		t.Fatal(err)
	}
	if _, err := server.readCaddyEnvDeployStatus(id); err == nil {
		t.Fatal("archive symlink fell back to another request")
	}
	if err := os.Remove(terminalPath); err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(previous)
	if err := os.WriteFile(terminalPath, b, 0640); err != nil {
		t.Fatal(err)
	}
	expired := time.Now().Add(-8 * 24 * time.Hour)
	if err := os.Chtimes(terminalPath, expired, expired); err != nil {
		t.Fatal(err)
	}
	if _, err := server.readCaddyEnvDeployStatus(id); err == nil {
		t.Fatal("expired terminal receipt was accepted")
	}
}
