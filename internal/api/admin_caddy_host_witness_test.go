package api

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCaddyHostReadOnlyWitnessFailClosedAndVerifiedLocalTLS(t *testing.T) {
	dir := t.TempDir()
	check := func(want string, ready bool) {
		t.Helper()
		reason, ok := CaddyHostReadOnlyWitness(dir)
		if reason != want || ok != ready {
			t.Fatalf("witness = (%q,%v), want (%q,%v)", reason, ok, want, ready)
		}
	}
	check("heartbeat-missing", false)
	heartbeat, snapshot := filepath.Join(dir, "heartbeat"), filepath.Join(dir, caddyHostStatusName)
	if err := os.WriteFile(heartbeat, []byte("alive"), 0600); err != nil {
		t.Fatal(err)
	}
	check("snapshot-missing", false)
	digest := strings.Repeat("a", 64)
	domainGood := `{"state":"healthy","https_configured":true,"tls_check_supported":true,"tls_state":"verified","tls_verified_domain_sha256":"` + digest + `"}`
	if err := os.WriteFile(snapshot, []byte(domainGood), 0600); err != nil {
		t.Fatal(err)
	}
	check("local-https-observed", true)
	domainWithoutIdentity := `{"state":"healthy","https_configured":true,"tls_check_supported":true,"tls_state":"verified"}`
	if err := os.WriteFile(snapshot, []byte(domainWithoutIdentity), 0600); err != nil {
		t.Fatal(err)
	}
	check("domain-tls-unverified", false)
	lanGood := `{"state":"healthy","https_configured":false,"tls_check_supported":true,"tls_state":"disabled","lan_https_configured":true,"lan_tls_state":"verified","lan_verified_ip_sha256":"` + digest + `"}`
	if err := os.WriteFile(snapshot, []byte(lanGood), 0600); err != nil {
		t.Fatal(err)
	}
	check("local-https-observed", true)
	lanBad := `{"state":"healthy","https_configured":false,"tls_check_supported":true,"tls_state":"disabled","lan_https_configured":true,"lan_tls_state":"unavailable"}`
	if err := os.WriteFile(snapshot, []byte(lanBad), 0600); err != nil {
		t.Fatal(err)
	}
	check("lan-tls-unverified", false)
	httpOnly := `{"state":"healthy","https_configured":false,"tls_check_supported":true,"tls_state":"disabled"}`
	if err := os.WriteFile(snapshot, []byte(httpOnly), 0600); err != nil {
		t.Fatal(err)
	}
	check("https-not-configured", false)
	if err := os.WriteFile(snapshot, []byte(domainGood), 0600); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-2 * time.Minute)
	if err := os.Chtimes(snapshot, old, old); err != nil {
		t.Fatal(err)
	}
	check("snapshot-stale", false)
}
