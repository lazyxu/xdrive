package maintenance

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	mediapkg "github.com/lazyxu/xdrive/internal/media"
)

func TestViewerVariantEvictionTouchesOnlyOldViewerDerivatives(t *testing.T) {
	root := t.TempDir()
	now := time.Now().UTC()
	old := now.Add(-48*time.Hour)
	var keys []string
	for _, preset := range []mediapkg.ViewerQualityPreset{mediapkg.ViewerQualityEconomy, mediapkg.ViewerQualityBalanced, mediapkg.ViewerQualityHigh} {
		for _, format := range []string{"webp", "jpeg"} {
			v, _ := mediapkg.ViewerQualityVariantFor(preset, format)
			key, err := mediapkg.ViewerQualityStorageKey(1, 1, strings.Repeat("a",64), v)
			if err != nil { t.Fatal(err) }
			keys = append(keys, key)
		}
	}
	for i, key := range keys[:4] {
		full := filepath.Join(root, filepath.FromSlash(key))
		if err := os.MkdirAll(filepath.Dir(full), 0o750); err != nil { t.Fatal(err) }
		f, err := os.Create(full)
		if err != nil { t.Fatal(err) }
		if err := f.Truncate(700<<10); err != nil { t.Fatal(err) }
		if err := f.Close(); err != nil { t.Fatal(err) }
		mtime := old
		if i == 3 { mtime = now.Add(-time.Hour) }
		if err := os.Chtimes(full, mtime, mtime); err != nil { t.Fatal(err) }
	}
	original := filepath.Join(root, ".xdrive-blobs", "sha256", "bb", strings.Repeat("b", 64))
	if err := os.MkdirAll(filepath.Dir(original), 0o750); err != nil { t.Fatal(err) }
	if err := os.WriteFile(original, []byte("original"), 0o600); err != nil { t.Fatal(err) }
	result, err := EvictViewerVariantCacheAssumingExclusiveLease(context.Background(), root, 1<<20, now)
	if err != nil || result.DeletedFiles != 3 || result.RemainingBytes != 700<<10 || result.OverBudget {
		t.Fatalf("wrong Viewer cache eviction: %+v %v", result, err)
	}
	for _, key := range keys[:3] {
		if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(key))); !os.IsNotExist(err) {
			t.Fatalf("old Viewer cache still present: %q %v", key, err)
		}
	}
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(keys[3]))); err != nil {
		t.Fatal("young Viewer cache removed", err)
	}
	data, err := os.ReadFile(original)
	if err != nil || string(data) != "original" { t.Fatal("canonical original was modified") }
}

func TestViewerVariantEvictionRefusesSymlinkCacheRoot(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	cache := filepath.Join(root, ".xdrive-media", "thumbnails")
	if err := os.MkdirAll(filepath.Dir(cache), 0o750); err != nil { t.Fatal(err) }
	if err := os.Symlink(outside, cache); err != nil { t.Skipf("symlink unavailable: %v", err) }
	if _, err := ScanViewerVariantCache(context.Background(), root, 1<<20, time.Now()); err == nil {
		t.Fatal("symlink root was accepted")
	}
}
