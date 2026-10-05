package media

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"math"
	"strings"
	"testing"
	"time"
)

func buildTIFFFixture() []byte {
	data := make([]byte, 600)
	copy(data[:2], "II")
	binary.LittleEndian.PutUint16(data[2:4], 42)
	binary.LittleEndian.PutUint32(data[4:8], 8)

	entry := func(base int, tag, typ uint16, count, value uint32) {
		binary.LittleEndian.PutUint16(data[base:base+2], tag)
		binary.LittleEndian.PutUint16(data[base+2:base+4], typ)
		binary.LittleEndian.PutUint32(data[base+4:base+8], count)
		binary.LittleEndian.PutUint32(data[base+8:base+12], value)
	}
	putASCII := func(offset int, value string) {
		copy(data[offset:], append([]byte(value), 0))
	}
	putRational := func(offset int, numerator, denominator uint32) {
		binary.LittleEndian.PutUint32(data[offset:offset+4], numerator)
		binary.LittleEndian.PutUint32(data[offset+4:offset+8], denominator)
	}

	// IFD0: make, model, orientation, Exif IFD and GPS IFD.
	binary.LittleEndian.PutUint16(data[8:10], 5)
	entry(10, 0x010f, 2, 6, 100)
	entry(22, 0x0110, 2, 7, 110)
	entry(34, 0x0112, 3, 1, 6)
	entry(46, 0x8769, 4, 1, 140)
	entry(58, 0x8825, 4, 1, 260)
	putASCII(100, "Canon")
	putASCII(110, "EOS R5")

	// Exif IFD.
	binary.LittleEndian.PutUint16(data[140:142], 7)
	entry(142, 0x9003, 2, 20, 360)
	entry(154, 0xa434, 2, 10, 384)
	entry(166, 0xa002, 4, 1, 1920)
	entry(178, 0xa003, 4, 1, 1080)
	entry(190, 0x8827, 3, 1, 400)
	entry(202, 0x829a, 5, 1, 400)
	entry(214, 0x829d, 5, 1, 408)
	putASCII(360, "2026:09:30 08:15:00")
	putASCII(384, "RF35mm F1")
	putRational(400, 1, 125)
	putRational(408, 18, 10)

	// GPS IFD: 30.25 N, 120.175 E, altitude 20 m.
	binary.LittleEndian.PutUint16(data[260:262], 6)
	entry(262, 1, 2, 2, 78)
	entry(274, 2, 5, 3, 424)
	entry(286, 3, 2, 2, 69)
	entry(298, 4, 5, 3, 448)
	entry(310, 5, 1, 1, 0)
	entry(322, 6, 5, 1, 472)
	putRational(424, 30, 1)
	putRational(432, 15, 1)
	putRational(440, 0, 1)
	putRational(448, 120, 1)
	putRational(456, 10, 1)
	putRational(464, 30, 1)
	putRational(472, 20, 1)

	return data
}

func TestParseTIFFExtractsOrientationCameraAndGPS(t *testing.T) {
	exif, err := parseTIFF(buildTIFFFixture())
	if err != nil {
		t.Fatal(err)
	}
	if exif.Orientation != 6 ||
		exif.CameraMake != "Canon" ||
		exif.CameraModel != "EOS R5" ||
		exif.LensModel != "RF35mm F1" {
		t.Fatalf("unexpected exif: %+v", exif)
	}
	if exif.PixelWidth != 1920 || exif.PixelHeight != 1080 {
		t.Fatalf("dimensions=%dx%d", exif.PixelWidth, exif.PixelHeight)
	}
	if exif.CapturedAt == nil ||
		exif.CapturedAt.UTC().Format("2006-01-02 15:04:05") != "2026-09-30 08:15:00" {
		t.Fatalf("captured_at=%v", exif.CapturedAt)
	}
	if exif.Latitude == nil || math.Abs(*exif.Latitude-30.25) > 1e-9 {
		t.Fatalf("latitude=%v", exif.Latitude)
	}
	if exif.Longitude == nil || math.Abs(*exif.Longitude-120.175) > 1e-9 {
		t.Fatalf("longitude=%v", exif.Longitude)
	}
	if exif.AltitudeM == nil || *exif.AltitudeM != 20 {
		t.Fatalf("altitude=%v", exif.AltitudeM)
	}
	if exif.Fields["iso"] != uint64(400) {
		t.Fatalf("iso=%v", exif.Fields["iso"])
	}
	if exposure, ok := exif.Fields["exposure_time_seconds"].(float64); !ok ||
		math.Abs(exposure-1.0/125.0) > 1e-12 {
		t.Fatalf("exposure=%v", exif.Fields["exposure_time_seconds"])
	}
}

