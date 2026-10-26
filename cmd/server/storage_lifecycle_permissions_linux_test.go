//go:build linux

package main

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/lazyxu/xdrive/internal/storage"
	"golang.org/x/sys/unix"
)

func storageCurrentMarkerFixture(t *testing.T, root string) {
	t.Helper()
	staging := filepath.Join(root, storage.UploadStagingDir)
	if err := os.MkdirAll(staging, 0o700); err != nil {
		t.Fatal(err)
	}
	value := []byte(strconv.Itoa(os.Geteuid()) + ":" + strconv.Itoa(os.Getegid()) + "\n")
	for _, name := range []string{".ownership-v1", storageOwnershipMarker} {
		if err := os.WriteFile(filepath.Join(staging, name), value, 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestPrepareStorageRootRepairsAllPersistentLockFamilies(t *testing.T) {
	for _, relative := range []string{storage.TempLifecycleLockFile, filepath.Join(storage.CASLifecycleLockDir, "ab.lock"), filepath.Join(storage.LocalPushStageLifecycleLockDir, "ab.lock")} {
		t.Run(relative, func(t *testing.T) {
			root := t.TempDir()
			storageCurrentMarkerFixture(t, root)
			path := filepath.Join(root, relative)
			if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
				t.Fatal(err)
			}
			held, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
			if err != nil {
				t.Fatal(err)
			}
			defer held.Close()
			if err := unix.Flock(int(held.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
				t.Fatal(err)
			}
			defer unix.Flock(int(held.Fd()), unix.LOCK_UN)
			before, _ := held.Stat()
			if err := os.Chmod(path, 0); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = os.Chmod(path, 0o600) })
			if _, err := prepareStorageRoot(root, os.Geteuid(), os.Getegid(), false); err != nil {
				t.Fatal(err)
			}
			after, err := os.Stat(path)
			if err != nil || !os.SameFile(before, after) || after.Mode().Perm() != 0o600 || after.Size() != 0 {
				t.Fatalf("persistent lock metadata not repaired in place: info=%v err=%v", after, err)
			}
			probe, err := os.OpenFile(path, os.O_RDWR, 0)
			if err != nil {
				t.Fatal(err)
			}
			defer probe.Close()
			if err := unix.Flock(int(probe.Fd()), unix.LOCK_EX|unix.LOCK_NB); err == nil {
				_ = unix.Flock(int(probe.Fd()), unix.LOCK_UN)
				t.Fatal("existing held flock no longer fences the repaired inode")
			}
		})
	}
}

func TestPrepareStorageRootMigratesLegacyMarkerFileAccess(t *testing.T) {
	root := t.TempDir()
	staging := filepath.Join(root, storage.UploadStagingDir)
	cache := filepath.Join(root, ".xdrive-media", "thumbnails", "ab", "cached")
	for _, dir := range []string{staging, filepath.Dir(cache)} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	marker := []byte(strconv.Itoa(os.Geteuid()) + ":" + strconv.Itoa(os.Getegid()) + "\n")
	if err := os.WriteFile(filepath.Join(staging, ".ownership-v1"), marker, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cache, []byte("preserve cached bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	before, _ := os.Stat(cache)
	if err := os.Chmod(cache, 0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(cache, 0o600) })
	if _, err := prepareStorageRoot(root, os.Geteuid(), os.Getegid(), false); err != nil {
		t.Fatal(err)
	}
	after, _ := os.Stat(cache)
	if !os.SameFile(before, after) || after.Mode().Perm()&0o400 == 0 {
		t.Fatal("legacy marker bypassed full owner-read migration")
	}
	data, err := os.ReadFile(cache)
	if err != nil || string(data) != "preserve cached bytes" {
		t.Fatalf("cache bytes changed or inaccessible: %q %v", data, err)
	}
	if _, err := storage.NewLocal(root); err != nil {
		t.Fatal(err)
	}
}

func TestPrepareStorageRootRejectsUnsafePersistentLocks(t *testing.T) {
	for _, relative := range []string{storage.TempLifecycleLockFile, filepath.Join(storage.CASLifecycleLockDir, "ab.lock"), filepath.Join(storage.LocalPushStageLifecycleLockDir, "ab.lock")} {
		for _, kind := range []string{"nonempty", "symlink", "hardlink"} {
			t.Run(relative+"/"+kind, func(t *testing.T) {
				root := t.TempDir()
				storageCurrentMarkerFixture(t, root)
				path := filepath.Join(root, relative)
				if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
					t.Fatal(err)
				}
				external := filepath.Join(t.TempDir(), "external")
				if err := os.WriteFile(external, nil, 0o400); err != nil {
					t.Fatal(err)
				}
				var err error
				switch kind {
				case "nonempty":
					err = os.WriteFile(path, []byte("unexpected lock bytes"), 0o600)
				case "symlink":
					err = os.Symlink(external, path)
				case "hardlink":
					err = os.Link(external, path)
				}
				if err != nil {
					t.Fatal(err)
				}
				if _, err := prepareStorageRoot(root, os.Geteuid(), os.Getegid(), false); err == nil {
					t.Fatal("unsafe persistent lock was accepted")
				}
				if info, err := os.Stat(external); err != nil || info.Mode().Perm() != 0o400 || info.Size() != 0 {
					t.Fatalf("external link target changed: %v %v", info, err)
				}
			})
		}
	}
}

func TestPrepareStorageRootPreservesInternalPublicationHardlinks(t *testing.T) {
	root := t.TempDir()
	directory := filepath.Join(root, storage.ContentBlobDir, "sha256", "ab")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	temporary := filepath.Join(directory, ".xdrive-upload-interrupted")
	published := filepath.Join(directory, "abcdef")
	if err := os.WriteFile(temporary, []byte("committed CAS bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(temporary, published); err != nil {
		t.Fatal(err)
	}
	before, _ := os.Stat(published)
	if err := os.Chmod(published, 0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(published, 0o600) })
	if _, err := prepareStorageRoot(root, os.Geteuid(), os.Getegid(), false); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{temporary, published} {
		after, err := os.Stat(path)
		if err != nil || !os.SameFile(before, after) {
			t.Fatalf("publication inode changed: %v", err)
		}
		data, err := os.ReadFile(path)
		if err != nil || string(data) != "committed CAS bytes" {
			t.Fatalf("publication bytes changed: %q %v", data, err)
		}
	}
}

func TestPrepareStorageRootRejectsExternalPayloadHardlink(t *testing.T) {
	root := t.TempDir()
	external := filepath.Join(t.TempDir(), "external")
	if err := os.WriteFile(external, []byte("private bytes"), 0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(external, 0o600) })
	if err := os.Link(external, filepath.Join(root, "alias")); err != nil {
		t.Fatal(err)
	}
	if _, err := prepareStorageRoot(root, os.Geteuid(), os.Getegid(), true); err == nil {
		t.Fatal("unaccounted external alias was accepted")
	}
	if info, err := os.Stat(external); err != nil || info.Mode().Perm() != 0 {
		t.Fatalf("external permissions changed: %v %v", info, err)
	}
}

