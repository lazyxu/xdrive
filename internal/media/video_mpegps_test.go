package media

import (
	"bytes"
	"math"
	"testing"
)

func TestExtractMPEG2ProgramStreamMetadata(t *testing.T) {
	data := buildMPEGProgramStreamFixture(true, 720, 480, 4, false)
	result, err := Extract("movie.mpg", bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	if result.Kind != KindVideo || result.MIMEType != "video/mpeg" {
		t.Fatalf("classification=%+v", result)
	}
	if result.Width != 720 || result.Height != 480 {
		t.Fatalf("dimensions=%dx%d", result.Width, result.Height)
	}
	if result.DurationMS != 5000 {
		t.Fatalf("duration=%d", result.DurationMS)
	}
	if math.Abs(result.FrameRate-30000.0/1001) > 0.001 {
		t.Fatalf("frame rate=%f", result.FrameRate)
	}
	if result.VideoCodec != "mpeg2-video" || result.AudioCodec != "mp2" {
		t.Fatalf("codecs=%q/%q", result.VideoCodec, result.AudioCodec)
	}
	if result.BitRate <= 0 || result.VideoJSON == "" {
		t.Fatalf("technical metadata=%+v", result)
	}
}

func TestExtractMPEG1ProgramStreamMetadata(t *testing.T) {
	data := buildMPEGProgramStreamFixture(false, 352, 288, 3, false)
	result, err := Extract("movie.mpeg", bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	if result.Width != 352 || result.Height != 288 {
		t.Fatalf("dimensions=%dx%d", result.Width, result.Height)
	}
	if result.DurationMS != 5000 {
		t.Fatalf("duration=%d", result.DurationMS)
	}
	if math.Abs(result.FrameRate-25) > 0.001 {
		t.Fatalf("frame rate=%f", result.FrameRate)
	}
	if result.VideoCodec != "mpeg1-video" || result.AudioCodec != "mp2" {
		t.Fatalf("codecs=%q/%q", result.VideoCodec, result.AudioCodec)
	}
}

func TestExtractMPEGProgramStreamUsesBoundedTailWindowForDuration(t *testing.T) {
	data := buildMPEGProgramStreamFixture(true, 720, 576, 3, true)
	if int64(len(data)) <= maxPSMetadataScanBytes {
		t.Fatalf("fixture did not exceed metadata window: %d", len(data))
	}
	result, err := Extract("long.mpg", bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	if result.DurationMS != 5000 {
		t.Fatalf("duration=%d", result.DurationMS)
	}
	if result.Width != 720 || result.Height != 576 || result.VideoCodec != "mpeg2-video" {
		t.Fatalf("metadata=%+v", result)
	}
}

func TestExtractMPEGProgramStreamFailsClosedForElementaryOrInvalidData(t *testing.T) {
	for _, test := range []struct {
		name string
		data []byte
	}{
		{
			name: "elementary.mpg",
			data: testMPEGSequenceHeader(720, 480, 4, true),
		},
		{
			name: "broken.mpeg",
			data: []byte("not an mpeg program stream"),
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			result, err := Extract(test.name, bytes.NewReader(test.data), int64(len(test.data)))
			if err != nil {
				t.Fatal(err)
			}
			if result.Kind != KindVideo {
				t.Fatalf("kind=%q", result.Kind)
			}
			if result.DurationMS != 0 || result.Width != 0 || result.Height != 0 ||
				result.VideoCodec != "" || result.AudioCodec != "" || result.VideoJSON != "" {
				t.Fatalf("invalid/elementary stream produced metadata: %+v", result)
			}
		})
	}
}

func TestMPEGPSPrivateAudioCodec(t *testing.T) {
	for _, test := range []struct {
		id   byte
		want string
	}{
		{id: 0x80, want: "ac3"},
		{id: 0x88, want: "dts"},
		{id: 0xa0, want: "lpcm"},
		{id: 0x20, want: ""},
	} {
		if got := mpegPSPrivateAudioCodec([]byte{test.id}); got != test.want {
			t.Fatalf("substream 0x%02x codec=%q want=%q", test.id, got, test.want)
		}
	}
}

func buildMPEGProgramStreamFixture(
	mpeg2 bool,
	width, height int,
	frameRateCode byte,
	separateTail bool,
) []byte {
	firstPTS := uint64(90_000)
	lastPTS := uint64(540_000)

	firstVideo := testMPEGPES(
		0xe0,
		firstPTS,
		testMPEGSequenceHeader(width, height, frameRateCode, mpeg2),
		mpeg2,
	)
	audio := testMPEGPES(
		0xc0,
		firstPTS,
		[]byte{0xff, 0xfd, 0x90, 0x64},
		mpeg2,
	)
	lastVideo := testMPEGPES(
		0xe0,
		lastPTS,
		[]byte{0x00, 0x00, 0x01, 0x00, 0x11, 0x22, 0x33},
		mpeg2,
	)

	out := make([]byte, 0, len(firstVideo)+len(audio)+len(lastVideo)+64)
	out = append(out, testMPEGPSPackHeader()...)
	out = append(out, firstVideo...)
	out = append(out, audio...)
	if separateTail {
		out = append(out, make([]byte, int(maxPSMetadataScanBytes)+1024)...)
		out = append(out, testMPEGPSPackHeader()...)
	}
	out = append(out, lastVideo...)
	out = append(out, 0x00, 0x00, 0x01, mpegPSProgramEndCode)
	return out
}

func testMPEGPSPackHeader() []byte {
	return []byte{
		0x00, 0x00, 0x01, mpegPSPackStartCode,
		0x44, 0x00, 0x04, 0x00, 0x04, 0x01,
		0x00, 0x00, 0x03, 0xf8,
	}
}

func testMPEGPES(streamID byte, pts uint64, payload []byte, mpeg2 bool) []byte {
	var header []byte
	if mpeg2 {
		header = []byte{0x80, 0x80, 0x05}
		header = append(header, encodeTestPTS(pts)...)
	} else {
		header = append(header, encodeTestPTS(pts)...)
	}
	length := len(header) + len(payload)
	if length > 0xffff {
		panic("test PES too large")
	}
	out := []byte{
		0x00, 0x00, 0x01, streamID,
		byte(length >> 8), byte(length),
	}
	out = append(out, header...)
	out = append(out, payload...)
	return out
}

func testMPEGSequenceHeader(width, height int, frameRateCode byte, mpeg2 bool) []byte {
	if width <= 0 || width > 0xfff || height <= 0 || height > 0xfff {
		panic("invalid test MPEG dimensions")
	}
	out := []byte{
		0x00, 0x00, 0x01, 0xb3,
		byte(width >> 4),
		byte((width&0x0f)<<4 | (height>>8)&0x0f),
		byte(height),
		0x30 | (frameRateCode & 0x0f),
		0x00, 0x00, 0x00, 0x00,
	}
	if mpeg2 {
		out = append(out,
			0x00, 0x00, 0x01, 0xb5,
			0x10, 0x00, 0x00, 0x00,
		)
	}
	return out
}
