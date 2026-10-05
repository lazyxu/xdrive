package media

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"testing"
)

func TestTIFFEmbeddedJPEGPreviewFromReducedIFD(t *testing.T) {
	preview := encodeDNGPreviewJPEG(t, 8, 4)
	data := buildDNGWithJPEGPreview(preview, true)

	got, err := TIFFEmbeddedJPEGPreview(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(got))
	if err != nil {
		t.Fatal(err)
	}
	if format != "jpeg" || cfg.Width != 8 || cfg.Height != 4 {
		t.Fatalf("preview=%s %dx%d", format, cfg.Width, cfg.Height)
	}

	thumbnail, err := ThumbnailJPEG(bytes.NewReader(got), 1, 4)
	if err != nil {
		t.Fatal(err)
	}
	if thumbnail.Width != 4 || thumbnail.Height != 2 {
		t.Fatalf("thumbnail=%dx%d", thumbnail.Width, thumbnail.Height)
	}
}

func TestDNGEmbeddedJPEGPreviewCompatibilityWrapper(t *testing.T) {
	data := buildDNGWithJPEGPreview(encodeDNGPreviewJPEG(t, 8, 4), true)
	generic, err := TIFFEmbeddedJPEGPreview(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	dng, err := DNGEmbeddedJPEGPreview(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(generic, dng) {
		t.Fatal("DNG compatibility wrapper returned different preview bytes")
	}
}

func TestDNGEmbeddedJPEGPreviewRejectsNonReducedIFD(t *testing.T) {
	data := buildDNGWithJPEGPreview(encodeDNGPreviewJPEG(t, 4, 4), false)
	if _, err := DNGEmbeddedJPEGPreview(bytes.NewReader(data)); err == nil {
		t.Fatal("full-resolution IFD was accepted as preview")
	}
}

func TestDNGEmbeddedJPEGPreviewRejectsOutOfBoundsPayload(t *testing.T) {
	data := buildDNGWithJPEGPreview(encodeDNGPreviewJPEG(t, 4, 4), true)
	// JPEGInterchangeFormatLength entry is the sixth entry.
	const root = 8
	const entry = 2 + 5*12
	binary.LittleEndian.PutUint32(data[root+entry+8:root+entry+12], uint32(len(data)))
	if _, err := DNGEmbeddedJPEGPreview(bytes.NewReader(data)); err == nil {
		t.Fatal("out-of-bounds DNG preview was accepted")
	}
}

func encodeDNGPreviewJPEG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.NRGBA{R: uint8(x * 17), G: uint8(y * 29), B: 120, A: 255})
		}
	}
	var out bytes.Buffer
	if err := jpeg.Encode(&out, img, &jpeg.Options{Quality: 80}); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func buildDNGWithJPEGPreview(preview []byte, reduced bool) []byte {
	const (
		rootOffset = 8
		entries    = 6
	)
	ifdSize := 2 + entries*12 + 4
	previewOffset := rootOffset + ifdSize
	data := make([]byte, previewOffset+len(preview))
	copy(data[:8], []byte{'I', 'I', 42, 0, 8, 0, 0, 0})
	binary.LittleEndian.PutUint16(data[rootOffset:rootOffset+2], entries)

	putLong := func(index int, tag uint16, value uint32) {
		base := rootOffset + 2 + index*12
		binary.LittleEndian.PutUint16(data[base:base+2], tag)
		binary.LittleEndian.PutUint16(data[base+2:base+4], 4)
		binary.LittleEndian.PutUint32(data[base+4:base+8], 1)
		binary.LittleEndian.PutUint32(data[base+8:base+12], value)
	}
	putShort := func(index int, tag uint16, value uint16) {
		base := rootOffset + 2 + index*12
		binary.LittleEndian.PutUint16(data[base:base+2], tag)
		binary.LittleEndian.PutUint16(data[base+2:base+4], 3)
		binary.LittleEndian.PutUint32(data[base+4:base+8], 1)
		binary.LittleEndian.PutUint16(data[base+8:base+10], value)
	}

	var subfile uint32
	if reduced {
		subfile = 1
	}
	putLong(0, 0x00fe, subfile)
	putLong(1, 0x0100, 8)
	putLong(2, 0x0101, 4)
	putShort(3, 0x0103, 6)
	putLong(4, 0x0201, uint32(previewOffset))
	putLong(5, 0x0202, uint32(len(preview)))
	copy(data[previewOffset:], preview)
	return data
}
