//go:build linux

package caddyhostidentity

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHostFileEpochRejectsAtomicallyRestoredSameContent(t *testing.T) {
	home := t.TempDir()
	env := filepath.Join(home, ".env")
	if err := os.WriteFile(env, []byte("XD_DOMAIN=current.example.test\n"), 0600); err != nil {
		t.Fatal(err)
	}
	first, err := privateHostEnvFileEpoch(env)
	if err != nil || !validDigest(first) {
		t.Fatal("first Host inode unreadable", err)
	}
	// Simulate Caddy Save A→B→A: the exact A bytes are restored using
	// the real Host's atomic-file replacement behavior.
	backup := filepath.Join(home, ".env.next")
	if err := os.WriteFile(backup, []byte("XD_DOMAIN=current.example.test\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(backup, env); err != nil {
		t.Fatal(err)
	}
	second, err := privateHostEnvFileEpoch(env)
	if err != nil || first == second {
		t.Fatal("Host atomic replace reused the old source epoch", err)
	}
}

func TestHostFileEpochRejectsUnsafeAndMutatedFile(t *testing.T) {
	home := t.TempDir()
	env := filepath.Join(home, ".env")
	if err := os.WriteFile(env, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := privateHostEnvFileEpoch(env); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(env, []byte("mutated"), 0600); err != nil {
		t.Fatal(err)
	}
	// The same inode was modified; its ctime/mtime and size must change.
	changed, err := privateHostEnvFileEpoch(env)
	if err != nil || !validDigest(changed) {
		t.Fatal("valid changed epoch rejected", err)
	}
	link := filepath.Join(home, "alias")
	if err := os.Link(env, link); err != nil {
		t.Fatal(err)
	}
	if _, err := privateHostEnvFileEpoch(env); err == nil {
		t.Fatal("hardlink was accepted")
	}
	if err := os.Remove(link); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(env, 0660); err != nil {
		t.Fatal(err)
	}
	if _, err := privateHostEnvFileEpoch(env); err == nil {
		t.Fatal("group writable file was accepted")
	}
}

func TestFencedHostSnapshotRejectsUnsoundHome(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if raw, epoch, err := privateRunFencedHostSnapshot(ctx, t.TempDir()); err == nil || raw != nil || epoch != "" {
		t.Fatal("cancelled Host source read was accepted")
	}
	if raw, epoch, err := privateRunFencedHostSnapshot(context.Background(), strings.Repeat("not-absolute", 2)); err == nil || raw != nil || epoch != "" {
		t.Fatal("relative untrusted Host path was accepted")
	}
}
