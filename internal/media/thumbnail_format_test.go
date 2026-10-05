package media

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/jpeg"
	"testing"

	"github.com/gen2brain/avif"
	"golang.org/x/image/bmp"
	"golang.org/x/image/tiff"
)

func TestThumbnailJPEGAdditionalImageFormats(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 3, 2))
	for y := 0; y < 2; y++ {
		for x := 0; x < 3; x++ {
			img.Set(x, y, color.NRGBA{
				R: uint8(40 + x*20),
				G: uint8(60 + y*30),
				B: 120,
				A: 255,
			})
		}
	}

	var bmpBytes bytes.Buffer
	if err := bmp.Encode(&bmpBytes, img); err != nil {
		t.Fatal(err)
	}
	var tiffBytes bytes.Buffer
	if err := tiff.Encode(&tiffBytes, img, nil); err != nil {
		t.Fatal(err)
	}
	var avifBytes bytes.Buffer
	if err := avif.Encode(&avifBytes, img); err != nil {
		t.Fatal(err)
	}
	webpBytes, err := base64.StdEncoding.DecodeString(
		"UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA",
	)
	if err != nil {
		t.Fatal(err)
	}

	for _, test := range []struct {
		name string
		data []byte
	}{
		{name: "avif", data: avifBytes.Bytes()},
		{name: "bmp", data: bmpBytes.Bytes()},
		{name: "tiff", data: tiffBytes.Bytes()},
		{name: "webp", data: webpBytes},
	} {
		t.Run(test.name, func(t *testing.T) {
			thumbnail, err := ThumbnailJPEG(bytes.NewReader(test.data), 1, 64)
			if err != nil {
				t.Fatal(err)
			}
			if thumbnail.MIMEType != "image/jpeg" || len(thumbnail.Data) == 0 {
				t.Fatalf("thumbnail=%+v", thumbnail)
			}
			if _, err := jpeg.Decode(bytes.NewReader(thumbnail.Data)); err != nil {
				t.Fatalf("generated thumbnail is not JPEG: %v", err)
			}
			if thumbnail.SourceKind != test.name {
				t.Fatalf("source kind=%q want=%q", thumbnail.SourceKind, test.name)
			}
		})
	}
}

func TestThumbnailJPEGAnalysisPreviewEdge(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 1600, 800))
	for y := 0; y < 800; y++ {
		for x := 0; x < 1600; x++ {
			img.Set(x, y, color.NRGBA{
				R: uint8((x / 8) % 255),
				G: uint8((y / 4) % 255),
				B: 160,
				A: 255,
			})
		}
	}
	var source bytes.Buffer
	if err := jpeg.Encode(&source, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatal(err)
	}

	preview, err := ThumbnailJPEG(
		bytes.NewReader(source.Bytes()),
		1,
		AnalysisPreviewEdge,
	)
	if err != nil {
		t.Fatal(err)
	}
	if preview.MaxEdge != AnalysisPreviewEdge ||
		preview.Width != AnalysisPreviewEdge ||
		preview.Height != AnalysisPreviewEdge/2 {
		t.Fatalf("analysis preview=%+v", preview)
	}
	if preview.MIMEType != "image/jpeg" || len(preview.Data) == 0 {
		t.Fatalf("analysis preview JPEG=%+v", preview)
	}
}
