package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestCaddyHostEnvFingerprintCanonical(t *testing.T) {
	a := caddyHostEnvFingerprint("example.com", "192.168.1.9", "someinitialid", "someinitialsecret")
	if !validCaddyHostEnvSHA(a) || validCaddyHostEnvSHA("0") || validCaddyHostEnvSHA("G"+a[1:]) {
		t.Fatal("bad Caddy env fingerprint validation")
	}
	if a == caddyHostEnvFingerprint("example.com", "192.168.1.9", "someinitialid", "anothersecret") {
		t.Fatal("secret mutation ignored")
	}
}

func TestCaddyHostEnvReadFreshBounded(t *testing.T) {
	dir := t.TempDir()
	now := time.Now().UTC()
	for _, name := range []string{"heartbeat", caddyHostEnvSnapshotName} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(""), 0600); err != nil {
			t.Fatal(err)
		}
	}
	snap := caddyHostEnvSnapshot{
		Protocol: caddyHostEnvProtocol, Domain: "a.example.com", DomainEnabled: true,
		LANIP: "192.168.1.9", LANEnabled: true, AliDNSConfigured: true,
		SHA256:     caddyHostEnvFingerprint("a.example.com", "192.168.1.9", "someinitialid", "someinitialsecret"),
		ObservedAt: now,
	}
	path := filepath.Join(dir, caddyHostEnvSnapshotName)
	raw, _ := json.Marshal(snap)
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	server := &Server{HostControlDir: dir}
	result, err := server.readCaddyHostEnv()
	if err != nil || result.Domain != snap.Domain {
		t.Fatalf("read %#v %v", result, err)
	}
	snap.DomainEnabled = false
	raw, _ = json.Marshal(snap)
	_ = os.WriteFile(path, raw, 0600)
	if _, err := server.readCaddyHostEnv(); err == nil {
		t.Fatal("accepted mismatched enabled flag")
	}
	snap.DomainEnabled = true
	snap.ObservedAt = now.Add(-time.Hour)
	raw, _ = json.Marshal(snap)
	_ = os.WriteFile(path, raw, 0600)
	if _, err := server.readCaddyHostEnv(); err == nil {
		t.Fatal("accepted stale snapshot")
	}
	_ = os.Remove(path)
	if err := os.Symlink("heartbeat", path); err != nil {
		t.Fatal(err)
	}
	if _, err := server.readCaddyHostEnv(); err == nil {
		t.Fatal("accepted symlink")
	}
}

func TestCaddyHostEnvAdminReadsWithoutDatabase(t *testing.T) {
	dir := t.TempDir()
	now := time.Now().UTC()
	if err := os.WriteFile(filepath.Join(dir, "heartbeat"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	snap := caddyHostEnvSnapshot{
		Protocol: caddyHostEnvProtocol,
		Domain:   "host.example.com", DomainEnabled: true,
		LANIP: "192.168.1.9", LANEnabled: true, AliDNSConfigured: true,
		SHA256:     caddyHostEnvFingerprint("host.example.com", "192.168.1.9", "someinitialid", "someinitialsecret"),
		ObservedAt: now,
	}
	raw, err := json.Marshal(snap)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, caddyHostEnvSnapshotName), raw, 0600); err != nil {
		t.Fatal(err)
	}
	server := &Server{HostControlDir: dir, CaddyHostEnvAuthoritative: true} // deliberately no PostgreSQL DB
	tests := []struct {
		name   string
		want   int
		method string
		call   func(*gin.Context)
	}{
		{"HTTPS", http.StatusOK, http.MethodGet, server.adminCaddyHTTPSConfig},
		{"AliDNS", http.StatusOK, http.MethodGet, server.adminCaddyAliDNSConfig},
		{"legacy PostgreSQL preflight", http.StatusNotImplemented, http.MethodGet, server.adminCaddyHTTPSPreflight},
		{"legacy PostgreSQL rollback", http.StatusNotImplemented, http.MethodPost, server.adminRollbackCaddyHTTPS},
		{"no unapproved redeploy", http.StatusConflict, http.MethodPost, server.adminStartCaddyEnvDeploy},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest(tc.method, "/api/v1/admin/services/caddy", nil)
			tc.call(c)
			if w.Code != tc.want {
				t.Fatalf("got HTTP %d, want %d: %s", w.Code, tc.want, w.Body.String())
			}
			if tc.want == http.StatusOK {
				if w.Header().Get("Cache-Control") != "no-store" {
					t.Fatal("current host config must not be cached")
				}
				if tc.name == "HTTPS" && !json.Valid(w.Body.Bytes()) {
					t.Fatal("invalid HTTPS projection")
				}
			}
		})
	}
}

