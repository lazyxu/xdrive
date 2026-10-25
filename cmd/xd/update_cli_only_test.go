package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPortableCLIOnlyDistributionRequiresSiblingAgentAndNoDesktop(t *testing.T) {
	dir := t.TempDir()
	xd := filepath.Join(dir, "xd")
	agent := filepath.Join(dir, "xdrive-agent")
	desktop := filepath.Join(dir, "xdrive-desktop")
	if err := os.WriteFile(xd, []byte("xd"), 0o700); err != nil {
		t.Fatal(err)
	}
	if portableCLIOnlyDistribution(xd, "linux") {
		t.Fatal("xd without the original Agent is not a confirmed CLI-only pair")
	}
	if err := os.WriteFile(agent, []byte("agent"), 0o700); err != nil {
		t.Fatal(err)
	}
	if !portableCLIOnlyDistribution(xd, "linux") {
		t.Fatal("paired portable Go binaries were not recognized as CLI-only")
	}
	if err := requireExistingDesktopDistribution(xd, "linux"); err == nil {
		t.Fatal("standalone CLI-only pair allowed Desktop installer")
	}
	if err := os.WriteFile(desktop, []byte("desktop"), 0o700); err != nil {
		t.Fatal(err)
	}
	if portableCLIOnlyDistribution(xd, "linux") {
		t.Fatal("installed Desktop package incorrectly classified as CLI-only")
	}
	if err := requireExistingDesktopDistribution(xd, "linux"); err != nil {
		t.Fatalf("existing Desktop distribution was not recognized: %v", err)
	}
}

func TestWindowsFullDesktopNestedExecutableIsNotMistakenForCLIOnly(t *testing.T) {
	dir := t.TempDir()
	xd := filepath.Join(dir, "xd.exe")
	agent := filepath.Join(dir, "xdrive-agent.exe")
	desktopDir := filepath.Join(dir, "desktop")
	if err := os.MkdirAll(desktopDir, 0o700); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{xd, agent, filepath.Join(desktopDir, "xdrive-desktop.exe")} {
		if err := os.WriteFile(path, []byte("fixture"), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	if portableCLIOnlyDistribution(xd, "windows") {
		t.Fatal("Windows full Desktop installation with desktop/ subdirectory was misclassified as CLI-only")
	}
	if err := requireExistingDesktopDistribution(xd, "windows"); err != nil {
		t.Fatalf("Windows packaged nested Desktop executable was rejected: %v", err)
	}
	if err := os.Remove(filepath.Join(desktopDir, "xdrive-desktop.exe")); err != nil {
		t.Fatal(err)
	}
	if !portableCLIOnlyDistribution(xd, "windows") {
		t.Fatal("Windows original xd + Agent ZIP pair was not recognized as CLI-only")
	}
	if err := requireExistingDesktopDistribution(xd, "windows"); err == nil {
		t.Fatal("Windows standalone ZIP was permitted to launch NSIS Desktop installer")
	}
}

func TestCLIOnlyInstallCannotLaunchDesktopInstaller(t *testing.T) {
	for _, tc := range []struct {
		install bool
		cliOnly bool
		allowed bool
	}{
		{false, false, true},
		{false, true, true},
		{true, false, true}, // an existing Desktop has its own gated installer
		{true, true, false}, // explicit or detected CLI-only: never launch GUI
	} {
		err := rejectCLIOnlyInstall(tc.install, tc.cliOnly)
		if (err == nil) != tc.allowed {
			t.Fatalf("install=%v cliOnly=%v: %v", tc.install, tc.cliOnly, err)
		}
		if !tc.allowed && !strings.Contains(err.Error(), "no Desktop installer") {
			t.Fatalf("unsafe error guidance: %v", err)
		}
	}
}
