//go:build linux || windows

package localpush

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func inventoryFileForHashTest(t *testing.T, grant RootGrant, target string) InventoryItem {
	t.Helper()
	var item InventoryItem
	seen := false
	summary, err := (InventoryScanner{
		IncludeNativeIdentity: true, BatchSize: 2,
	}).ScanInventory(context.Background(), grant, func(rows []InventoryItem) error {
		for _, row := range rows {
			if row.Path == target {
				item = row
				seen = true
			}
		}
		return nil
	})
	if err != nil || !summary.Complete || !seen {
		t.Fatalf("find scanned item: summary=%+v found=%t err=%v", summary, seen, err)
	}
	return item
}

func TestHashVerifiedInventoryFileMatchesOriginalBytes(t *testing.T) {
	root := filepath.Join(t.TempDir(), "photos")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	payload := []byte(strings.Repeat("stable-original-", 25000))
	if err := os.WriteFile(filepath.Join(root, "original.bin"), payload, 0o600); err != nil {
		t.Fatal(err)
	}
	grant, err := PrepareRootGrant("https://server.test", "owner", 19, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	item := inventoryFileForHashTest(t, grant, "original.bin")
	var calls int
	result, err := HashVerifiedInventoryFile(context.Background(), grant, item, func(done, total int64) error {
		calls++
		if done <= 0 || done > total || total != int64(len(payload)) {
			t.Fatalf("bad bounded hash progress: %d / %d", done, total)
		}
		return nil
	})
	expected := sha256.Sum256(payload)
	if err != nil || result.Path != item.Path || result.Size != int64(len(payload)) ||
		result.SHA256 != hex.EncodeToString(expected[:]) ||
		result.NativeIdentityKey != item.NativeIdentity.Key || calls < 2 {
		t.Fatalf("invalid verified digest %+v progress=%d err=%v", result, calls, err)
	}
}

func TestHashVerifiedInventoryFileRejectsSymlinkAndChangedContent(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "photos")
	outside := filepath.Join(base, "private.bin")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "original.bin")
	if err := os.WriteFile(path, []byte("old data"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(outside, []byte("sensitive external bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	grant, err := PrepareRootGrant("https://server.test", "owner", 20, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	item := inventoryFileForHashTest(t, grant, "original.bin")
	if err := os.WriteFile(path, []byte("modified bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	if digest, err := HashVerifiedInventoryFile(context.Background(), grant, item, nil); err == nil || digest.SHA256 != "" {
		t.Fatalf("modified file incorrectly accepted: %+v %v", digest, err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, path); err != nil {
		t.Skipf("OS lacks symlink privilege: %v", err)
	}
	if digest, err := HashVerifiedInventoryFile(context.Background(), grant, item, nil); err == nil || digest.SHA256 != "" {
		t.Fatalf("symlink escape incorrectly accepted: %+v %v", digest, err)
	}
	item.Path = "../private.bin"
	if digest, err := HashVerifiedInventoryFile(context.Background(), grant, item, nil); err == nil || digest.SHA256 != "" {
		t.Fatalf("path traversal incorrectly accepted: %+v %v", digest, err)
	}
}

func TestHashVerifiedInventoryFileCancellationAndPartialMutation(t *testing.T) {
	root := filepath.Join(t.TempDir(), "source")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "movie.bin")
	if err := os.WriteFile(path, make([]byte, 4<<20), 0o600); err != nil {
		t.Fatal(err)
	}
	grant, err := PrepareRootGrant("https://server.test", "owner", 21, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	item := inventoryFileForHashTest(t, grant, "movie.bin")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	digest, err := HashVerifiedInventoryFile(ctx, grant, item, func(done, _ int64) error {
		if done >= localFileHashBufferSize {
			cancel()
		}
		return nil
	})
	if !errors.Is(err, context.Canceled) || digest.SHA256 != "" {
		t.Fatalf("cancelled hash accepted: %+v %v", digest, err)
	}
	_, err = HashVerifiedInventoryFile(context.Background(), grant, item, func(done, _ int64) error {
		if done >= localFileHashBufferSize {
			return os.Truncate(path, 3<<20)
		}
		return nil
	})
	if !errors.Is(err, ErrRootChanged) {
		t.Fatalf("mid-stream changed file was accepted: %v", err)
	}
}

func TestHashVerifiedInventoryFileRejectsReplacedRoot(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "original")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "file.bin"), []byte("content"), 0o600); err != nil {
		t.Fatal(err)
	}
	grant, err := PrepareRootGrant("https://server.test", "owner", 22, uuid.NewString(), root)
	if err != nil {
		t.Fatal(err)
	}
	item := inventoryFileForHashTest(t, grant, "file.bin")
	if err := os.Rename(root, filepath.Join(base, "removed-root")); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if digest, err := HashVerifiedInventoryFile(context.Background(), grant, item, nil); err == nil || digest.SHA256 != "" {
		t.Fatalf("replaced Root was accepted: %+v %v", digest, err)
	}
}
