//go:build linux

package api

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCaddyHostAdmissionCrossReplicaAndNoFollow(t *testing.T) {
	dir := t.TempDir()
	release, err := caddyHostAdmissionLock(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := caddyHostAdmissionLock(dir); err == nil {
		t.Fatal("two Server replicas simultaneously acquired one Host admission")
	}
	release()
	release, err = caddyHostAdmissionLock(dir)
	if err != nil {
		t.Fatal(err)
	}
	release()
	p := filepath.Join(dir, "caddy-env-admission.lock")
	if err := os.Remove(p); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(dir, "outside")
	if err := os.Symlink(outside, p); err != nil {
		t.Fatal(err)
	}
	if _, err := caddyHostAdmissionLock(dir); err == nil {
		t.Fatal("followed malicious admission symlink")
	}
	if _, err := os.Stat(outside); !os.IsNotExist(err) {
		t.Fatal("admission lock symlink wrote outside target", err)
	}
}