func TestStoragePermissionRepairRejectsReplacedPath(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "entry")
	if err := os.WriteFile(path, nil, 0); err != nil {
		t.Fatal(err)
	}
	before, _ := os.Lstat(path)
	external := filepath.Join(t.TempDir(), "external")
	if err := os.WriteFile(external, nil, 0o400); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(path, filepath.Join(root, "held")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(external, path); err != nil {
		t.Fatal(err)
	}
	err := repairStorageEntryAccess(root, path, before, os.Geteuid(), os.Getegid(), 0o600)
	if err == nil {
		t.Error("replaced path was accepted")
	}
	if info, err := os.Stat(external); err != nil || info.Mode().Perm() != 0o400 {
		t.Errorf("external target permissions changed: %v %v", info, err)
	}
}

func TestStoragePermissionRepairPinsBeforePathReplacement(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "entry")
	if err := os.WriteFile(path, nil, 0); err != nil {
		t.Fatal(err)
	}
	before, _ := os.Lstat(path)
	external := filepath.Join(t.TempDir(), "external")
	if err := os.WriteFile(external, nil, 0o400); err != nil {
		t.Fatal(err)
	}
	held := filepath.Join(root, "held")
	err := withPinnedStorageEntry(root, path, before, func(file *os.File, _ os.FileInfo) error {
		if err := os.Rename(path, held); err != nil {
			return err
		}
		if err := os.Symlink(external, path); err != nil {
			return err
		}
		return setStorageFileMode(file, 0o600)
	})
	if err == nil {
		t.Error("path replacement was not reported")
	}
	if info, err := os.Stat(external); err != nil || info.Mode().Perm() != 0o400 {
		t.Errorf("external target changed: %v %v", info, err)
	}
	if info, err := os.Stat(held); err != nil || info.Mode().Perm() != 0o600 {
		t.Errorf("metadata did not use original descriptor: %v %v", info, err)
	}
}