func TestCaddyHostEnvDeployNoPostgresDependency(t *testing.T) {
	dir := t.TempDir()
	now := time.Now().UTC()
	if err := os.WriteFile(filepath.Join(dir, "heartbeat"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	snap := caddyHostEnvSnapshot{
		Protocol: caddyHostEnvProtocol,
		Domain:   "host.example.com", DomainEnabled: true,
		LANIP: "192.168.1.9", LANEnabled: true, AliDNSConfigured: true,
		SHA256:          caddyHostEnvFingerprint("host.example.com", "192.168.1.9", "someinitialid", "someinitialsecret"),
		PendingRedeploy: true, ObservedAt: now,
	}
	raw, err := json.Marshal(snap)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, caddyHostEnvSnapshotName), raw, 0600); err != nil {
		t.Fatal(err)
	}
	server := &Server{HostControlDir: dir, CaddyHostEnvAuthoritative: true} // nil DB is intentional
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // reject before any Host queue action; tests only the API's DB independence
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/admin/services/caddy/config/deploy", nil).WithContext(ctx)
	server.adminStartCaddyEnvDeploy(c)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("pending host .env must reach Host dispatch (without DB): %d %s", w.Code, w.Body.String())
	}
	if _, err := os.Lstat(filepath.Join(dir, caddyHostEnvRequestName)); !os.IsNotExist(err) {
		t.Fatalf("canceled request dispatched host action: %v", err)
	}
}

func TestCaddyHostEnvCanConfigureLegacyHTTPOnlyIngress(t *testing.T) {
	dir := t.TempDir()
	now := time.Now().UTC()
	if err := os.WriteFile(filepath.Join(dir, "heartbeat"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	// Existing xDrive upgrades may have XD_LEGACY_HTTP_ONLY=1 and no HTTPS
	// entry. They must remain editable; the Host SAVE validator independently
	// requires at least one HTTPS target in the candidate.
	snap := caddyHostEnvSnapshot{
		Protocol: caddyHostEnvProtocol,
		Domain:   "", DomainEnabled: false, LANIP: "", LANEnabled: false,
		SHA256: caddyHostEnvFingerprint("", "", "", ""), ObservedAt: now,
	}
	raw, err := json.Marshal(snap)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, caddyHostEnvSnapshotName), raw, 0600); err != nil {
		t.Fatal(err)
	}
	server := &Server{HostControlDir: dir, CaddyHostEnvAuthoritative: true}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/admin/services/caddy/https", nil)
	server.adminCaddyHTTPSConfig(c)
	if w.Code != http.StatusOK {
		t.Fatalf("legacy HTTP-only Caddy must be configurable: %d %s", w.Code, w.Body.String())
	}
	var actual struct {
		Editable          bool   `json:"editable"`
		Source            string `json:"source"`
		DesiredEnabled    bool   `json:"desired_enabled"`
		DesiredLANEnabled bool   `json:"desired_lan_enabled"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &actual); err != nil {
		t.Fatal(err)
	}
	if !actual.Editable || actual.Source != "host-env" ||
		actual.DesiredEnabled || actual.DesiredLANEnabled {
		t.Fatalf("legacy HTTP-only host projection invalid: %#v", actual)
	}
}
