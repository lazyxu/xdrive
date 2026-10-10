package api

import (
	"strings"
	"testing"

	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestMediaThumbnailIdentityIncludesDerivativeVersion(t *testing.T) {
	sha := strings.Repeat("a", 64)
	node := meta.Node{ID: 7, Revision: 9}
	row := meta.MediaMetadata{SHA256: sha}

	if got, want := mediaThumbnailETag(node, row),
		"\"media-"+sha+"-v3-512\""; got != want {
		t.Fatalf("thumbnail etag=%q want=%q", got, want)
	}
	if got, want := mediaThumbnailStorageKey(node, row),
		mediapkg.ThumbnailStoragePrefix+"aa/"+sha+"-v3-512.jpg"; got != want {
		t.Fatalf("thumbnail storage key=%q want=%q", got, want)
	}
	if got, want := mediaAnalysisPreviewStorageKey(node, row),
		mediapkg.ThumbnailStoragePrefix+"aa/"+sha+"-v3-1280.jpg"; got != want {
		t.Fatalf("analysis preview storage key=%q want=%q", got, want)
	}
}

func TestMediaThumbnailTransparentIdentityUsesIsolatedVersion(t *testing.T) {
	sha := strings.Repeat("e", 64)
	node := meta.Node{ID: 7, Revision: 9}
	row := meta.MediaMetadata{SHA256: sha, MIMEType: "image/png"}
	if got, want := mediaThumbnailETag(node, row), "\"media-"+sha+"-v4-512\""; got != want {
		t.Fatalf("transparent etag=%q want=%q", got, want)
	}
	if got := mediaThumbnailStorageKey(node, row); !strings.HasSuffix(got, "-v4-512.thumb") {
		t.Fatalf("transparent key=%q", got)
	}
}
