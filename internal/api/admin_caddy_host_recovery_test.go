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

func TestCaddyLostStartACKRecoveredFromCurrentHostAndArchive(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Host recovery fixture requires POSIX file modes and symlink behavior")
	}
	dir := t.TempDir()
	folder := filepath.Join(dir, "caddy-deploy-results")
	if err := os.Mkdir(folder, 0750); err != nil {
		t.Fatal(err)
	}
	id, sha := strings.Repeat("a", 24), strings.Repeat("b", 64)
	active := filepath.Join(dir, "caddy-env-active.json")
	save := map[string]string{
		"operation": "deploy", "request_id": id, "expected_sha256": sha,
	}
	payload, _ := json.Marshal(save)
	if err := os.WriteFile(active, payload, 0600); err != nil {
		t.Fatal(err)
	}
	server := &Server{HostControlDir: dir, CaddyHostEnvAuthoritative: true}
	history := func() (int, []byte) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodGet,
			"/api/v1/admin/services/caddy/config/deploy/history", nil)
		server.adminCaddyEnvDeployHistory(c)
		return w.Code, w.Body.Bytes()
	}
	code, body := history()
	if code != http.StatusOK {
		t.Fatalf("Host pending history %d %s", code, body)
	}
	var parsed struct {
		Current *caddyEnvDeployStatus `json:"current"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil || parsed.Current == nil ||
		parsed.Current.RequestID != id || parsed.Current.SHA256 != sha ||
		parsed.Current.State != "deploying" {
		t.Fatalf("unrecoverable active: %s %v", body, err)
	}
	if strings.Contains(string(body), "access_key_secret") {
		t.Fatal("secret leaked")
	}
	result := map[string]string{
		"protocol": caddyHostEnvProtocol, "request_id": id,
		"sha256": sha, "state": "failed", "error": "installer-busy",
	}
	failed, _ := json.Marshal(result)
	if err := os.WriteFile(filepath.Join(dir, caddyHostEnvResultName), failed, 0600); err != nil {
		t.Fatal(err)
	}
	_, body = history()
	if !strings.Contains(string(body), "installer-busy") {
		t.Fatalf("missed terminal status %s", body)
	}
	if err := os.Remove(active); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(folder, id+".json"), failed, 0640); err != nil {
		t.Fatal(err)
	}
	_, body = history()
	var archivePage struct {
		Items []caddyEnvDeployStatus `json:"items"`
	}
	if err := json.Unmarshal(body, &archivePage); err != nil ||
		len(archivePage.Items) != 1 || archivePage.Items[0].RecordedAt == "" {
		t.Fatalf("lost immutable archive time: %s %v", body, err)
	}
	// A preexisting old terminal is still visible but not a NEW operation.
	oldTime := time.Now().Add(-24 * time.Hour)
	if err := os.Chtimes(filepath.Join(folder, id+".json"), oldTime, oldTime); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(dir, caddyHostEnvResultName), active); err != nil {
		t.Fatal(err)
	}
	if server.currentCaddyHostDeploy() != nil {
		t.Fatal("symlinked Host Active accepted")
	}
}
