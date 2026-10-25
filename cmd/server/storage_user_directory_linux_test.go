//go:build linux

package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRepairOneUserDirectoryTreeScopesChangesToDirectories(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "1", "docs", "nested")
	other := filepath.Join(root, "2", "docs")
	cas := filepath.Join(root, ".xdrive-blobs", "sha256", "aa")
	outside := t.TempDir()
	for _, d := range []string{target, other, cas} {
		if err := os.MkdirAll(d, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	content := filepath.Join(target, "original.bin")
	if err := os.WriteFile(content, []byte("original content"), 0o600); err != nil {
		t.Fatal(err)
	}
	before, err := os.Lstat(content)
	if err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "1", "external-link")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	locked := []string{filepath.Join(root, "1"), filepath.Join(root, "1", "docs"), target}
	for _, d := range locked {
		if err := os.Chmod(d, 0o500); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		for _, d := range locked {
			_ = os.Chmod(d, 0o700)
		}
	})
	// Preserve each unrelated directory's actual starting mode. Go's t.TempDir()
	// is not guaranteed to use 0700 on every test runner, and an absolute
	// mode assertion can report a change even when the repair never touched it.
	untouchedModes := make(map[string]os.FileMode, 3)
	for _, dir := range []string{other, cas, outside} {
		info, err := os.Stat(dir)
		if err != nil {
			t.Fatal(err)
		}
		untouchedModes[dir] = info.Mode().Perm()
	}
	uid, gid := os.Geteuid(), os.Getegid()
	preview, err := repairOneUserDirectoryTree(root, 1, uid, gid, false)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Applied || preview.ModeMismatches != 3 || preview.Directories != 3 ||
		preview.OwnerMismatches != 0 || preview.SymlinksSeen != 1 {
		t.Fatalf("unexpected dry-run report: %+v", preview)
	}
	if info, err := os.Stat(target); err != nil || info.Mode().Perm() != 0o500 {
		t.Fatalf("dry-run changed storage directory: %v %v", info, err)
	}
	applied, err := repairOneUserDirectoryTree(root, 1, uid, gid, true)
	if err != nil {
		t.Fatal(err)
	}
	if !applied.Applied || applied.ModeMismatches != 3 {
		t.Fatalf("unexpected repair report: %+v", applied)
	}
	for _, dir := range locked {
		if info, err := os.Stat(dir); err != nil || info.Mode().Perm()&0o700 != 0o700 {
			t.Fatalf("unrepaired user directory %q: %v, %v", dir, info, err)
		}
	}
	after, err := os.Lstat(content)
	if err != nil || !os.SameFile(before, after) || !before.ModTime().Equal(after.ModTime()) || before.Mode() != after.Mode() {
		t.Fatalf("original file was modified: before=%v after=%v err=%v", before, after, err)
	}
	if got, err := os.ReadFile(content); err != nil || string(got) != "original content" {
		t.Fatalf("original bytes changed: %q %v", got, err)
	}
	for _, untouched := range []string{other, cas, outside} {
		info, err := os.Stat(untouched)
		if err != nil || info.Mode().Perm() != untouchedModes[untouched] {
			t.Fatalf("non-target directory changed: %s, %v, %v", untouched, info, err)
		}
	}
	if info, err := os.Lstat(link); err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("link was modified: %v %v", info, err)
	}
}

func TestRepairOneUserDirectoryTreeRejectsSymlinksAndMissingScope(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "1")); err != nil {
		t.Fatal(err)
	}
	if _, err := repairOneUserDirectoryTree(root, 1, 65532, 65532, true); err == nil {
		t.Fatal("symlinked user root accepted")
	}
	if _, err := repairOneUserDirectoryTree(root, 0, 65532, 65532, true); err == nil {
		t.Fatal("zero user ID accepted")
	}
	symlinkRoot := filepath.Join(t.TempDir(), "linked")
	if err := os.Symlink(root, symlinkRoot); err != nil {
		t.Fatal(err)
	}
	if _, err := repairOneUserDirectoryTree(symlinkRoot, 1, 65532, 65532, true); err == nil {
		t.Fatal("symlinked storage root accepted")
	}
}
