package media

import (
	"strings"
	"testing"
)

func TestThumbnailStorageKeyMatchesCanonicalLayout(t *testing.T) {
	sha := strings.Repeat("a", 64)
	if got, want := ThumbnailStorageKey(7, 9, sha, DefaultThumbnailEdge),
		ThumbnailStoragePrefix+"aa/"+sha+"-v2-512.jpg"; got != want {
		t.Fatalf("sha thumbnail key=%q want=%q", got, want)
	}
	if got, want := ThumbnailStorageKey(7, 9, "", 0),
		ThumbnailStoragePrefix+"node/7-9-v2-512.jpg"; got != want {
		t.Fatalf("node thumbnail key=%q want=%q", got, want)
	}
}

func TestAnalysisPreviewStorageKeyUsesAnalysisVersion(t *testing.T) {
	sha := strings.Repeat("b", 64)
	if got, want := AnalysisPreviewStorageKey(7, 9, sha),
		ThumbnailStoragePrefix+"bb/"+sha+"-v2-1280.jpg"; got != want {
		t.Fatalf("analysis preview key=%q want=%q", got, want)
	}
}
