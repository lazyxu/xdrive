package main

import (
	"os"
	"strings"
	"testing"
)

func TestUpgradePlanCLIRequiresIndependentTrust(t *testing.T) {
	dir := t.TempDir()
	for _, args := range [][]string{
		{"plan", "--dir", dir},
		{"plan", "--dir", dir, "--no-start"},
		{"plan", "--dir", dir, "--update-source", "xdrive"},
		{"plan", "--dir", dir, "--backup-file-data"},
	} {
		if err := run(args); err == nil {
			t.Fatalf("unsafe plan arguments accepted: %v", args)
		}
	}
}

func TestUpgradePlanCLIRejectsForgedSignedInputs(t *testing.T) {
	dir := t.TempDir()
	hash := strings.Repeat("a", 64)
	for _, args := range [][]string{
		{"plan", "--dir", dir, "--trusted-manifest-sha256", hash, "--signed-delivery"},
		{"plan", "--dir", dir, "--trusted-manifest-sha256", hash, "--trusted-installer-sha256", hash},
		{"plan", "--dir", dir, "--trusted-manifest-sha256", hash, "--signed-delivery", "--trusted-installer-sha256", hash},
	} {
		if err := run(args); err == nil {
			t.Fatalf("incomplete or mixed signed preview admitted: %v", args)
		}
	}
	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("read-only plan unexpectedly altered candidate dir: %v", err)
	}
}
