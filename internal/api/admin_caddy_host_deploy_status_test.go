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
			payload, err := json.Marshal(map[string]any{
				"protocol":    caddyHostEnvProtocol,
				"request_id":  id,
				"sha256":      sha,
				"state":       tc.state,
				"rolled_back": tc.rolledBack,
				"error":       tc.errorCode,
			})
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
			if strings.Contains(w.Body.String(), "SECRET-DO-NOT-LEAK") {
				t.Fatal("host diagnostic leaked into administrator response")
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
