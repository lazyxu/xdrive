//go:build linux || windows

package localpush

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
)

func TestReadOnlyInventoryStreamsAndHonorsIgnoreRules(t *testing.T) {
	root := filepath.Join(t.TempDir(), "Photos")
	if err := os.MkdirAll(filepath.Join(root, "nested"), 0o700); err != nil {
		t.Fatal(err)
	}
	const fileCount = 1043
	for i := 0; i < fileCount; i++ {
		name := fmt.Sprintf("%05d.jpg", i)
		if i%10 == 0 {
			name = fmt.Sprintf("%05d.tmp", i)
		}
		if err := os.WriteFile(filepath.Join(root, name), []byte("a"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "nested", "keep.jpg"), []byte("b"), 0o600); err != nil {
		t.Fatal(err)
	}
	grant, err := PrepareRootGrant("https://local.test", "owner", 1, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	var batches [][]InventoryItem
	summary, err := (InventoryScanner{BatchSize: 100, IgnoreRules: "*.tmp"}).ScanInventory(
		context.Background(), grant, func(batch []InventoryItem) error {
			if len(batch) == 0 || len(batch) > 100 {
				t.Fatalf("unbounded scan batch: %d", len(batch))
			}
			batches = append(batches, batch)
			return nil
		})
	if err != nil {
		t.Fatal(err)
	}
	var seen int
	var ignored int
	for _, batch := range batches {
		seen += len(batch)
		for _, item := range batch {
			if item.Ignored {
				ignored++
				if filepath.Ext(item.Path) != ".tmp" {
					t.Fatalf("unexpected ignored entry %q", item.Path)
				}
			}
		}
	}
	if seen != fileCount+2 || summary.ScannedFiles != fileCount+1 ||
		summary.ScannedDirectories != 1 || summary.IgnoredItems != int64(ignored) ||
		summary.ScannedBytes != fileCount+1 || !summary.Complete ||
		summary.MissingInferenceSafe {
		t.Fatalf("invalid inventory counts: %+v seen=%d", summary, seen)
	}
	// Every delivered batch owns separate memory, even after scanner reuse.
	for i := 0; i+1 < len(batches); i++ {
		if len(batches[i]) > 0 && len(batches[i+1]) > 0 &&
			&batches[i][0] == &batches[i+1][0] {
			t.Fatal("scanner reused a callback-owned inventory batch")
		}
	}
}

func TestReadOnlyInventoryCancelsAndNeverClaimsCompleteness(t *testing.T) {
	root := filepath.Join(t.TempDir(), "Docs")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 23; i++ {
		if err := os.WriteFile(filepath.Join(root, fmt.Sprintf("%03d.txt", i)), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	grant, err := PrepareRootGrant("https://local.test", "owner", 5, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	called := 0
	summary, err := (InventoryScanner{BatchSize: 5}).ScanInventory(ctx, grant, func(items []InventoryItem) error {
		called++
		cancel()
		return nil
	})
	if !errors.Is(err, context.Canceled) || called != 1 || summary.Complete {
		t.Fatalf("cancellation must not complete inventory: %+v err=%v calls=%d", summary, err, called)
	}
}

func TestReadOnlyInventoryRequiresMatchingRootIdentity(t *testing.T) {
	root := filepath.Join(t.TempDir(), "backup")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	grant, err := PrepareRootGrant("https://local.test", "owner", 3, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	renamed := root + "-old"
	if err := os.Rename(root, renamed); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	calls := 0
	summary, err := (InventoryScanner{}).ScanInventory(context.Background(), grant, func(_ []InventoryItem) error {
		calls++
		return nil
	})
	if !errors.Is(err, ErrRootChanged) || summary.Complete || calls != 0 {
		t.Fatalf("replaced root was accepted: %+v %v calls=%d", summary, err, calls)
	}
}

func TestReadOnlyInventorySkipsUnsafeLinks(t *testing.T) {
	root := filepath.Join(t.TempDir(), "folder")
	remote := filepath.Join(t.TempDir(), "elsewhere")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(remote, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(remote, filepath.Join(root, "link")); err != nil {
		t.Skipf("symlink creation unavailable: %v", err)
	}
	grant, err := PrepareRootGrant("https://local.test", "owner", 7, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	summary, err := (InventoryScanner{}).ScanInventory(context.Background(), grant, func(items []InventoryItem) error {
		if len(items) != 0 {
			t.Fatal("symlink was emitted")
		}
		return nil
	})
	if err != nil || summary.SkippedUnsafeItems != 1 || !summary.Complete ||
		summary.MissingInferenceSafe {
		t.Fatalf("skipped link summary incorrect: %+v %v", summary, err)
	}
}

func TestReadOnlyInventoryFinalCallbackCancellationDoesNotMarkComplete(t *testing.T) {
	root := filepath.Join(t.TempDir(), "one")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "single.txt"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	grant, err := PrepareRootGrant("https://local.test", "owner", 8, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	summary, err := (InventoryScanner{}).ScanInventory(ctx, grant, func(items []InventoryItem) error {
		if len(items) != 1 {
			t.Fatalf("expected final single-item batch, got %d", len(items))
		}
		cancel()
		return nil
	})
	if !errors.Is(err, context.Canceled) || summary.Complete {
		t.Fatalf("cancelled final batch cannot publish complete inventory: %+v %v", summary, err)
	}
}
