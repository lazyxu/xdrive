package api

import (
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestMediaThumbnailSupportForTIFFBasedRAW(t *testing.T) {
	for _, mimeType := range []string{
		"image/x-adobe-dng",
		"image/x-nikon-nef",
		"image/x-sony-arw",
	} {
		t.Run(mimeType, func(t *testing.T) {
			if !mediaUsesTIFFEmbeddedPreview(mimeType) {
				t.Fatalf("TIFF RAW preview MIME %q not recognized", mimeType)
			}
			if !mediaThumbnailSupported(meta.MediaMetadata{MIMEType: mimeType}) {
				t.Fatalf("TIFF RAW thumbnail MIME %q not supported", mimeType)
			}
		})
	}
	if mediaUsesTIFFEmbeddedPreview("image/tiff") {
		t.Fatal("ordinary TIFF should use the normal image decoder, not RAW preview extraction")
	}
}
