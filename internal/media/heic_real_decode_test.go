package media

import (
	"bytes"
	"image"
	"image/jpeg"
	"os"
	"testing"
)

// Real HEVC-coded HEIC pixels, not just a registered/truncated MIME header.
// Server images force the same CGO-free WASM decoder exercised here.
func TestRealHEIC8BitThumbnailPixels(t *testing.T) {
	still, err := os.ReadFile("testdata/heic-8bit-512.heic")
	if err != nil {
		t.Fatal(err)
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(still))
	if err != nil || format != "heic" || config.Width != 512 || config.Height != 512 {
		t.Fatalf("real HEIC config failed: format=%q config=%+v err=%v", format, config, err)
	}
	decoded, format, err := image.Decode(bytes.NewReader(still))
	if err != nil || format != "heic" || decoded.Bounds().Dx() != 512 || decoded.Bounds().Dy() != 512 {
		t.Fatalf("real HEIC image decoding failed: format=%q err=%v", format, err)
	}
	metadata, err := Extract("IMG_512.HEIC", bytes.NewReader(still), int64(len(still)))
	if err != nil || metadata.Kind != KindImage || (metadata.MIMEType != "image/heic" && metadata.MIMEType != "image/heif") ||
		metadata.Width != 512 || metadata.Height != 512 {
		t.Fatalf("HEIC metadata is invalid: %+v err=%v", metadata, err)
	}
	thumb, err := ThumbnailWithAlpha(bytes.NewReader(still), metadata.Orientation, 128)
	if err != nil {
		t.Fatalf("real HEIC thumbnail failed: %v", err)
	}
	if thumb.SourceKind != "heic" || thumb.MIMEType != "image/jpeg" || thumb.Width != 128 || thumb.Height != 128 {
		t.Fatalf("opaque HEIC did not produce 128px JPEG: %+v", thumb)
	}
	jpegConfig, err := jpeg.DecodeConfig(bytes.NewReader(thumb.Data))
	if err != nil || jpegConfig.Width != 128 || jpegConfig.Height != 128 {
		t.Fatalf("HEIC derivative is not decoded JPEG: %+v err=%v", jpegConfig, err)
	}
}
