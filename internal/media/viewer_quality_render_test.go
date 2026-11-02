package media

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"testing"

	"golang.org/x/image/webp"
)

// A deliberately narrow image has 4097 pixels on its long edge, so tier
// changes exercise real resizing without allocating a 100MP test image.
func TestViewerQualityVariantsRenderRealBoundedPixels(t *testing.T) {
	input := image.NewRGBA(image.Rect(0, 0, 4097, 16))
	for y := 0; y < 16; y++ {
		for x := 0; x < 4097; x++ {
			input.SetRGBA(x, y, color.RGBA{
				R: uint8(x % 256), G: uint8(y * 13), B: 180, A: 255,
			})
		}
	}
	var source bytes.Buffer
	if err := jpeg.Encode(&source, input, &jpeg.Options{Quality: 95}); err != nil {
		t.Fatal(err)
	}
	for _, preset := range []ViewerQualityPreset{
		ViewerQualityEconomy, ViewerQualityBalanced, ViewerQualityHigh,
	} {
		for _, format := range []string{"webp", "jpeg"} {
			variant, err := ViewerQualityVariantFor(preset, format)
			if err != nil {
				t.Fatal(err)
			}
			preview, err := ViewerQualityPreview(bytes.NewReader(source.Bytes()), 1, variant)
			if err != nil {
				t.Fatalf("%s/%s: %v", preset, format, err)
			}
			if preview.Width != variant.MaxEdge || preview.Height <= 0 ||
				preview.Quality != variant.Quality || preview.MaxEdge != variant.MaxEdge {
				t.Fatalf("%s/%s rendered wrong variant: %+v", preset, format, preview)
			}
			if len(preview.Data) == 0 {
				t.Fatal("empty derived image")
			}
			var config image.Config
			switch format {
			case "webp":
				config, err = webp.DecodeConfig(bytes.NewReader(preview.Data))
				if preview.MIMEType != "image/webp" {
					t.Fatal(preview.MIMEType)
				}
			case "jpeg":
				config, err = jpeg.DecodeConfig(bytes.NewReader(preview.Data))
				if preview.MIMEType != "image/jpeg" {
					t.Fatal(preview.MIMEType)
				}
			}
			if err != nil || config.Width != variant.MaxEdge ||
				config.Height != preview.Height {
				t.Fatalf("%s/%s invalid encoded pixels: %v %v", preset, format, config, err)
			}
		}
	}
}

func TestViewerQualityRendererRejectsTampering(t *testing.T) {
	variant, _ := ViewerQualityVariantFor(ViewerQualityHigh, "webp")
	variant.Quality = 1
	if _, err := ViewerQualityPreview(bytes.NewReader(nil), 1, variant); err != ErrViewerQualityPreference {
		t.Fatalf("arbitrary quality bypassed policy: %v", err)
	}
	unsupported := ViewerQualityVariant{Preset: ViewerQualityHigh, Format: "png"}
	if _, err := ViewerQualityPreview(bytes.NewReader(nil), 1, unsupported); err != ErrViewerQualityPreference {
		t.Fatalf("unsupported format bypassed policy: %v", err)
	}
}
