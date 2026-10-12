package api

import (
	"fmt"
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

func TestLIVPThumbnailUsesValidatedStillMIMEForCacheAndRenderVersion(t *testing.T) {
	sha := strings.Repeat("c", 64)
	node := meta.Node{ID: 71, Revision: 9}
	cases := []struct {
		name          string
		stillName     string
		stillMIME     string
		wantVersion   int
		wantExtension string
	}{
		{"embedded heic", "IMG_0001.HEIC", "image/heic", mediapkg.ThumbnailAlphaVersion, ".thumb"},
		{"embedded heif", "IMG_0001.HEIF", "image/heif", mediapkg.ThumbnailAlphaVersion, ".thumb"},
		{"embedded jpeg", "IMG_0001.JPG", "image/jpeg", mediapkg.ThumbnailVersion, ".jpg"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			descriptor := fmt.Sprintf(
				`{"asset_identifier":"live-71","still":{"name":%q,"offset":64,"size":512,"mime_type":%q},"motion":{"name":"IMG_0001.MOV","offset":576,"size":1024,"mime_type":"video/quicktime"}}`,
				tc.stillName, tc.stillMIME,
			)
			row := meta.MediaMetadata{
				SHA256:        sha,
				MIMEType:      mediapkg.LIVPMIMEType,
				ContainerKind: mediapkg.ContainerKindLIVP,
				ContainerJSON: descriptor,
			}
			if got := mediaThumbnailSourceMIME(row); got != tc.stillMIME {
				t.Fatalf("LIVP still MIME=%q want=%q", got, tc.stillMIME)
			}
			if !mediaThumbnailSupported(row) {
				t.Fatal("valid LIVP still must support thumbnail rendering")
			}
			if got := mediaThumbnailVersion(row); got != tc.wantVersion {
				t.Fatalf("LIVP version=%d want=%d", got, tc.wantVersion)
			}
			if got, want := mediaThumbnailETag(node, row),
				fmt.Sprintf("\"media-%s-v%d-%d\"", sha, tc.wantVersion, mediapkg.DefaultThumbnailEdge); got != want {
				t.Fatalf("LIVP ETag=%q want=%q", got, want)
			}
			key := mediaThumbnailStorageKey(node, row)
			wantSuffix := fmt.Sprintf("-v%d-%d%s", tc.wantVersion, mediapkg.DefaultThumbnailEdge, tc.wantExtension)
			if !strings.HasSuffix(key, wantSuffix) {
				t.Fatalf("LIVP key=%q want suffix=%q", key, wantSuffix)
			}
			derivedKey, edge, version, err := mediaDerivativeIdentity(node, row, mediaDerivativeThumbnail)
			if err != nil || derivedKey != key ||
				edge != mediapkg.DefaultThumbnailEdge || version != tc.wantVersion {
				t.Fatalf("derivative identity key=%q edge=%d version=%d err=%v", derivedKey, edge, version, err)
			}
			legacyOpaqueKey := mediapkg.ThumbnailStorageKeyForSource(
				node.ID, node.Revision, sha, mediapkg.DefaultThumbnailEdge, row.MIMEType,
			)
			if tc.wantVersion == mediapkg.ThumbnailAlphaVersion && legacyOpaqueKey == key {
				t.Fatal("HEIC/HEIF still incorrectly reuses the old opaque LIVP v3 derivative")
			}
			if tc.wantVersion == mediapkg.ThumbnailVersion && legacyOpaqueKey != key {
				t.Fatal("LIVP JPEG still should preserve the existing v3 cache")
			}
		})
	}
}

func TestLIVPThumbnailRejectsMalformedStillDescriptorWithoutMIMEFallbackGuess(t *testing.T) {
	for _, raw := range []string{"", "not-json", `{"still":{},"motion":{}}`} {
		row := meta.MediaMetadata{
			MIMEType:      mediapkg.LIVPMIMEType,
			ContainerKind: mediapkg.ContainerKindLIVP,
			ContainerJSON: raw,
		}
		if got := mediaThumbnailSourceMIME(row); got != mediapkg.LIVPMIMEType {
			t.Fatalf("malformed descriptor guessed MIME %q", got)
		}
		if mediaThumbnailSupported(row) {
			t.Fatal("malformed LIVP still cannot be advertised as a supported thumbnail")
		}
	}
}
