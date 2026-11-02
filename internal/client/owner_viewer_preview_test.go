package client

import (
	"strings"
	"testing"
)

func TestOwnerViewerPreviewRangeRejectsCrossRevisionAndPartialImages(t *testing.T) {
	id, revision := uint64(17), uint64(4)
	etag := "\"media-viewer:" + strings.Repeat("a", 64) + ":17:4:webp:v1\""
	base := OwnerViewerPreviewRange{
		NodeID: id, Revision: revision, Format: "webp",
		Offset: 0, Total: 8, ETag: etag,
		Data: []byte{1, 2, 3, 4},
	}
	if !ValidOwnerViewerPreviewRange(base, id, revision, "webp", 0, 4) {
		t.Fatal("current Owner 4-byte slice was rejected")
	}
	fail := func(label string, v OwnerViewerPreviewRange, expectedRevision uint64, format string, offset int64, length int) {
		t.Helper()
		if ValidOwnerViewerPreviewRange(v, id, expectedRevision, format, offset, length) {
			t.Fatalf("%s: accepted an invalid preview slice", label)
		}
	}
	stale := base
	stale.Revision++
	fail("stale revision", stale, revision, "webp", 0, 4)
	wrongType := base
	wrongType.Format = "jpeg"
	fail("format substitution", wrongType, revision, "webp", 0, 4)
	tamper := base
	tamper.ETag = "\"media-viewer:" + strings.Repeat("b", 64) + ":17:5:webp:v1\""
	fail("etag revision forgery", tamper, revision, "webp", 0, 4)
	oversize := base
	oversize.Total = OwnerViewerPreviewMaxBytes + 1
	fail("oversized derivative", oversize, revision, "webp", 0, 4)
	empty := base
	empty.Data = nil
	fail("empty body", empty, revision, "webp", 0, 4)
	incomplete := base
	incomplete.Data = []byte{1, 2, 3}
	fail("premature short nonfinal chunk", incomplete, revision, "webp", 0, 4)
	overlong := base
	fail("oversized requested chunk", overlong, revision, "webp", 0, OwnerViewerPreviewChunkBytes+1)
}

func TestOwnerViewerPreviewRangeAcceptsExactFinalChunkAndEmptySourceSHA(t *testing.T) {
	v := OwnerViewerPreviewRange{
		NodeID: 7, Revision: 9, Format: "jpeg", Offset: 5,
		Total: 8, ETag: "\"media-viewer::7:9:jpeg:v1\"",
		Data: []byte{4, 5, 6},
	}
	if !ValidOwnerViewerPreviewRange(v, 7, 9, "jpeg", 5, 256) {
		t.Fatal("an exact final short chunk must be valid")
	}
	v.ETag = "\"media-viewer::7:9:jpeg:v2\""
	if ValidOwnerViewerPreviewRange(v, 7, 9, "jpeg", 5, 256) {
		t.Fatal("unrecognized derivative version accepted")
	}
}
