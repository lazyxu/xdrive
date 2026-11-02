package api

import (
	"strings"
	"testing"

	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestViewerQualityDerivativeKindsAreFiniteAndCacheSeparated(t *testing.T) {
	node := meta.Node{ID: 3, Revision: 7}
	metadata := meta.MediaMetadata{SHA256: strings.Repeat("a", 64)}
	keys := map[string]bool{}
	for _, preset := range []mediapkg.ViewerQualityPreset{
		mediapkg.ViewerQualityEconomy, mediapkg.ViewerQualityBalanced, mediapkg.ViewerQualityHigh,
	} {
		for _, format := range []string{"webp", "jpeg"} {
			v, err := mediapkg.ViewerQualityVariantFor(preset, format)
			if err != nil {
				t.Fatal(err)
			}
			kind, ok := mediaViewerKindForVariant(v)
			if !ok {
				t.Fatalf("no task for %s/%s", preset, format)
			}
			back, ok := mediaViewerVariantForDerivative(kind)
			if !ok || back != v {
				t.Fatalf("task kind corrupts variant identity: %s %+v", kind, back)
			}
			key, edge, version, err := mediaDerivativeIdentity(node, metadata, kind)
			if err != nil || edge != v.MaxEdge {
				t.Fatalf("wrong derivative identity: %s %v %d", kind, err, edge)
			}
			expectedKey, err := mediapkg.ViewerQualityStorageKey(node.ID, node.Revision, metadata.SHA256, v)
			if err != nil || key != expectedKey {
				t.Fatalf("derivative key does not encode real variant: %s %s", key, expectedKey)
			}
			expectedVersion := v.EncoderVersion
			if preset == mediapkg.ViewerQualityHigh {
				expectedVersion = mediapkg.ViewerPreviewVersion
			}
			if version != expectedVersion || keys[key] {
				t.Fatalf("wrong version/collision %q v%d", key, version)
			}
			keys[key] = true
		}
	}
	if len(keys) != 6 {
		t.Fatalf("expected six distinct cached derivatives, got %d", len(keys))
	}
	for _, bad := range []mediaDerivativeKind{
		mediaDerivativeThumbnail, mediaDerivativeCreative, "viewer_png", "",
	} {
		if _, ok := mediaViewerVariantForDerivative(bad); ok {
			t.Fatal("non-Viewer task admitted as a quality variant:", bad)
		}
	}
	v, _ := mediapkg.ViewerQualityVariantFor(mediapkg.ViewerQualityHigh, "webp")
	v.Quality = 100
	if _, ok := mediaViewerKindForVariant(v); ok {
		t.Fatal("tampered Viewer encoder quality accepted")
	}
}
