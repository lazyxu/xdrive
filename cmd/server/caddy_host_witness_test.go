package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
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
