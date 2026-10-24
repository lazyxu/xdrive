//go:build linux

package caddyhostidentity

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestHostSnapshotRejectsSymlinksHardlinksAndWritablePaths(t *testing.T) {
	home := t.TempDir()
	if !privateHostSnapshotPathSafe(home, true, false) {
		t.Fatal("owned secure host directory rejected")
	}
	file := filepath.Join(home, "private.env")
	if err := os.WriteFile(file, []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	if !privateHostSnapshotPathSafe(file, false, true) {
		t.Fatal("secure file rejected")
	}
	link := filepath.Join(home, "symlink.env")
	if err := os.Symlink(file, link); err != nil {
		t.Fatal(err)
	}
	if privateHostSnapshotPathSafe(link, false, true) {
		t.Fatal("symlink accepted")
	}
	alias := filepath.Join(home, "hardlink.env")
	if err := os.Link(file, alias); err != nil {
		t.Fatal(err)
	}
	if privateHostSnapshotPathSafe(file, false, true) {
		t.Fatal("multi-linked Host file accepted")
	}
	if err := os.Remove(alias); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(file, 0660); err != nil {
		t.Fatal(err)
	}
	if privateHostSnapshotPathSafe(file, false, true) {
		t.Fatal("group-writable Host file accepted")
	}
	if err := os.Chmod(file, 0600); err != nil {
		t.Fatal(err)
	}
	if !privateHostSnapshotPathSafe(file, false, true) {
		t.Fatal("fixed Host permissions rejected")
	}
	if err := os.Chmod(home, 0770); err != nil {
		t.Fatal(err)
	}
	if privateHostSnapshotPathSafe(home, true, false) {
		t.Fatal("group-writable installation dir accepted")
	}
}

func TestHostSnapshotRunnerFailsBeforeInvokingUnsafeInstallation(t *testing.T) {
	ctx := context.Background()
	for _, root := range []string{"", ".", "/nonexistent-xdrive-host-namespace"} {
		if v, err := privateRunFixedHostSnapshot(ctx, root); err == nil || v != nil {
			t.Fatal("unsafe Host location allowed")
		}
	}
	ctx, cancel := context.WithCancel(ctx)
	cancel()
	if v, err := privateRunFixedHostSnapshot(ctx, t.TempDir()); err == nil || v != nil {
		t.Fatal("cancelled Host observation allowed")
	}
}
