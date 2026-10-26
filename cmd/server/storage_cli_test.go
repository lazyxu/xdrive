package main

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

func TestStorageCLIErrorKeepsStdoutClean(t *testing.T) {
	const helperEnv = "XD_TEST_STORAGE_CLI_ERROR_HELPER"
	if os.Getenv(helperEnv) == "1" {
		os.Args = []string{"xdrive-server", "storage", "verify", "--json", "--mode", "invalid"}
		main()
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestStorageCLIErrorKeepsStdoutClean$")
	cmd.Env = append(os.Environ(), helperEnv+"=1")
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	err := cmd.Run()
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) || exitErr.ExitCode() != 1 {
		t.Fatalf("storage CLI exit: %v; stdout=%q stderr=%q", err, stdout.String(), stderr.String())
	}
	if stdout.Len() != 0 {
		t.Fatalf("storage CLI error polluted stdout: %q", stdout.String())
	}
	if !strings.Contains(stderr.String(), "unknown storage verify mode") {
		t.Fatalf("missing storage CLI error on stderr: %q", stderr.String())
	}
}
