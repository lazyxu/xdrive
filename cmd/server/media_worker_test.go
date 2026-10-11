package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMediaWorkerCLIGuards(t *testing.T) {
	t.Setenv("XD_MEDIA_WORKER_SOCKET", "")
	if err := runMediaWorkerCommand([]string{"serve"}); err == nil {
		t.Fatal("media worker accepted unset socket")
	}
	t.Setenv("XD_MEDIA_WORKER_SOCKET", "relative.sock")
	if err := runMediaWorkerCommand([]string{"check"}); err == nil {
		t.Fatal("media worker accepted relative socket")
	}
	t.Setenv("XD_MEDIA_WORKER_SOCKET", filepath.Join(t.TempDir(), "missing.sock"))
	if err := runMediaWorkerCommand([]string{"check"}); err == nil ||
		strings.Contains(err.Error(), os.Getenv("XD_MEDIA_WORKER_SOCKET")) {
		t.Fatalf("unavailable media worker did not fail without exposing host path: %v", err)
	}
	if err := runMediaWorkerCommand([]string{"serve", "--command", "cat"}); err == nil {
		t.Fatal("media worker accepted arbitrary commands")
	}
}