func TestEmbeddedEXIFFindsTIFFInContainer(t *testing.T) {
	container := append([]byte("fake-container-prefix-Exif\x00\x00"), buildTIFFFixture()...)
	exif, err := readEmbeddedEXIF(bytes.NewReader(container))
	if err != nil {
		t.Fatal(err)
	}
	if exif == nil || exif.CameraModel != "EOS R5" || exif.Latitude == nil {
		t.Fatalf("embedded exif=%+v", exif)
	}
}

func TestExtractMP4Metadata(t *testing.T) {
	box := func(kind string, payload []byte) []byte {
		out := make([]byte, 8+len(payload))
		binary.BigEndian.PutUint32(out[:4], uint32(len(out)))
		copy(out[4:8], kind)
		copy(out[8:], payload)
		return out
	}
	join := func(parts ...[]byte) []byte {
		return bytes.Join(parts, nil)
	}
	full := func(size int) []byte {
		return make([]byte, size)
	}

	mvhd := full(100)
	created := time.Date(2026, 9, 30, 8, 0, 0, 0, time.UTC)
	binary.BigEndian.PutUint32(
		mvhd[4:8],
		uint32(2_082_844_800+created.Unix()),
	)
	binary.BigEndian.PutUint32(mvhd[12:16], 1000)
	binary.BigEndian.PutUint32(mvhd[16:20], 5000)

	videoTKHD := full(84)
	one := uint32(1 << 16)
	negOne := uint32(0xffff0000)
	binary.BigEndian.PutUint32(videoTKHD[44:48], one)
	binary.BigEndian.PutUint32(videoTKHD[52:56], negOne)
	binary.BigEndian.PutUint32(videoTKHD[72:76], 1<<30)
	binary.BigEndian.PutUint32(videoTKHD[76:80], 1920<<16)
	binary.BigEndian.PutUint32(videoTKHD[80:84], 1080<<16)

	videoMDHD := full(24)
	binary.BigEndian.PutUint32(videoMDHD[12:16], 30_000)
	binary.BigEndian.PutUint32(videoMDHD[16:20], 150_000)
	videoHDLR := full(24)
	copy(videoHDLR[8:12], "vide")
	videoSTSD := full(16)
	binary.BigEndian.PutUint32(videoSTSD[4:8], 1)
	binary.BigEndian.PutUint32(videoSTSD[8:12], 8)
	copy(videoSTSD[12:16], "hvc1")
	videoSTTS := full(16)
	binary.BigEndian.PutUint32(videoSTTS[4:8], 1)
	binary.BigEndian.PutUint32(videoSTTS[8:12], 150)
	binary.BigEndian.PutUint32(videoSTTS[12:16], 1000)
	videoSTBL := box(
		"stbl",
		join(box("stsd", videoSTSD), box("stts", videoSTTS)),
	)
	videoMINF := box("minf", videoSTBL)
	videoMDIA := box(
		"mdia",
		join(box("mdhd", videoMDHD), box("hdlr", videoHDLR), videoMINF),
	)
	videoTRAK := box("trak", join(box("tkhd", videoTKHD), videoMDIA))

	audioTKHD := full(84)
	audioMDHD := full(24)
	binary.BigEndian.PutUint32(audioMDHD[12:16], 48_000)
	binary.BigEndian.PutUint32(audioMDHD[16:20], 240_000)
	audioHDLR := full(24)
	copy(audioHDLR[8:12], "soun")
	audioSTSD := full(16)
	binary.BigEndian.PutUint32(audioSTSD[4:8], 1)
	binary.BigEndian.PutUint32(audioSTSD[8:12], 8)
	copy(audioSTSD[12:16], "mp4a")
	audioSTBL := box("stbl", box("stsd", audioSTSD))
	audioMINF := box("minf", audioSTBL)
	audioMDIA := box(
		"mdia",
		join(box("mdhd", audioMDHD), box("hdlr", audioHDLR), audioMINF),
	)
	audioTRAK := box("trak", join(box("tkhd", audioTKHD), audioMDIA))

	ftypPayload := []byte("isom\x00\x00\x02\x00isommp41")
	file := join(
		box("ftyp", ftypPayload),
		box("moov", join(box("mvhd", mvhd), videoTRAK, audioTRAK)),
	)

	result, err := Extract("clip.mp4", bytes.NewReader(file), int64(len(file)))
	if err != nil {
		t.Fatal(err)
	}
	if result.Kind != KindVideo || result.Width != 1920 || result.Height != 1080 {
		t.Fatalf("result=%+v", result)
	}
	if result.RotationDegrees != 90 {
		t.Fatalf("rotation=%d", result.RotationDegrees)
	}
	if result.DurationMS != 5000 || math.Abs(result.FrameRate-30) > 1e-9 {
		t.Fatalf("duration/fps=%d %.4f", result.DurationMS, result.FrameRate)
	}
	if result.VideoCodec != "hvc1" || result.AudioCodec != "mp4a" {
		t.Fatalf("codecs=%q/%q", result.VideoCodec, result.AudioCodec)
	}
	if result.CapturedAt == nil || !result.CapturedAt.Equal(created) {
		t.Fatalf("captured_at=%v", result.CapturedAt)
	}
}

