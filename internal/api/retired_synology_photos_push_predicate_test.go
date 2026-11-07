package api

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestRetiredDSMPhotosPushPredicateDoesNotBanNativeSourceIDs(t *testing.T) {
	for _, tc := range []struct {
		kind, direction string
		retired         bool
	}{
		{synologySourceKind, meta.SourceDirectionPush, true},
		{synologySourceKind, meta.SourceDirectionPull, false},
		{synologyFilesSourceKind, meta.SourceDirectionPull, false},
		{meta.SourceKindIOSPhotos, meta.SourceDirectionPush, false},
		{meta.SourceKindAndroidPhotos, meta.SourceDirectionPush, false},
		{meta.SourceKindLocalFolder, meta.SourceDirectionPush, false},
	} {
		if got := isRetiredSynologyPhotosPush(meta.Source{Kind: tc.kind, Direction: tc.direction}); got != tc.retired {
			t.Fatalf("kind=%q direction=%q retired=%t want=%t", tc.kind, tc.direction, got, tc.retired)
		}
	}
}
