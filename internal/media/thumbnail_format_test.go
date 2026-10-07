package media

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
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

func TestOrientImageCoversAllEXIFOrientations(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 3, 2))
	pixels := []color.NRGBA{
		{R: 240, G: 10, B: 10, A: 255},
		{R: 10, G: 240, B: 10, A: 255},
		{R: 10, G: 10, B: 240, A: 255},
		{R: 240, G: 240, B: 10, A: 255},
		{R: 240, G: 10, B: 240, A: 255},
		{R: 10, G: 240, B: 240, A: 255},
	}
	for index, pixel := range pixels {
		source.Set(index%3, index/3, pixel)
	}

	tests := []struct {
		orientation int
		rows        [][]int
	}{
		{orientation: 1, rows: [][]int{{1, 2, 3}, {4, 5, 6}}},
		{orientation: 2, rows: [][]int{{3, 2, 1}, {6, 5, 4}}},
		{orientation: 3, rows: [][]int{{6, 5, 4}, {3, 2, 1}}},
		{orientation: 4, rows: [][]int{{4, 5, 6}, {1, 2, 3}}},
		{orientation: 5, rows: [][]int{{1, 4}, {2, 5}, {3, 6}}},
		{orientation: 6, rows: [][]int{{4, 1}, {5, 2}, {6, 3}}},
		{orientation: 7, rows: [][]int{{6, 3}, {5, 2}, {4, 1}}},
		{orientation: 8, rows: [][]int{{3, 6}, {2, 5}, {1, 4}}},
	}
	for _, test := range tests {
		t.Run(fmt.Sprintf("orientation_%d", test.orientation), func(t *testing.T) {
			got := orientImage(source, test.orientation)
			bounds := got.Bounds()
			if bounds.Dy() != len(test.rows) || bounds.Dx() != len(test.rows[0]) {
				t.Fatalf(
					"orientation=%d bounds=%v want=%dx%d",
					test.orientation,
					bounds,
					len(test.rows[0]),
					len(test.rows),
				)
			}
			for y, row := range test.rows {
				for x, label := range row {
					gotPixel := color.NRGBAModel.Convert(
						got.At(bounds.Min.X+x, bounds.Min.Y+y),
					).(color.NRGBA)
					if want := pixels[label-1]; gotPixel != want {
						t.Fatalf(
							"orientation=%d pixel(%d,%d)=%v want label=%d %v",
							test.orientation,
							x,
							y,
							gotPixel,
							label,
							want,
						)
					}
				}
			}
		})
	}
}

func TestThumbnailJPEGNormalizesOrientationWithoutDoubleRotatingHEIC(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 40, 20))
	for y := 0; y < source.Bounds().Dy(); y++ {
		for x := 0; x < source.Bounds().Dx(); x++ {
			source.Set(x, y, color.NRGBA{
				R: uint8(40 + x),
				G: uint8(80 + y),
				B: 160,
				A: 255,
			})
		}
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, source); err != nil {
		t.Fatal(err)
	}

	thumbnail, err := ThumbnailJPEG(bytes.NewReader(encoded.Bytes()), 6, 100)
	if err != nil {
		t.Fatal(err)
	}
	if thumbnail.Width != 20 || thumbnail.Height != 40 {
		t.Fatalf("oriented thumbnail=%dx%d want=20x40", thumbnail.Width, thumbnail.Height)
	}
	if got := thumbnailDecodeOrientation("jpeg", 6); got != 6 {
		t.Fatalf("jpeg orientation policy=%d want=6", got)
	}
	if got := thumbnailDecodeOrientation("heic", 6); got != 1 {
		t.Fatalf("heic orientation policy=%d want=1", got)
	}
}
