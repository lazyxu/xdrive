package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDoctorRedaction(t *testing.T) {
	home, _ := os.UserHomeDir()
	in := home + string(os.PathSeparator) + "xDrive authorization: bearer abc123 refresh_token=secret"
	got := redactDoctorDetail(in)
	if strings.Contains(got, "abc123") || strings.Contains(got, "secret") {
		t.Fatalf("secret leaked: %q", got)
	}
	if home != "" && strings.Contains(got, filepath.Clean(home)) {
		t.Fatalf("home leaked: %q", got)
	}
}

func TestMaskDoctorUser(t *testing.T) {
	if got := maskDoctorUser("xuliang"); got != "xu***" {
		t.Fatalf("mask = %q", got)
	}
}
