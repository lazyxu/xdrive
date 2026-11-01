package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCaddyHostReadOnlyWitnessCLINeedsNoDBKeyringOrSecret(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("XD_HOST_CONTROL_DIR", dir)
	if err := runCaddyHostCommand([]string{"witness-check"}); err == nil {
		t.Fatal("missing witness must fail closed")
	}
	digest := strings.Repeat("a", 64)
	if err := os.WriteFile(filepath.Join(dir, "heartbeat"), []byte("alive"), 0600); err != nil {
		t.Fatal(err)
	}
	status := `{"state":"healthy","https_configured":true,"tls_check_supported":true,"tls_state":"verified","tls_verified_domain_sha256":"` + digest + `"}`
	if err := os.WriteFile(filepath.Join(dir, "caddy-runtime-status.json"), []byte(status), 0600); err != nil {
		t.Fatal(err)
	}
	if err := runCaddyHostCommand([]string{"witness-check"}); err != nil {
		t.Fatalf("trusted observation without DB/keyring must succeed: %v", err)
	}
	if err := runCaddyHostCommand([]string{"witness-check", "unexpected"}); err == nil {
		t.Fatal("unbounded CLI arguments accepted")
	}
}

func TestCaddyHostConfigCLIUsesExactAdminSnapshotWithoutDBOrSecrets(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("XD_HOST_CONTROL_DIR", dir)
	if err := runCaddyHostCommand([]string{"config-check"}); err == nil {
		t.Fatal("missing Host config snapshot accepted")
	}
	if err := os.WriteFile(filepath.Join(dir, "heartbeat"), []byte("alive"), 0600); err != nil {
		t.Fatal(err)
	}
	digest := strings.Repeat("a", 64)
	snapshot := fmt.Sprintf(`{"protocol":"xdrive.caddy.host-env.v1","domain":"a.example.com","domain_enabled":true,"lan_ip":"","lan_enabled":false,"alidns_configured":false,"sha256":"%s","pending_redeploy":false,"observed_at":"%s"}`,
		digest, time.Now().UTC().Format(time.RFC3339Nano))
	path := filepath.Join(dir, "caddy-env-observed.json")
	if err := os.WriteFile(path, []byte(snapshot), 0600); err != nil {
		t.Fatal(err)
	}
	if err := runCaddyHostCommand([]string{"config-check"}); err != nil {
		t.Fatalf("fresh authorized Host config snapshot must be readable without database: %v", err)
	}
	if err := os.WriteFile(path, []byte(`{"protocol":"xdrive.caddy.host-env.v1","domain":"sensitive-must-not-leak"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := runCaddyHostCommand([]string{"config-check"}); err == nil {
		t.Fatal("incomplete/sensitive Host snapshot accepted")
	}
	if err := runCaddyHostCommand([]string{"config-check", "unexpected"}); err == nil {
		t.Fatal("unexpected config-check arguments accepted")
	}
}
