//go:build windows

package update

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWriteWindowsUpdateScripts(t *testing.T) {
	transaction, cleanup, status, logPath, err := writeWindowsUpdateScripts(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{transaction, cleanup} {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.IsDir() {
			t.Fatalf("%s is a directory", path)
		}
	}
	transactionBody, err := os.ReadFile(transaction)
	if err != nil {
		t.Fatal(err)
	}
	for _, marker := range []string{
		"last-known-good",
		"/DEFERLEGACYCLEANUP",
		"Start-AgentAndVerify",
		"Start-DesktopAndVerify",
		"Backup-RegistryState",
		"Restore-RegistryState",
		"last-known-good-startmenu",
		"Restore-LastKnownGood",
		"rolled_back",
	} {
		if !strings.Contains(string(transactionBody), marker) {
			t.Fatalf("transaction script missing %q", marker)
		}
	}
	cleanupBody, err := os.ReadFile(cleanup)
	if err != nil {
		t.Fatal(err)
	}
	for _, marker := range []string{"xDrive Desktop", "Uninstall", "CurrentVersion\\Run"} {
		if !strings.Contains(string(cleanupBody), marker) {
			t.Fatalf("legacy cleanup script missing %q", marker)
		}
	}
	if filepath.Base(status) != "last-transaction.json" || filepath.Base(logPath) != "last-transaction.log" {
		t.Fatalf("unexpected transaction output paths: status=%s log=%s", status, logPath)
	}
}

func TestLastInstallStatusAcceptsUTF8BOM(t *testing.T) {
	cache := t.TempDir()
	t.Setenv("LOCALAPPDATA", cache)
	statusDir := filepath.Join(cache, "xdrive", "updates", "transaction")
	if err := os.MkdirAll(statusDir, 0o700); err != nil {
		t.Fatal(err)
	}
	body := append([]byte{0xEF, 0xBB, 0xBF}, []byte(`{"state":"success","target_version":"snapshot-test","rolled_back":false}`)...)
	if err := os.WriteFile(filepath.Join(statusDir, "last-transaction.json"), body, 0o600); err != nil {
		t.Fatal(err)
	}
	status, err := LastInstallStatus()
	if err != nil {
		t.Fatal(err)
	}
	if status.State != "success" || status.TargetVersion != "snapshot-test" {
		t.Fatalf("unexpected status: %+v", status)
	}
}
