//go:build linux

package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPrepareStorageRootRepairsWritableDirectories(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("this test verifies owner permission bits as an unprivileged process")
	}

	root := t.TempDir()
	staging := filepath.Join(root, ".xdrive-uploads")
	nested := filepath.Join(root, "1", "docs")
	// Build the legacy tree while it is writable, then remove owner write
	// permission. MkdirAll with 0500 would make the intermediate directory
	// non-writable before it can create its child, which tests setup rather
	// than storage repair.
	if err := os.MkdirAll(staging, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(nested, 0o700); err != nil {
		t.Fatal(err)
	}
	locked := []string{staging, filepath.Dir(nested), nested, root}
	for _, dir := range locked {
		if err := os.Chmod(dir, 0o500); err != nil {
			t.Fatal(err)
		}
	}
	defer func() {
		for i := len(locked) - 1; i >= 0; i-- {
			_ = os.Chmod(locked[i], 0o700)
		}
	}()

	uid, gid := os.Geteuid(), os.Getegid()
	if _, err := prepareStorageRoot(root, uid, gid, true); err != nil {
		t.Fatal(err)
	}

	for _, dir := range []string{root, staging, nested} {
		info, err := os.Stat(dir)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm()&0o700 != 0o700 {
			t.Fatalf("%s mode=%#o; owner rwx bits were not repaired", dir, info.Mode().Perm())
		}
	}
	if err := os.WriteFile(filepath.Join(nested, "probe"), []byte("ok"), 0o600); err != nil {
		t.Fatalf("repaired directory is not writable: %v", err)
	}
}