func TestThumbnailJPEGHonorsOrientation(t *testing.T) {
	src := image.NewNRGBA(image.Rect(0, 0, 2, 1))
	src.Set(0, 0, color.NRGBA{R: 255, A: 255})
	src.Set(1, 0, color.NRGBA{B: 255, A: 255})

	var encoded bytes.Buffer
	if err := png.Encode(&encoded, src); err != nil {
		t.Fatal(err)
	}
	thumbnail, err := ThumbnailJPEG(bytes.NewReader(encoded.Bytes()), 6, 512)
	if err != nil {
		t.Fatal(err)
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(thumbnail.Data))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Width != 1 || cfg.Height != 2 {
		t.Fatalf("thumbnail dimensions=%dx%d", cfg.Width, cfg.Height)
	}
	if thumbnail.MIMEType != "image/jpeg" ||
		thumbnail.Width != 1 ||
		thumbnail.Height != 2 {
		t.Fatalf("thumbnail metadata=%+v", thumbnail)
	}
}

func TestExtractNonMediaRemainsClassifiedWithoutError(t *testing.T) {
	result, err := Extract("notes.txt", bytes.NewReader([]byte("hello")), 5)
	if err != nil {
		t.Fatal(err)
	}
	if result.Kind != KindOther {
		t.Fatalf("kind=%q", result.Kind)
	}
}

func buildDNGFixture() []byte {
	data := buildTIFFFixture()

	// Extend IFD0 with DNGVersion and UniqueCameraModel.
	binary.LittleEndian.PutUint16(data[8:10], 7)

	version := 70
	binary.LittleEndian.PutUint16(data[version:version+2], 0xc612)
	binary.LittleEndian.PutUint16(data[version+2:version+4], 1)
	binary.LittleEndian.PutUint32(data[version+4:version+8], 4)
	copy(data[version+8:version+12], []byte{1, 6, 0, 0})

	model := 82
	binary.LittleEndian.PutUint16(data[model:model+2], 0xc614)
	binary.LittleEndian.PutUint16(data[model+2:model+4], 2)
	const uniqueModel = "Canon EOS R5 DNG"
	binary.LittleEndian.PutUint32(data[model+4:model+8], uint32(len(uniqueModel)+1))
	binary.LittleEndian.PutUint32(data[model+8:model+12], 500)
	copy(data[500:], append([]byte(uniqueModel), 0))
	return data
}

