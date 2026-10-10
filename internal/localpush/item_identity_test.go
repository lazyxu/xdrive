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

func scanNativeIdentity(t *testing.T, grant RootGrant) map[string]*InventoryNativeIdentity {
	t.Helper()
	result := make(map[string]*InventoryNativeIdentity)
	summary, err := (InventoryScanner{IncludeNativeIdentity: true, BatchSize: 1}).ScanInventory(
		context.Background(), grant, func(items []InventoryItem) error {
			if len(items) != 1 || items[0].NativeIdentity == nil {
				t.Fatalf("missing native identity in batch: %+v", items)
			}
			result[items[0].Path] = items[0].NativeIdentity
			return nil
		},
	)
	if err != nil || !summary.Complete || summary.MissingInferenceSafe {
		t.Fatalf("native inventory must remain read-only and non-deletion-authoritative: %+v err=%v", summary, err)
	}
	return result
}

func TestNativeInventoryIdentitySurvivesRenameButNotHardlinkAmbiguity(t *testing.T) {
	root := filepath.Join(t.TempDir(), "Photos")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	original := filepath.Join(root, "original.jpg")
	if err := os.WriteFile(original, []byte("original"), 0o600); err != nil {
		t.Fatal(err)
	}
	grant, err := PrepareRootGrant("https://local.test", "owner", 7, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	before := scanNativeIdentity(t, grant)["original.jpg"]
	renamed := filepath.Join(root, "renamed.jpg")
	if err := os.Rename(original, renamed); err != nil {
		t.Fatal(err)
	}
	after := scanNativeIdentity(t, grant)["renamed.jpg"]
	if after.Key != before.Key || after.Strong != before.Strong {
		t.Fatalf("rename changed native identity: before=%+v after=%+v", before, after)
	}
	// Hard links are distinct paths, not two independent SourceItem IDs.
	second := filepath.Join(root, "other.jpg")
	if err := os.Link(renamed, second); err != nil {
		t.Skipf("hard links unavailable on this filesystem: %v", err)
	}
	links := scanNativeIdentity(t, grant)
	if len(links) != 2 || links["renamed.jpg"].Key != links["other.jpg"].Key ||
		links["renamed.jpg"].LinkCount < 2 || links["other.jpg"].RenameCandidate ||
		links["renamed.jpg"].RenameCandidate {
		t.Fatalf("hard-link paths must remain distinct and ambiguous: %+v", links)
	}
}

func TestNativeInventoryIdentityRootScopeAndOptIn(t *testing.T) {
	root := filepath.Join(t.TempDir(), "Data")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "item.bin"), []byte("data"), 0o600); err != nil {
		t.Fatal(err)
	}
	first, err := PrepareRootGrant("https://local.test", "alice", 1, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	second, err := PrepareRootGrant("https://local.test", "alice", 2, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	left := scanNativeIdentity(t, first)["item.bin"]
	right := scanNativeIdentity(t, second)["item.bin"]
	if left.Key == right.Key || len(left.Key) != 64 {
		t.Fatalf("native IDs crossed distinct Root grants: left=%+v right=%+v", left, right)
	}
	_, err = (InventoryScanner{}).ScanInventory(context.Background(), first, func(items []InventoryItem) error {
		for _, item := range items {
			if item.NativeIdentity != nil {
				t.Fatal("default inventory unexpectedly requested native identity")
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestNativeInventoryCancellationIsNotCompleteOrMirrorSafe(t *testing.T) {
	root := filepath.Join(t.TempDir(), "Sample")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"one.txt", "two.txt", "three.txt"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("content"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	grant, err := PrepareRootGrant("https://local.test", "owner", 8, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	summary, err := (InventoryScanner{IncludeNativeIdentity: true, BatchSize: 1}).ScanInventory(
		ctx, grant, func(items []InventoryItem) error {
			if items[0].NativeIdentity == nil {
				t.Fatal("missing native identity")
			}
			cancel()
			return nil
		},
	)
	if !errors.Is(err, context.Canceled) || summary.Complete || summary.MissingInferenceSafe {
		t.Fatalf("cancelled native inventory was treated as authoritative: %+v %v", summary, err)
	}
}
