package media

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"math"
	"strings"
	"testing"
)

type cr3TestIFDEntry struct {
	tag   uint16
	typ   uint16
	count uint32
	value []byte
}

func TestExtractCR3UsesLocalContainerMetadata(t *testing.T) {
	data := buildCR3Fixture(t)

	result, err := Extract("capture.cr3", bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	if result.Kind != KindImage || result.MIMEType != "image/x-canon-cr3" {
		t.Fatalf("classification kind=%q mime=%q", result.Kind, result.MIMEType)
	}
	if result.Width != 6000 || result.Height != 4000 || result.Orientation != 6 {
		t.Fatalf("dimensions/orientation=%dx%d/%d", result.Width, result.Height, result.Orientation)
	}
	if result.CameraMake != "Canon" || result.CameraModel != "EOS R5" || result.LensModel != "RF35mm F1" {
		t.Fatalf("camera metadata=%q/%q/%q", result.CameraMake, result.CameraModel, result.LensModel)
	}
	if result.CapturedAt == nil ||
		result.CapturedAt.UTC().Format("2006-01-02 15:04:05") != "2026-10-05 08:15:00" {
		t.Fatalf("captured_at=%v", result.CapturedAt)
	}
	if result.Latitude == nil || math.Abs(*result.Latitude-30.25) > 1e-9 {
		t.Fatalf("latitude=%v", result.Latitude)
	}
	if result.Longitude == nil || math.Abs(*result.Longitude-120.175) > 1e-9 {
		t.Fatalf("longitude=%v", result.Longitude)
	}
	if result.AltitudeM == nil || math.Abs(*result.AltitudeM-20) > 1e-9 {
		t.Fatalf("altitude=%v", result.AltitudeM)
	}
	if !strings.Contains(result.EXIFJSON, `"image_unique_id":"CR3-IMAGE-ID"`) {
		t.Fatalf("CR3 relation identity missing from EXIF JSON: %q", result.EXIFJSON)
	}
	if !strings.Contains(result.RelationJSON, "CR3-IMAGE-ID") {
		t.Fatalf("CR3 relation evidence=%q", result.RelationJSON)
	}
}

func TestCR3EmbeddedJPEGPreview(t *testing.T) {
	data := buildCR3Fixture(t)
	preview, err := CR3EmbeddedJPEGPreview(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(preview))
	if err != nil {
		t.Fatal(err)
	}
	if format != "jpeg" || cfg.Width != 8 || cfg.Height != 4 {
		t.Fatalf("preview format=%q dimensions=%dx%d", format, cfg.Width, cfg.Height)
	}
}

func TestExtractCR3DoesNotTrustSuffixWithoutCRXBrand(t *testing.T) {
	data := []byte("not a Canon CR3 file")
	result, err := Extract("renamed.cr3", bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	if result.Kind != KindOther || result.MIMEType == "image/x-canon-cr3" {
		t.Fatalf("renamed non-CR3 classified as kind=%q mime=%q", result.Kind, result.MIMEType)
	}
}

func TestCR3PreviewRejectsDeclaredJPEGMismatch(t *testing.T) {
	data := buildCR3Fixture(t)
	index := bytes.Index(data, []byte("PRVW"))
	if index < 0 {
		t.Fatal("PRVW atom missing")
	}
	payload := index + 4
	binary.BigEndian.PutUint16(data[payload+6:payload+8], 99)
	if _, err := CR3EmbeddedJPEGPreview(bytes.NewReader(data)); err == nil {
		t.Fatal("mismatched CR3 preview dimensions were accepted")
	}
}

func buildCR3Fixture(t *testing.T) []byte {
	t.Helper()

	ftyp := cr3TestBox("ftyp", append(
		append([]byte("crx "), 0, 0, 0, 1),
		[]byte("crx isom")...,
	))

	cmt1 := buildCR3TestIFD([]cr3TestIFDEntry{
		{tag: 0x010f, typ: 2, count: 6, value: []byte("Canon\x00")},
		{tag: 0x0110, typ: 2, count: 7, value: []byte("EOS R5\x00")},
		{tag: 0x0112, typ: 3, count: 1, value: cr3TestShort(6)},
	})
	cmt2 := buildCR3TestIFD([]cr3TestIFDEntry{
		{tag: 0x8827, typ: 3, count: 1, value: cr3TestShort(400)},
		{tag: 0x9003, typ: 2, count: 20, value: []byte("2026:10:05 08:15:00\x00")},
		{tag: 0xa002, typ: 4, count: 1, value: cr3TestLong(6000)},
		{tag: 0xa003, typ: 4, count: 1, value: cr3TestLong(4000)},
		{tag: 0xa420, typ: 2, count: 13, value: []byte("CR3-IMAGE-ID\x00")},
		{tag: 0xa434, typ: 2, count: 10, value: []byte("RF35mm F1\x00")},
	})
	cmt4 := buildCR3TestIFD([]cr3TestIFDEntry{
		{tag: 1, typ: 2, count: 2, value: []byte("N\x00")},
		{tag: 2, typ: 5, count: 3, value: cr3TestRationals([3][2]uint32{{30, 1}, {15, 1}, {0, 1}})},
		{tag: 3, typ: 2, count: 2, value: []byte("E\x00")},
		{tag: 4, typ: 5, count: 3, value: cr3TestRationals([3][2]uint32{{120, 1}, {10, 1}, {30, 1}})},
		{tag: 5, typ: 1, count: 1, value: []byte{0}},
		{tag: 6, typ: 5, count: 1, value: cr3TestRationals([3][2]uint32{{20, 1}})},
	})

	crawPayload := make([]byte, 40)
	binary.BigEndian.PutUint16(crawPayload[24:26], 6000)
	binary.BigEndian.PutUint16(crawPayload[26:28], 4000)

	canonMetadata := append([]byte(nil), cr3TestBox("CMT1", cmt1)...)
	canonMetadata = append(canonMetadata, cr3TestBox("CMT2", cmt2)...)
	canonMetadata = append(canonMetadata, cr3TestBox("CMT4", cmt4)...)
	canonMetadata = append(canonMetadata, cr3TestBox("CRAW", crawPayload)...)
	canonUUID := append(
		[]byte{0x85, 0xc0, 0xb6, 0x87, 0x82, 0x0f, 0x11, 0xe0, 0x81, 0x11, 0xf4, 0xce, 0x46, 0x2b, 0x6a, 0x48},
		canonMetadata...,
	)
	moov := cr3TestBox("moov", cr3TestBox("uuid", canonUUID))

	var jpegData bytes.Buffer
	img := image.NewNRGBA(image.Rect(0, 0, 8, 4))
	for y := 0; y < 4; y++ {
		for x := 0; x < 8; x++ {
			img.Set(x, y, color.NRGBA{R: uint8(20 * x), G: uint8(40 * y), B: 120, A: 255})
		}
	}
	if err := jpeg.Encode(&jpegData, img, &jpeg.Options{Quality: 85}); err != nil {
		t.Fatal(err)
	}
	previewHeader := make([]byte, 16)
	binary.BigEndian.PutUint32(previewHeader[0:4], uint32(16+jpegData.Len()))
	binary.BigEndian.PutUint16(previewHeader[4:6], 1)
	binary.BigEndian.PutUint16(previewHeader[6:8], 8)
	binary.BigEndian.PutUint16(previewHeader[8:10], 4)
	binary.BigEndian.PutUint32(previewHeader[12:16], uint32(jpegData.Len()))
	prvw := cr3TestBox("PRVW", append(previewHeader, jpegData.Bytes()...))
	previewUUID := append(
		[]byte{0xea, 0xf4, 0x2b, 0x5e, 0x1c, 0x98, 0x4b, 0x88, 0xb9, 0xfb, 0xb7, 0xdc, 0x40, 0x6e, 0x4d, 0x16},
		make([]byte, 8)...,
	)
	previewUUID = append(previewUUID, prvw...)

	return bytes.Join([][]byte{
		ftyp,
		moov,
		cr3TestBox("uuid", previewUUID),
		cr3TestBox("mdat", nil),
	}, nil)
}

func buildCR3TestIFD(entries []cr3TestIFDEntry) []byte {
	base := 2 + len(entries)*12 + 4
	out := make([]byte, base)
	binary.LittleEndian.PutUint16(out[:2], uint16(len(entries)))
	cursor := base
	for index, entry := range entries {
		offset := 2 + index*12
		binary.LittleEndian.PutUint16(out[offset:offset+2], entry.tag)
		binary.LittleEndian.PutUint16(out[offset+2:offset+4], entry.typ)
		binary.LittleEndian.PutUint32(out[offset+4:offset+8], entry.count)
		if len(entry.value) <= 4 {
			copy(out[offset+8:offset+12], entry.value)
			continue
		}
		binary.LittleEndian.PutUint32(out[offset+8:offset+12], uint32(cursor))
		out = append(out, entry.value...)
		cursor += len(entry.value)
	}
	return out
}

func cr3TestBox(kind string, payload []byte) []byte {
	out := make([]byte, 8, 8+len(payload))
	binary.BigEndian.PutUint32(out[:4], uint32(8+len(payload)))
	copy(out[4:8], kind)
	return append(out, payload...)
}

func cr3TestShort(value uint16) []byte {
	out := make([]byte, 2)
	binary.LittleEndian.PutUint16(out, value)
	return out
}

func cr3TestLong(value uint32) []byte {
	out := make([]byte, 4)
	binary.LittleEndian.PutUint32(out, value)
	return out
}

func cr3TestRationals(values [3][2]uint32) []byte {
	count := len(values)
	if values[1] == [2]uint32{} && values[2] == [2]uint32{} {
		count = 1
	}
	out := make([]byte, 0, count*8)
	for index := 0; index < count; index++ {
		pair := values[index]
		var raw [8]byte
		binary.LittleEndian.PutUint32(raw[:4], pair[0])
		binary.LittleEndian.PutUint32(raw[4:], pair[1])
		out = append(out, raw[:]...)
	}
	return out
}
