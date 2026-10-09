//go:build linux || windows

package localpush

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
)

func TestRootGrantRequiresNativeDirectoryAndPersistentIdentity(t *testing.T) {
	home := t.TempDir()
	root := filepath.Join(home, "Photos")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	deviceID := uuid.NewString()
	grant, err := PrepareRootGrant("https://example.test", "alice", 42, deviceID, root)
	if err != nil {
		t.Fatal(err)
	}
	if grant.RootID == "" || grant.Fingerprint == "" || grant.Path != root {
		t.Fatalf("unexpected local root grant: %+v", grant)
	}
	registry := filepath.Join(home, "registry")
	if err := SaveRootGrant(registry, grant); err != nil {
		t.Fatal(err)
	}
	read, err := LoadRootGrant(registry, grant.Server, grant.Account, grant.RootID)
	if err != nil {
		t.Fatal(err)
	}
	if read.RootID != grant.RootID || read.Fingerprint != grant.Fingerprint ||
		read.StrongIdentity != grant.StrongIdentity {
		t.Fatal("persisted root grant identity did not roundtrip")
	}
	if err := SaveRootGrant(registry, grant); err == nil {
		t.Fatal("existing Root grant was overwritten")
	}
	if _, err := LoadRootGrant(registry, grant.Server, "bob", grant.RootID); err == nil {
		t.Fatal("Root grant crossed account scope")
	}
	if err := os.Rename(root, filepath.Join(home, "OldPhotos")); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadRootGrant(registry, grant.Server, grant.Account, grant.RootID); !errors.Is(err, ErrRootChanged) {
		t.Fatalf("replaced root must fail closed: %v", err)
	}
	if err := RemoveRootGrant(registry, grant.Server, grant.Account, grant.RootID); err != nil {
		t.Fatal(err)
	}
}

func TestRootGrantRejectsSymlinkAndFile(t *testing.T) {
	home := t.TempDir()
	f := filepath.Join(home, "photo.jpg")
	if err := os.WriteFile(f, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := PrepareRootGrant("https://example.test", "alice", 1, uuid.NewString(), f); !errors.Is(err, ErrUnsafeRoot) {
		t.Fatalf("regular file must not be selected as root: %v", err)
	}
	root := filepath.Join(home, "root")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(home, "shortcut")
	if err := os.Symlink(root, link); err == nil {
		if _, err := PrepareRootGrant("https://example.test", "alice", 1, uuid.NewString(), link); !errors.Is(err, ErrUnsafeRoot) {
			t.Fatalf("symlink must not be followed as an authorized root: %v", err)
		}
	}
	if _, err := PrepareRootGrant("https://example.test", "alice", 1, uuid.NewString(), "relative"); !errors.Is(err, ErrUnsafeRoot) {
		t.Fatalf("relative root path must not be accepted: %v", err)
	}
}
