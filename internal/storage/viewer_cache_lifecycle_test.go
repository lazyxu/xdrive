package storage

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLocalViewerReadLeaseFencesCrossInstanceEviction(t *testing.T) {
	root := t.TempDir()
	reader, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	evictor, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	key := ".xdrive-media/thumbnails/aa/" + strings.Repeat("a", 64) + "-v101-4096-q90.webp"
	if _, err := reader.Put(ctx, key, strings.NewReader("safe-viewer")); err != nil {
		t.Fatal(err)
	}
	var lock ViewerCacheLifecycleLocker = reader
	pinned, release, err := lock.OpenPinnedViewerCache(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	tryCleanup, acquired, err := evictor.TryExclusiveViewerCacheEviction(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if acquired {
		tryCleanup()
		t.Fatal("cache eviction acquired exclusive ownership while a Viewer held a shared read")
	}
	body, err := io.ReadAll(pinned)
	if err != nil || string(body) != "safe-viewer" {
		t.Fatalf("pinned file unreadable: %q %v", body, err)
	}
	if err := pinned.Close(); err != nil {
		t.Fatal(err)
	}
	release()
	tryCleanup, acquired, err = evictor.TryExclusiveViewerCacheEviction(ctx)
	if err != nil || !acquired {
		t.Fatalf("idle eviction lease unavailable: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, ViewerCacheLifecycleLockFile)); err != nil {
		t.Fatal("fixed cache lease file disappeared", err)
	}
	// A real newly arriving reader cannot bypass an already-owned exclusive
	// lease even if the physical bytes exist.
	waitCtx, cancelWait := context.WithTimeout(ctx, 80*time.Millisecond)
	_, _, err = reader.OpenPinnedViewerCache(waitCtx, key)
	cancelWait()
	if err == nil {
		t.Fatal("Viewer admitted a read while exclusive eviction owned the cache")
	}
	tryCleanup()
	file, unlock, err := reader.OpenPinnedViewerCache(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	_ = file.Close()
	unlock()
}

func TestLocalViewerCacheLeaseRejectsNonViewerKeys(t *testing.T) {
	local, err := NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{
		".xdrive-blobs/sha256/aa/" + strings.Repeat("a", 64),
		"../outside.jpg",
		".xdrive-media/thumbnails/aa/" + strings.Repeat("a", 64) + "-v3-512.jpg",
	} {
		if _, release, err := local.OpenPinnedViewerCache(context.Background(), key); err == nil {
			if release != nil {
				release()
			}
			t.Fatal("unapproved generated Viewer read key", key)
		}
	}
}
