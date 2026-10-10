//go:build linux || windows

package localpush

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
)

func scanIdentities(t *testing.T, grant RootGrant, collect bool) map[string]InventoryItem {
	t.Helper()
	found := map[string]InventoryItem{}
	summary, err := (InventoryScanner{CollectIdentity: collect, BatchSize: 2}).ScanInventory(
		context.Background(), grant, func(batch []InventoryItem) error {
			if len(batch) > 2 {
				t.Fatalf("scanner overran identity batch limit: %d", len(batch))
			}
			for _, item := range batch {
				found[item.Path] = item
			}
			return nil
		})
	if err != nil || !summary.Complete || summary.MissingInferenceSafe {
		t.Fatalf("inventory must finish without deletion evidence: %v %+v", err, summary)
	}
	return found
}

func TestInventoryNativeIdentityRenameAndHardLinkAmbiguity(t *testing.T) {
	root := filepath.Join(t.TempDir(), "backup")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	write := func(name string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(root, name), []byte(name), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write("original.txt")
	write("other.txt")
	if err := os.Link(filepath.Join(root, "original.txt"),
		filepath.Join(root, "second-name.txt")); err != nil {
		t.Skipf("hard links unsupported in test filesystem: %v", err)
	}
	grant, err := PrepareRootGrant("https://local.test", "alice", 42,
		uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	plain := scanIdentities(t, grant, false)
	for _, item := range plain {
		if item.Identity != nil {
			t.Fatal("default metadata scanner unexpectedly collected native file IDs")
		}
	}
	items := scanIdentities(t, grant, true)
	for name, item := range items {
		if item.Identity == nil || len(item.Identity.Fingerprint) != 64 {
			t.Fatalf("missing opaque native identity for %s: %+v", name, item)
		}
	}
	hard := items["original.txt"].Identity
	alias := items["second-name.txt"].Identity
	if hard.Fingerprint != alias.Fingerprint || hard.RenameSafe || alias.RenameSafe ||
		hard.LinkCount < 2 || alias.LinkCount < 2 {
		t.Fatalf("hard links cannot be merged as single canonical SourceItems: %+v / %+v", hard, alias)
	}
	other := *items["other.txt"].Identity
	if err := os.Rename(filepath.Join(root, "other.txt"), filepath.Join(root, "moved.txt")); err != nil {
		t.Fatal(err)
	}
	renamed := scanIdentities(t, grant, true)["moved.txt"].Identity
	if renamed.Fingerprint != other.Fingerprint || renamed.Strong != other.Strong ||
		renamed.RenameSafe != other.RenameSafe {
		t.Fatalf("rename changed the native identity: %v -> %v", other, renamed)
	}
	write("replacement.txt")
	beforeReplace := scanIdentities(t, grant, true)["replacement.txt"].Identity
	if beforeReplace.Fingerprint == renamed.Fingerprint {
		t.Fatal("two distinct files share a filesystem identity")
	}
	// The other file existed concurrently, so this test never assumes inode
	// recycling after a delete preserves distinct fingerprints.
	if err := os.Rename(filepath.Join(root, "replacement.txt"), filepath.Join(root, "moved.txt")); err != nil {
		t.Fatal(err)
	}
	replaced := scanIdentities(t, grant, true)["moved.txt"].Identity
	if replaced.Fingerprint != beforeReplace.Fingerprint || replaced.Fingerprint == renamed.Fingerprint {
		t.Fatal("replaced path kept the overwritten file's native identity")
	}
}

func TestNativeIdentityRejectsNonRegularEntriesAndCancellation(t *testing.T) {
	root := filepath.Join(t.TempDir(), "folder")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	a := filepath.Join(root, "file.txt")
	if err := os.WriteFile(a, []byte("hello"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := ObserveEntryIdentity(a, nil); !errors.Is(err, ErrUnsafeRoot) {
		t.Fatalf("nil Lstat must be refused: %v", err)
	}
	if link := filepath.Join(root, "shortcut"); os.Symlink(a, link) == nil {
		info, err := os.Lstat(link)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := ObserveEntryIdentity(link, info); !errors.Is(err, ErrUnsafeRoot) {
			t.Fatalf("symlink identity must be refused: %v", err)
		}
	}
	grant, err := PrepareRootGrant("https://local.test", "owner", 7,
		uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	summary, err := (InventoryScanner{CollectIdentity: true, BatchSize: 1}).ScanInventory(
		ctx, grant, func(batch []InventoryItem) error {
			cancel()
			return nil
		})
	if !errors.Is(err, context.Canceled) || summary.Complete {
		t.Fatalf("cancelled identity scan cannot report a full inventory: %+v %v", summary, err)
	}
}
