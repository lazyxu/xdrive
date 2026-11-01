package media

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"strings"
	"testing"

	"golang.org/x/image/webp"
)

func TestViewerPreviewFormatsAndResolution(t *testing.T) {
	src := image.NewNRGBA(image.Rect(0, 0, 64, 48))
	for y := 0; y < 48; y++ {
		for x := 0; x < 64; x++ {
			src.SetNRGBA(x, y, color.NRGBA{R: uint8(x * 3), G: uint8(y * 5), B: 127, A: 255})
		}
	}
	var original bytes.Buffer
	if err := jpeg.Encode(&original, src, nil); err != nil {
		t.Fatal(err)
	}
	for _, format := range []string{"webp", "jpeg"} {
		preview, err := renderViewerPreview(bytes.NewReader(original.Bytes()), 1, 32, format)
		if err != nil {
			t.Fatal(err)
		}
		if preview.Width != 32 || preview.Height != 24 {
			t.Fatalf("%s dimensions = %dx%d", format, preview.Width, preview.Height)
		}
		if len(preview.Data) == 0 {
			t.Fatalf("%s empty", format)
		}
		var config image.Config
		switch format {
		case "webp":
			if preview.MIMEType != "image/webp" {
				t.Fatal(preview.MIMEType)
			}
			config, err = webp.DecodeConfig(bytes.NewReader(preview.Data))
		case "jpeg":
			if preview.MIMEType != "image/jpeg" {
				t.Fatal(preview.MIMEType)
			}
			config, err = jpeg.DecodeConfig(bytes.NewReader(preview.Data))
		}
		if err != nil || config.Width != 32 || config.Height != 24 {
			t.Fatalf("%s invalid encoded image: %+v %v", format, config, err)
		}
	}
	if ViewerPreviewStorageKey(12, 3, strings.Repeat("a", 64), "jpeg") ==
		ViewerPreviewStorageKey(12, 3, strings.Repeat("a", 64), "webp") {
		t.Fatal("different encodings share cache key")
	}
}
