package main

import "testing"

func TestOfflineHostProbeOnlyAvailableForAuthenticatedPlan(t *testing.T) {
	dir := t.TempDir()
	for _, args := range [][]string{
		{"list", "--dir", dir, "--probe-host"},
		{"verify", "--dir", dir, "--probe-host"},
		{"install", "--dir", dir, "--probe-host"},
		{"plan", "--dir", dir, "--probe-host"},
	} {
		if err := run(args); err == nil {
			t.Fatalf("untrusted or incorrect Host probe operation accepted: %v", args)
		}
	}
	// --workdir is not a general read/write escape for the plan operation.
	if err := run([]string{"plan", "--dir", dir, "--workdir", dir}); err == nil {
		t.Fatal("workdir override without --probe-host was accepted")
	}
}
