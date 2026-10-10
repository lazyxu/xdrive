package media

import (
	"strings"
	"testing"
)

func TestThumbnailStorageKeyMatchesCanonicalLayout(t *testing.T) {
	sha := strings.Repeat("a", 64)
	if got, want := ThumbnailStorageKey(7, 9, sha, DefaultThumbnailEdge),
		ThumbnailStoragePrefix+"aa/"+sha+"-v3-512.jpg"; got != want {
		t.Fatalf("sha thumbnail key=%q want=%q", got, want)
	}
	if got, want := ThumbnailStorageKey(7, 9, "", 0),
		ThumbnailStoragePrefix+"node/7-9-v3-512.jpg"; got != want {
		t.Fatalf("node thumbnail key=%q want=%q", got, want)
	}
}

func TestAnalysisPreviewStorageKeyUsesAnalysisVersion(t *testing.T) {
	sha := strings.Repeat("b", 64)
	if got, want := AnalysisPreviewStorageKey(7, 9, sha),
		ThumbnailStoragePrefix+"bb/"+sha+"-v3-1280.jpg"; got != want {
		t.Fatalf("analysis preview key=%q want=%q", got, want)
	}
}

func TestAlphaCapableThumbnailKeysDoNotInvalidateOrdinaryJPEG(t *testing.T) {
	sha := strings.Repeat("c", 64)
	if got := ThumbnailStorageKeyForSource(7, 9, sha, 512, "image/jpeg"); got != ThumbnailStorageKey(7, 9, sha, 512) {
		t.Fatalf("ordinary JPEG key changed: %q", got)
	}
	for _, mime := range []string{"image/png", "image/webp", "image/avif", "image/heic", "image/gif"} {
		if key := ThumbnailStorageKeyForSource(7, 9, sha, 512, mime); !strings.HasSuffix(key, "-v4-512.thumb") {
			t.Fatalf("alpha-capable MIME %q key=%q", mime, key)
		}
	}
}
