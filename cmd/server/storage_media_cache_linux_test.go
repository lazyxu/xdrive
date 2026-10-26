//go:build linux

package main

import (
	"bytes"
	"context"
	"image"
	"image/jpeg"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/lazyxu/xdrive/internal/storage"
)

// Regression: a valid upload ownership marker previously skipped the separate
// .xdrive-media tree. NewLocal/Server readiness succeeded, but a cold JPEG
// thumbnail could not be written into a migrated read-only cache shard.
func TestPrepareStorageRootRepairsMediaCacheParentsWithCurrentMarker(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("exercise real thumbnail EACCES under the non-root Server UID")
	}
	root := t.TempDir()
	staging := filepath.Join(root, storage.UploadStagingDir)
	cache := filepath.Join(root, ".xdrive-media")
	thumb := filepath.Join(cache, "thumbnails")
	shard := filepath.Join(thumb, "ab")
	node := filepath.Join(thumb, "node")
	poster := filepath.Join(cache, "posters")
	posterShard := filepath.Join(poster, "cd")
	unrelated := filepath.Join(cache, "unrelated-user-folder")
	for _, dir := range []string{staging, shard, node, posterShard, unrelated} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	cachedPath := filepath.Join(shard, "previous.jpg")
	if err := os.WriteFile(cachedPath, []byte("preserve-previous-cache-inode"), 0o600); err != nil {
		t.Fatal(err)
	}
	before, err := os.Lstat(cachedPath)
	if err != nil {
		t.Fatal(err)
	}
	uid, gid := os.Geteuid(), os.Getegid()
	if err := os.WriteFile(filepath.Join(staging, ".ownership-v1"),
		[]byte(strconv.Itoa(uid)+":"+strconv.Itoa(gid)+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	locked := []string{cache, thumb, shard, node, poster, posterShard}
	for _, dir := range append(append([]string{}, locked...), unrelated) {
		if err := os.Chmod(dir, 0o100); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		// Make parent directories traversable before restoring children.
		for _, dir := range append(append([]string{}, locked...), unrelated) {
			_ = os.Chmod(dir, 0o700)
		}
	})
	store, err := storage.NewLocal(root)
	if err != nil {
		t.Fatalf("fixture should pass ordinary Server storage readiness: %v", err)
	}
	var imageBytes bytes.Buffer
	if err := jpeg.Encode(&imageBytes, image.NewRGBA(image.Rect(0, 0, 4, 3)), nil); err != nil {
		t.Fatal(err)
	}
	const key = ".xdrive-media/thumbnails/ab/cold-v3-512.jpg"
	if _, err := store.Put(context.Background(), key, bytes.NewReader(imageBytes.Bytes())); err == nil {
		t.Fatal("reproduction failed: cold thumbnail unexpectedly writable with current marker")
	}
	if _, err := os.ReadDir(cache); err == nil {
		t.Fatal("reproduction failed: media cache unexpectedly enumerable")
	}

	if _, err := prepareStorageRoot(root, uid, gid, false); err != nil {
		t.Fatalf("prepare with a current marker must recover media cache parents: %v", err)
	}
	for _, dir := range locked {
		info, err := os.Lstat(dir)
		if err != nil || info.Mode().Perm()&0o700 != 0o700 {
			t.Fatalf("cache parent was not repaired: %s, %v, %v", dir, info, err)
		}
	}
	if _, err := store.Put(context.Background(), key, bytes.NewReader(imageBytes.Bytes())); err != nil {
		t.Fatalf("same cold thumbnail remains unwritable after prepare: %v", err)
	}
	opened, err := store.Open(context.Background(), key)
	if err != nil {
		t.Fatal(err)
	}
	config, format, decodeErr := image.DecodeConfig(opened)
	_ = opened.Close()
	if decodeErr != nil || format != "jpeg" || config.Width != 4 || config.Height != 3 {
		t.Fatalf("new thumbnail not decodable: format=%q config=%+v err=%v", format, config, decodeErr)
	}
	if _, err := store.Put(context.Background(), ".xdrive-media/posters/cd/cold-v1-512.jpg", bytes.NewReader(imageBytes.Bytes())); err != nil {
		t.Fatalf("poster cache parent remains unwritable: %v", err)
	}
	if _, err := prepareStorageRoot(root, uid, gid, false); err != nil {
		t.Fatalf("second idempotent preparation failed: %v", err)
	}
	after, err := os.Lstat(cachedPath)
	if err != nil || !os.SameFile(before, after) || before.Mode() != after.Mode() ||
		before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) {
		t.Fatalf("existing media cache file changed: before=%v after=%v err=%v", before, after, err)
	}
	got, err := os.ReadFile(cachedPath)
	if err != nil || string(got) != "preserve-previous-cache-inode" {
		t.Fatalf("existing cache bytes changed: %q, %v", got, err)
	}
	info, err := os.Lstat(unrelated)
	if err != nil || info.Mode().Perm() != 0o100 {
		t.Fatalf("unrelated directory was modified: %v, %v", info, err)
	}
}

func TestPrepareStorageRootRejectsSymlinkedMediaCacheParents(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("test non-root safe admission with current ownership marker")
	}
	for _, tc := range []struct{ name, link string }{
		{"media root", ".xdrive-media"},
		{"thumbnail category", ".xdrive-media/thumbnails"},
		{"poster shard", ".xdrive-media/posters/cd"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			external := t.TempDir()
			staging := filepath.Join(root, storage.UploadStagingDir)
			if err := os.MkdirAll(staging, 0o700); err != nil {
				t.Fatal(err)
			}
			uid, gid := os.Geteuid(), os.Getegid()
			if err := os.WriteFile(filepath.Join(staging, ".ownership-v1"),
				[]byte(strconv.Itoa(uid)+":"+strconv.Itoa(gid)+"\n"), 0o600); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(root, filepath.FromSlash(tc.link))
			if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(external, path); err != nil {
				t.Fatal(err)
			}
			before, err := os.Lstat(external)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := prepareStorageRoot(root, uid, gid, false); err == nil {
				t.Fatalf("symlinked media cache parent %s was accepted", tc.link)
			}
			after, err := os.Lstat(external)
			if err != nil || !os.SameFile(before, after) || before.Mode() != after.Mode() {
				t.Fatalf("symlink target metadata changed: before=%v after=%v err=%v", before, after, err)
			}
		})
	}
}
