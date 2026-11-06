//go:build linux

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSourceAgentRunLockSerializesScheduledInvocations(t *testing.T) {
	dir := t.TempDir()
	releaseFirst, acquired, err := lockSourceAgentRun(dir)
	if err != nil || !acquired || releaseFirst == nil {
		t.Fatalf("first lock acquired=%v release=%v err=%v", acquired, releaseFirst != nil, err)
	}
	defer releaseFirst()

	releaseSecond, secondAcquired, err := lockSourceAgentRun(dir)
	if err != nil || secondAcquired || releaseSecond != nil {
		t.Fatalf("second run must not acquire lock: acquired=%v err=%v", secondAcquired, err)
	}
	info, err := os.Stat(filepath.Join(dir, "run.lock"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("run lock permissions=%#o want 0600", info.Mode().Perm())
	}

	releaseFirst()
	releaseAfter, reacquired, err := lockSourceAgentRun(dir)
	if err != nil || !reacquired || releaseAfter == nil {
		t.Fatalf("lock cannot be reacquired after prior run: acquired=%v err=%v", reacquired, err)
	}
	releaseAfter()
}

func TestSourceAgentRunLockDoesNotCoupleIndependentConfigurations(t *testing.T) {
	base := t.TempDir()
	releaseA, a, err := lockSourceAgentRun(filepath.Join(base, "one"))
	if err != nil || !a {
		t.Fatalf("first config: acquired=%v err=%v", a, err)
	}
	defer releaseA()
	releaseB, b, err := lockSourceAgentRun(filepath.Join(base, "two"))
	if err != nil || !b {
		t.Fatalf("independent config: acquired=%v err=%v", b, err)
	}
	defer releaseB()
}

func TestSourceAgentSetupCannotChangeRootsDuringScheduledRun(t *testing.T) {
	base := t.TempDir()
	configDir := filepath.Join(base, "config")
	t.Setenv("XD_SOURCE_AGENT_CONFIG_DIR", configDir)
	release, acquired, err := lockSourceAgentRun(configDir)
	if err != nil || !acquired || release == nil {
		t.Fatalf("scheduled run lock: acquired=%v err=%v", acquired, err)
	}
	locked := true
	defer func() {
		if locked {
			release()
		}
	}()

	// The missing root would normally fail validation. Setup must first
	// reject the active scan, before reading or changing roots, credentials
	// or the bound Source on the server.
	missingRoot := filepath.Join(base, "missing-photos")
	for _, mode := range []string{"scan", "sync"} {
		err := setup([]string{"--shared", missingRoot, "--mode", mode})
		if err == nil || !strings.Contains(err.Error(), "already running") {
			t.Fatalf("setup mode=%s while scanning: got %v; want busy rejection", mode, err)
		}
	}
	if _, err := os.Stat(filepath.Join(configDir, "config.json")); !os.IsNotExist(err) {
		t.Fatalf("setup mutated configuration during active scan: %v", err)
	}

	release()
	locked = false
	// The setup lock has been released. Normal root validation must run;
	// it must not remain stuck in an already-running state after a scan.
	err = setup([]string{"--shared", missingRoot, "--mode", "scan"})
	if err == nil || !strings.Contains(err.Error(), "shared root:") {
		t.Fatalf("setup after scan released lock: got %v; want root validation", err)
	}
	unlockAgain, reacquired, err := lockSourceAgentRun(configDir)
	if err != nil || !reacquired || unlockAgain == nil {
		t.Fatalf("setup leaked scheduled run lock: acquired=%v err=%v", reacquired, err)
	}
	unlockAgain()
}
