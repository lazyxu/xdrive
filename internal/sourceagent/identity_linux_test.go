//go:build linux

package sourceagent

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRootFingerprintSurvivesPathRename(t *testing.T) {
	parent := t.TempDir()
	first := filepath.Join(parent, "photos")
	if err := os.Mkdir(first, 0o700); err != nil {
		t.Fatal(err)
	}
	before, err := RootFingerprint("shared", first)
	if err != nil {
		t.Fatal(err)
	}
	second := filepath.Join(parent, "photos-renamed")
	if err := os.Rename(first, second); err != nil {
		t.Fatal(err)
	}
	after, err := RootFingerprint("shared", second)
	if err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatalf("root fingerprint changed after rename: %q != %q", before, after)
	}
	if !strings.HasPrefix(before, "root:") {
		t.Fatalf("unexpected root fingerprint %q", before)
	}
}

func TestFilesystemIdentityKeepsPortableKeyAcrossRename(t *testing.T) {
	dir := t.TempDir()
	first := filepath.Join(dir, "a.jpg")
	if err := os.WriteFile(first, []byte("abc"), 0o600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Lstat(first)
	if err != nil {
		t.Fatal(err)
	}
	before, err := filesystemIdentity("shared", first, info)
	if err != nil {
		t.Fatal(err)
	}
	if before.LegacyExternalID == "" || before.WeakKey == "" {
		t.Fatalf("incomplete identity: %+v", before)
	}

	second := filepath.Join(dir, "renamed.jpg")
	if err := os.Rename(first, second); err != nil {
		t.Fatal(err)
	}
	info, err = os.Lstat(second)
	if err != nil {
		t.Fatal(err)
	}
	after, err := filesystemIdentity("shared", second, info)
	if err != nil {
		t.Fatal(err)
	}
	if before.WeakKey != after.WeakKey {
		t.Fatalf("weak key changed after rename: %q != %q", before.WeakKey, after.WeakKey)
	}
	if before.StrongKey != "" && before.StrongKey != after.StrongKey {
		t.Fatalf("strong key changed after rename: %q != %q", before.StrongKey, after.StrongKey)
	}
}

func TestFilesystemIdentityCanPreserveConfiguredLegacyDevice(t *testing.T) {
	file := filepath.Join(t.TempDir(), "a.jpg")
	if err := os.WriteFile(file, []byte("abc"), 0o600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Lstat(file)
	if err != nil {
		t.Fatal(err)
	}
	identity, err := filesystemIdentity("shared", file, info, 999999)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(identity.LegacyExternalID, "fs:shared:999999:") {
		t.Fatalf("legacy external id=%q", identity.LegacyExternalID)
	}
}
