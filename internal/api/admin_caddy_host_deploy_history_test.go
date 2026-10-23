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

func TestCaddyBoundedHostTerminalHistoryAndUnsafeFiles(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Caddy Host immutable archive needs POSIX directory permissions")
	}
	dir := t.TempDir()
	folder := filepath.Join(dir, "caddy-deploy-results")
	if err := os.Mkdir(folder, 0750); err != nil {
		t.Fatal(err)
	}
	sha := strings.Repeat("a", 64)
	ids := []string{strings.Repeat("1", 24), strings.Repeat("2", 24)}
	for i, id := range ids {
		b, err := json.Marshal(caddyEnvDeployStatus{
			Protocol: caddyHostEnvProtocol, RequestID: id,
			State: "failed", SHA256: sha, Error: "installer-busy",
		})
		if err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(folder, id+".json")
		if err := os.WriteFile(path, b, 0640); err != nil {
			t.Fatal(err)
		}
		at := time.Now().Add(-time.Duration(3-i) * time.Minute)
		if err := os.Chtimes(path, at, at); err != nil {
			t.Fatal(err)
		}
	}
	server := &Server{HostControlDir: dir, CaddyHostEnvAuthoritative: true}
	history := func() *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodGet,
			"/api/v1/admin/services/caddy/config/deploy/history", nil)
		server.adminCaddyEnvDeployHistory(c)
		return w
	}
	w := history()
	if w.Code != http.StatusOK {
		t.Fatalf("history read failed: %d: %s", w.Code, w.Body.String())
	}
	var parsed struct {
		Items []caddyEnvDeployStatus `json:"items"`
		Scope string                 `json:"scope"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed.Scope != "host-terminal" || len(parsed.Items) != 2 ||
		parsed.Items[0].RequestID != ids[1] || parsed.Items[1].RequestID != ids[0] {
		t.Fatalf("wrong ordered Host archive: %#v", parsed)
	}
	if strings.Contains(w.Body.String(), "host_local_generation_sha256") ||
		strings.Contains(w.Body.String(), "access_key_secret") ||
		strings.Contains(w.Body.String(), "applied_receipt") {
		t.Fatal("private Host secrets or forged Applied result in history")
	}
	if err := os.Symlink(filepath.Join(dir, "heartbeat"),
		filepath.Join(folder, strings.Repeat("3", 24)+".json")); err != nil {
		t.Fatal(err)
	}
	if w := history(); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("unsafe archived symlink incorrectly returned HTTP %d", w.Code)
	}
}
