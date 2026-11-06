//go:build linux

package main

import (
	"os"
	"path/filepath"
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
