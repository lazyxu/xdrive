package main

import (
	"os"
	"path/filepath"
	"testing"
)

// The DSM Backup-only entry point must not tell Package Center that startup
// succeeded when the package account cannot access its persistent config
// directory and the original Agent's single-instance lock cannot be opened.
func TestBackupOnlyAgentInstanceLockFailureExitsNonzero(t *testing.T) {
	configFile := filepath.Join(t.TempDir(), "config-is-a-file")
	if err := os.WriteFile(configFile, []byte("not a directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("XDG_CONFIG_HOME", configFile)

	oldArgs := os.Args
	os.Args = []string{"xdrive-agent", "--backup-only"}
	t.Cleanup(func() { os.Args = oldArgs })

	if got := runAgent(); got != 1 {
		t.Fatalf("DSM Backup-only startup with an unusable Agent lock returned %d; want 1", got)
	}
}