func TestExtractDNGUsesLocalTIFFMetadata(t *testing.T) {
	data := buildDNGFixture()
	result, err := Extract("capture.dng", bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	if result.Kind != KindImage || result.MIMEType != "image/x-adobe-dng" {
		t.Fatalf("classification kind=%q mime=%q", result.Kind, result.MIMEType)
	}
	if result.Width != 1920 || result.Height != 1080 || result.Orientation != 6 {
		t.Fatalf("dimensions/orientation=%dx%d/%d", result.Width, result.Height, result.Orientation)
	}
	if result.CameraMake != "Canon" || result.CameraModel != "EOS R5" || result.LensModel != "RF35mm F1" {
		t.Fatalf("camera metadata=%q/%q/%q", result.CameraMake, result.CameraModel, result.LensModel)
	}
	if result.Latitude == nil || result.Longitude == nil || result.CapturedAt == nil {
		t.Fatalf("missing local DNG EXIF/GPS metadata: %+v", result)
	}
	if !strings.Contains(result.EXIFJSON, "\"dng_version\":\"1.6.0.0\"") ||
		!strings.Contains(result.EXIFJSON, "\"dng_unique_camera_model\":\"Canon EOS R5 DNG\"") {
		t.Fatalf("DNG fields missing from EXIF JSON: %q", result.EXIFJSON)
	}
}

func TestExtractDNGDoesNotTrustSuffixWithoutTIFFBytes(t *testing.T) {
	data := []byte("not a DNG file")
	result, err := Extract("renamed.dng", bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	if result.Kind != KindOther {
		t.Fatalf("renamed non-DNG was classified as %q with mime %q", result.Kind, result.MIMEType)
	}
}

func TestExtractTIFFBasedRAWUsesLocalMetadata(t *testing.T) {
	data := buildTIFFFixture()
	for _, test := range []struct {
		name     string
		mimeType string
	}{
		{name: "capture.nef", mimeType: "image/x-nikon-nef"},
		{name: "capture.arw", mimeType: "image/x-sony-arw"},
	} {
		t.Run(test.name, func(t *testing.T) {
			result, err := Extract(test.name, bytes.NewReader(data), int64(len(data)))
			if err != nil {
				t.Fatal(err)
			}
			if result.Kind != KindImage || result.MIMEType != test.mimeType {
				t.Fatalf("classification kind=%q mime=%q", result.Kind, result.MIMEType)
			}
			if result.Width != 1920 || result.Height != 1080 || result.Orientation != 6 {
				t.Fatalf("dimensions/orientation=%dx%d/%d", result.Width, result.Height, result.Orientation)
			}
			if result.CameraMake != "Canon" || result.CameraModel != "EOS R5" || result.LensModel != "RF35mm F1" {
				t.Fatalf("camera metadata=%q/%q/%q", result.CameraMake, result.CameraModel, result.LensModel)
			}
			if result.Latitude == nil || result.Longitude == nil || result.CapturedAt == nil {
				t.Fatalf("missing local RAW EXIF/GPS metadata: %+v", result)
			}
			if strings.TrimSpace(result.EXIFJSON) == "" {
				t.Fatal("local RAW EXIF JSON is empty")
			}
		})
	}
}

func TestExtractTIFFBasedRAWDoesNotTrustSuffixWithoutTIFFBytes(t *testing.T) {
	for _, name := range []string{"renamed.nef", "renamed.arw"} {
		t.Run(name, func(t *testing.T) {
			data := []byte("not a TIFF-based RAW file")
			result, err := Extract(name, bytes.NewReader(data), int64(len(data)))
			if err != nil {
				t.Fatal(err)
			}
			if result.Kind != KindOther {
				t.Fatalf("renamed non-RAW was classified as %q with mime %q", result.Kind, result.MIMEType)
			}
		})
	}
}

func TestDNGVersionRequiresFourBytes(t *testing.T) {
	if got := dngVersion([]byte{1, 6, 0, 0}); got != "1.6.0.0" {
		t.Fatalf("version=%q", got)
	}
	if got := dngVersion([]byte{1, 6, 0}); got != "" {
		t.Fatalf("short version accepted: %q", got)
	}
}