func TestStorageOwnershipMarkerRejectsExternalStaging(t *testing.T) {
	root := t.TempDir()
	external := t.TempDir()
	if err := os.Symlink(external, filepath.Join(root, storage.UploadStagingDir)); err != nil {
		t.Fatal(err)
	}
	if err := writeStorageOwnershipMarker(root, "1000:1000", os.Geteuid(), os.Getegid()); err == nil {
		t.Fatal("external staging was accepted")
	}
	entries, err := os.ReadDir(external)
	if err != nil || len(entries) != 0 {
		t.Fatalf("marker wrote outside storage root: %v %v", entries, err)
	}
}

// Run in a disposable Docker container with separate nested tmpfs/bind mounts
// beneath TMPDIR. Ordinary package tests must not create mounts or require root.
func TestPrepareStorageRootRejectsForeignDeviceFastPath(t *testing.T) {
	base := os.Getenv("XDRIVE_STORAGE_DEVICE_FIXTURES")
	if base == "" {
		t.Skip("requires isolated nested Docker mount fixtures")
	}
	cases := []struct{ name, relative string }{
		{"staging", storage.UploadStagingDir},
		{"cas", storage.ContentBlobDir},
		{"media", ".xdrive-media"},
		{"cas-locks", storage.CASLifecycleLockDir},
		{"stage-locks", storage.LocalPushStageLifecycleLockDir},
		{"singleton", storage.TempLifecycleLockFile},
	}
	for _, fixture := range cases {
		t.Run(fixture.name, func(t *testing.T) {
			root := filepath.Join(base, fixture.name)
			storageCurrentMarkerFixture(t, root)
			path := filepath.Join(root, fixture.relative)
			rootInfo, err := os.Lstat(root)
			if err != nil {
				t.Fatal(err)
			}
			before, err := os.Lstat(path)
			if err != nil {
				t.Fatal(err)
			}
			if validateStorageSameDevice(rootInfo, before) == nil {
				t.Fatal("fixture is not a separate filesystem")
			}
			mode := os.FileMode(0o400)
			if before.IsDir() {
				mode = 0o500
			}
			if err := os.Chmod(path, mode); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if before.IsDir() {
					_ = os.Chmod(path, 0o700)
				} else {
					_ = os.Chmod(path, 0o600)
				}
			})
			if _, err := prepareStorageRoot(root, os.Geteuid(), os.Getegid(), false); err == nil {
				t.Error("foreign filesystem was accepted")
			}
			after, err := os.Lstat(path)
			if err != nil || !os.SameFile(before, after) || after.Mode().Perm() != mode {
				t.Errorf("foreign metadata changed: %v %v", after, err)
			}
		})
	}
}
