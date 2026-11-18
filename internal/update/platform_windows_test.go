//go:build windows

package update

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestHiddenWindowsUpgradeCommand(t *testing.T) {
	cmd := newHiddenWindowsUpgradeCommand([]string{"-NoProfile", "-File", "transaction.ps1"})
	if !strings.EqualFold(filepath.Base(cmd.Path), "powershell.exe") {
		t.Fatalf("unexpected update executable: %q", cmd.Path)
	}
	if cmd.SysProcAttr == nil || !cmd.SysProcAttr.HideWindow ||
		cmd.SysProcAttr.CreationFlags&windowsCreateNoWindow == 0 {
		t.Fatalf("background PowerShell must not create a console: %+v", cmd.SysProcAttr)
	}
}

func TestHiddenWindowsUpgradeCommandRunsWithoutConsole(t *testing.T) {
	// Check the real Windows process, not only the startup flags. This tests
	// Go Agent -> Windows PowerShell as launched by the update transaction.
	script := `
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class XDriveConsoleProbe {
	[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
}
'@
if ([XDriveConsoleProbe]::GetConsoleWindow() -ne [IntPtr]::Zero) {
	throw "Windows updater PowerShell acquired a console"
}
	`
    path := filepath.Join(t.TempDir(), "console-probe.ps1")
    if err := os.WriteFile(path, []byte(script), 0o600); err != nil {
        t.Fatal(err)
    }
    if _, err := exec.LookPath("powershell.exe"); err != nil {
        t.Fatal(err)
    }
    cmd := newHiddenWindowsUpgradeCommand([]string{
        "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-WindowStyle", "Hidden", "-File", path,
    })
    output, err := cmd.CombinedOutput()
    if err != nil {
        t.Fatalf("headless Windows PowerShell acquired a console or failed: %v\n%s", err, output)
    }
}

func TestWindowsUpdateNativeCommandsStayHeadless(t *testing.T) {
    script := windowsUpgradeTransactionScript
    for _, required := range []string{
        "$startInfo.UseShellExecute = $false",
        "$startInfo.CreateNoWindow = $true",
        "$startInfo.RedirectStandardOutput = $true",
        "$startInfo.RedirectStandardError = $true",
        "Quote-WindowsNativeArgument",
        "Invoke-HiddenNativeProcess -FilePath \"robocopy.exe\"",
        "Invoke-HiddenNativeProcess -FilePath \"reg.exe\"",
        "Invoke-HiddenNativeProcess -FilePath $xd -ArgumentList @(\"version\")",
        "Invoke-HiddenNativeProcess -FilePath $xd -ArgumentList @(\"version\", \"--json\")",
    } {
        if !strings.Contains(script, required) {
            t.Fatalf("Windows transaction missing headless process contract %q", required)
        }
    }
    for _, forbidden := range []string{
        "& robocopy.exe", "& reg.exe", "& $xd version",
    } {
        if strings.Contains(script, forbidden) {
            t.Fatalf("Windows transaction still launches a native console: %q", forbidden)
        }
    }
}

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
		"& $LegacyCleanupScript -UnifiedAppDir $appDir",
		"last-known-good",
		"/DEFERLEGACYCLEANUP",
		"Start-AgentAndVerify",
		"Start-DesktopAndVerify",
		"Backup-RegistryState",
		"Restore-RegistryState",
		"last-known-good-startmenu",
		"Restore-LastKnownGood",
		"rolled_back",
		"Assert-VerifiedInstaller",
		"Get-AuthenticodeSignature",
		"Get-FileHash",
		"windowsPowerShellModules",
		"$env:PSModulePath",
		"ExpectedSHA256",
		"ExpectedSize",
		"HashMismatch",
	} {
		if !strings.Contains(string(transactionBody), marker) {
			t.Fatalf("transaction script missing %q", marker)
		}
	}
	if strings.Contains(string(transactionBody), "& powershell.exe") {
		t.Fatal("legacy cleanup must not launch a second PowerShell process")
	}
	// The first Security/Utility cmdlet may otherwise autoload pwsh 7's
	// incompatible module in a detached Windows PowerShell 5.1 child.
	// This bootstrap MUST run before the signing and rollback transaction.
	bootstrap := strings.Index(string(transactionBody), "$env:PSModulePath = $windowsPowerShellModules")
	transactionStart := strings.Index(string(transactionBody), "Write-Log \"begin update")
	if bootstrap < 0 || transactionStart < 0 || bootstrap >= transactionStart {
		t.Fatal("WindowsPowerShell built-in module path must be prioritized before installer verification")
	}
	if strings.Count(string(transactionBody), "function Assert-VerifiedInstaller") != 1 ||
		strings.Count(string(transactionBody), "Write-Log \"begin update") != 1 {
		t.Fatal("invalid duplicate Windows installer transaction or signature verifier")
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

func TestWindowsUpdateRefusesEqualLengthCorruptedPackage(t *testing.T) {
	data := []byte("verified Windows installer fixture")
	digest := sha256.Sum256(data)
	path := filepath.Join(t.TempDir(), "xDriveSetup-amd64.exe")
	bad := []byte(strings.Repeat("Z", len(data)))
	if err := os.WriteFile(path, bad, 0o600); err != nil {
		t.Fatal(err)
	}
	result := Result{
		Current: "0.1.0", Latest: "0.1.1",
		Asset: Asset{Name: filepath.Base(path), Size: int64(len(data)),
			Digest: "sha256:" + hex.EncodeToString(digest[:])},
	}
	if _, err := InstallPreviouslyVerified(t.Context(), path, result); err == nil {
		t.Fatal("equal-size corrupt package attempted Windows install")
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("rejected package path changed unexpectedly: %v", err)
	}
}
