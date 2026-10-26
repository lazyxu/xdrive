//go:build linux

package main

import (
	"os"
	"path/filepath"
	"strconv"
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

func TestPrepareStorageRootRepairsCASParentsWithCurrentMarker(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("tests readability of canonical parents as an unprivileged user")
	}

	root := t.TempDir()
	staging := filepath.Join(root, ".xdrive-uploads")
	cas := filepath.Join(root, ".xdrive-blobs")
	sha := filepath.Join(cas, "sha256")
	shard := filepath.Join(sha, "ab")
	unrelated := filepath.Join(root, "legacy-unrelated")
	for _, dir := range []string{staging, shard, unrelated} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	blob := filepath.Join(shard, "abcdef")
	if err := os.WriteFile(blob, []byte("immutable-bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	blobBefore, err := os.Stat(blob)
	if err != nil {
		t.Fatal(err)
	}
	uid, gid := os.Geteuid(), os.Getegid()
	if err := os.WriteFile(filepath.Join(staging, storageOwnershipMarker),
		[]byte(strconv.Itoa(uid)+":"+strconv.Itoa(gid)+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	// A valid staging marker used to skip this CAS directory: owner can traverse
	// but not ReadDir, exactly the kind of failure the backup verifier sees.
	for _, dir := range []string{cas, sha, shard} {
		if err := os.Chmod(dir, 0o100); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Chmod(unrelated, 0o100); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for _, dir := range []string{unrelated, cas, sha, shard} {
			_ = os.Chmod(dir, 0o700)
		}
	})
	if _, err := os.ReadDir(cas); err == nil {
		t.Fatal("test setup: CAS root was unexpectedly readable")
	}

	if _, err := prepareStorageRoot(root, uid, gid, false); err != nil {
		t.Fatal(err)
	}
	for _, dir := range []string{cas, sha, shard} {
		info, err := os.Stat(dir)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm()&0o700 != 0o700 {
			t.Fatalf("canonical CAS parent %s not repaired: %s", dir, info.Mode())
		}
	}
	if _, err := os.ReadDir(cas); err != nil {
		t.Fatalf("backup cannot enumerate CAS root: %v", err)
	}
	got, err := os.ReadFile(blob)
	if err != nil || string(got) != "immutable-bytes" {
		t.Fatalf("immutable blob changed or unreadable: %q, %v", got, err)
	}
	blobAfter, err := os.Stat(blob)
	if err != nil {
		t.Fatal(err)
	}
	if !blobAfter.ModTime().Equal(blobBefore.ModTime()) {
		t.Fatal("CAS repair changed immutable blob modification time")
	}
	other, err := os.Stat(unrelated)
	if err != nil {
		t.Fatal(err)
	}
	if other.Mode().Perm() != 0o100 {
		t.Fatalf("bounded repair changed unrelated directory: %#o", other.Mode().Perm())
	}
}

func TestPrepareStorageRootRefusesSymlinkedCASParent(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("tests nonroot CAS path admission")
	}
	root := t.TempDir()
	external := t.TempDir()
	staging := filepath.Join(root, ".xdrive-uploads")
	if err := os.MkdirAll(staging, 0o700); err != nil {
		t.Fatal(err)
	}
	uid, gid := os.Geteuid(), os.Getegid()
	if err := os.WriteFile(filepath.Join(staging, storageOwnershipMarker),
		[]byte(strconv.Itoa(uid)+":"+strconv.Itoa(gid)+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(external, filepath.Join(root, ".xdrive-blobs")); err != nil {
		t.Fatal(err)
	}
	if _, err := prepareStorageRoot(root, uid, gid, false); err == nil {
		t.Fatal("symlinked CAS parent was accepted")
	}
	if info, err := os.Lstat(external); err != nil || !info.IsDir() {
		t.Fatalf("external destination was changed: %v", err)
	}
}

func TestPrepareStorageRootRepairsCASLifecycleLockInodesWithCurrentMarker(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("exercises inaccessible CAS locks as a non-root Server UID")
	}
	root := t.TempDir()
	staging := filepath.Join(root, ".xdrive-uploads")
	lockDir := filepath.Join(root, ".xdrive-cas-lifecycle-locks")
	if err := os.MkdirAll(staging, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(lockDir, 0o700); err != nil {
		t.Fatal(err)
	}
	uid, gid := os.Geteuid(), os.Getegid()
	if err := os.WriteFile(filepath.Join(staging, storageOwnershipMarker),
		[]byte(strconv.Itoa(uid)+":"+strconv.Itoa(gid)+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	lockFile := filepath.Join(lockDir, "ab.lock")
	if err := os.WriteFile(lockFile, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	before, err := os.Lstat(lockFile)
	if err != nil {
		t.Fatal(err)
	}
	// This malformed-but-zero-byte sibling is not an actual shard lock and
	// must not be modified or silently accepted as an internal lock inode.
	unmanaged := filepath.Join(lockDir, "gg.lock")
	if err := os.WriteFile(unmanaged, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(unmanaged, 0o100); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(lockFile, 0o000); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(lockDir, 0o100); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = os.Chmod(lockDir, 0o700)
		_ = os.Chmod(lockFile, 0o600)
		_ = os.Chmod(unmanaged, 0o600)
	})
	if _, err := os.ReadDir(lockDir); err == nil {
		t.Fatal("fixture CAS lock directory unexpectedly readable")
	}
	if _, err := prepareStorageRoot(root, uid, gid, false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.ReadDir(lockDir); err != nil {
		t.Fatalf("offline backup still cannot enumerate CAS locks: %v", err)
	}
	after, err := os.Lstat(lockFile)
	if err != nil {
		t.Fatal(err)
	}
	if !os.SameFile(before, after) {
		t.Fatal("CAS lock inode was replaced; cross-process flock coordination may be lost")
	}
	if after.Mode().Perm() != 0o600 || after.Size() != 0 {
		t.Fatalf("CAS shard lock owner access/content changed unexpectedly: %s size=%d", after.Mode(), after.Size())
	}
	lockDirInfo, err := os.Stat(lockDir)
	if err != nil {
		t.Fatal(err)
	}
	if lockDirInfo.Mode().Perm()&0o700 != 0o700 {
		t.Fatalf("CAS lock directory still lacks owner rwx: %s", lockDirInfo.Mode())
	}
	unmanagedInfo, err := os.Lstat(unmanaged)
	if err != nil {
		t.Fatal(err)
	}
	if unmanagedInfo.Mode().Perm() != 0o100 {
		t.Fatalf("noncanonical lookalike lock was changed: %s", unmanagedInfo.Mode())
	}
	if _, err := os.Stat(filepath.Join(lockDir, "ff.lock")); !os.IsNotExist(err) {
		t.Fatalf("missing shard lock was created by repair: %v", err)
	}
}

func TestPrepareStorageRootRejectsUnsafeCASLifecycleLocks(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("exercises symlink and malformed CAS locks as a non-root user")
	}
	for _, tc := range []struct{ name, kind string }{
		{"directory symlink", "directory-symlink"},
		{"shard symlink", "shard-symlink"},
		{"nonempty shard lock", "nonempty"},
		{"nonfile shard lock", "directory"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			external := t.TempDir()
			staging := filepath.Join(root, ".xdrive-uploads")
			locks := filepath.Join(root, ".xdrive-cas-lifecycle-locks")
			if err := os.MkdirAll(staging, 0o700); err != nil {
				t.Fatal(err)
			}
			uid, gid := os.Geteuid(), os.Getegid()
			if err := os.WriteFile(filepath.Join(staging, storageOwnershipMarker),
				[]byte(strconv.Itoa(uid)+":"+strconv.Itoa(gid)+"\n"), 0o600); err != nil {
				t.Fatal(err)
			}
			if tc.kind == "directory-symlink" {
				if err := os.Symlink(external, locks); err != nil {
					t.Fatal(err)
				}
			} else {
				if err := os.MkdirAll(locks, 0o700); err != nil {
					t.Fatal(err)
				}
				shard := filepath.Join(locks, "00.lock")
				switch tc.kind {
				case "shard-symlink":
					if err := os.Symlink(external, shard); err != nil {
						t.Fatal(err)
					}
				case "nonempty":
					if err := os.WriteFile(shard, []byte("not a lock"), 0o600); err != nil {
						t.Fatal(err)
					}
				case "directory":
					if err := os.MkdirAll(shard, 0o700); err != nil {
						t.Fatal(err)
					}
				}
			}
			if _, err := prepareStorageRoot(root, uid, gid, false); err == nil {
				t.Fatalf("unsafe CAS lifecycle lock %s was accepted", tc.kind)
			}
			if info, err := os.Stat(external); err != nil || !info.IsDir() {
				t.Fatalf("symlink target was changed: %v", err)
			}
		})
	}
}
