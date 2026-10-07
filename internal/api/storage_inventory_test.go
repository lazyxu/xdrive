package api

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/storage"
)

func TestStorageInventoryCategory(t *testing.T) {
	tests := map[string]string{
		".xdrive-blobs/sha256/aa/aaaaaaaa":          "cas",
		".xdrive-uploads/owner/session/part":        "upload_staging",
		".xdrive-media/thumbnails/aa/hash-512.jpg":  "media_thumbnail",
		".xdrive-media/thumbnails/aa/hash-1280.jpg": "analysis_preview",
		".xdrive-media/posters/aa/hash-v1-512.jpg":   "video_poster",
		".xdrive-media/thumbnails/aa/hash-256.jpg":  "media_other",
		".xdrive-blobs/sha256/aa/.xdrive-upload-x":  "write_temp",
		".xdrive-ready-x":                           "readiness_temp",
		".xdrive-future/cache.bin":                  "unclassified",
		"legacy/user/file.bin":                      "legacy",
	}
	for key, want := range tests {
		if got := storageInventoryCategory(key); got != want {
			t.Fatalf("category(%q)=%q want=%q", key, got, want)
		}
	}
}

func TestStorageCleanupMatchesOnlySafeClasses(t *testing.T) {
	cutoff := time.Now().Add(-storageTempReclaimableAge)
	old := cutoff.Add(-time.Minute)
	recent := cutoff.Add(time.Minute)

	if !storageCleanupMatches(storageCleanupAll, storage.ManagedFile{
		Key: ".xdrive-media/thumbnails/aa/hash-512.jpg", ModifiedAt: recent,
	}, cutoff) {
		t.Fatal("thumbnail was not reclaimable")
	}
	if !storageCleanupMatches(storageCleanupVideoPoster, storage.ManagedFile{
		Key: ".xdrive-media/posters/aa/hash-v1-512.jpg", ModifiedAt: recent,
	}, cutoff) {
		t.Fatal("video poster was not reclaimable")
	}
	if !storageCleanupMatches(storageCleanupAll, storage.ManagedFile{
		Key: ".xdrive-media/posters/aa/hash-v1-512.jpg", ModifiedAt: recent,
	}, cutoff) {
		t.Fatal("video poster was not included in all-cache cleanup")
	}
	if !storageCleanupMatches(storageCleanupAnalysis, storage.ManagedFile{
		Key: ".xdrive-media/thumbnails/aa/hash-1280.jpg", ModifiedAt: recent,
	}, cutoff) {
		t.Fatal("analysis preview was not reclaimable")
	}
	if !storageCleanupMatches(storageCleanupTemp, storage.ManagedFile{
		Key: ".xdrive-blobs/sha256/aa/.xdrive-upload-old", ModifiedAt: old,
	}, cutoff) {
		t.Fatal("old atomic temp was not reclaimable")
	}
	if storageCleanupMatches(storageCleanupTemp, storage.ManagedFile{
		Key: ".xdrive-blobs/sha256/aa/.xdrive-upload-active", ModifiedAt: recent,
	}, cutoff) {
		t.Fatal("recent atomic temp became reclaimable")
	}
	if storageCleanupMatches(storageCleanupAll, storage.ManagedFile{
		Key: ".xdrive-blobs/sha256/aa/canonical", ModifiedAt: old,
	}, cutoff) {
		t.Fatal("canonical CAS content became reclaimable")
	}
	if storageCleanupMatches(storageCleanupAll, storage.ManagedFile{
		Key: ".xdrive-future/unknown.bin", ModifiedAt: old,
	}, cutoff) {
		t.Fatal("unclassified xDrive data became reclaimable")
	}
}

func TestStorageHostPathRequiresResolvedHostAbsolutePath(t *testing.T) {
	host, err := filepath.Abs(filepath.Join("srv", "xdrive", "files"))
	if err != nil {
		t.Fatal(err)
	}
	if got := storageHostPath(host, ""); got != filepath.Clean(host) {
		t.Fatalf("host path=%q want=%q", got, filepath.Clean(host))
	}
	if got := storageHostPath("$XD_FILES_DATA_DIR", ""); got != "" {
		t.Fatalf("template path was accepted: %q", got)
	}
	if got := storageHostPath("data/files", ""); got != "" {
		t.Fatalf("relative path was accepted: %q", got)
	}
}
