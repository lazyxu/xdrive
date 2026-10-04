package api

import (
	"testing"

	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestMediaThumbnailSupportedHEIC(t *testing.T) {
	for _, mimeType := range []string{"image/heic", "image/heif"} {
		if !mediaThumbnailSupported(meta.MediaMetadata{MIMEType: mimeType}) {
			t.Fatalf("HEIC/HEIF thumbnail MIME %q was rejected", mimeType)
		}
	}
}

func TestMediaThumbnailSupportedLIVPHEICStill(t *testing.T) {
	row := meta.MediaMetadata{
		MIMEType:      "application/octet-stream",
		ContainerKind: mediapkg.ContainerKindLIVP,
		ContainerJSON: `{"asset_identifier":"asset-1","still":{"name":"IMG.HEIC","offset":64,"size":512,"mime_type":"image/heic"},"motion":{"name":"IMG.MOV","offset":576,"size":1024,"mime_type":"video/quicktime"}}`,
	}
	if !mediaThumbnailSupported(row) {
		t.Fatal("validated LIVP HEIC still was rejected for thumbnail decoding")
	}
}


func TestMediaThumbnailSupportedAVIF(t *testing.T) {
	if !mediaThumbnailSupported(meta.MediaMetadata{MIMEType: "image/avif"}) {
		t.Fatal("AVIF thumbnail MIME was rejected")
	}
}
