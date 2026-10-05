package media

import (
	"bytes"
	"encoding/binary"
	"math"
	"testing"
)

func TestExtractMatroskaAndWebMMetadata(t *testing.T) {
	for _, test := range []struct {
		name       string
		videoCodec string
		audioCodec string
		wantVideo  string
		wantAudio  string
	}{
		{
			name:       "movie.mkv",
			videoCodec: "V_MPEG4/ISO/AVC",
			audioCodec: "A_AAC",
			wantVideo:  "h264",
			wantAudio:  "aac",
		},
		{
			name:       "movie.webm",
			videoCodec: "V_VP9",
			audioCodec: "A_OPUS",
			wantVideo:  "vp9",
			wantAudio:  "opus",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			data := buildMatroskaFixture(test.videoCodec, test.audioCodec)
			result, err := Extract(test.name, bytes.NewReader(data), int64(len(data)))
			if err != nil {
				t.Fatal(err)
			}
			if result.Kind != KindVideo || result.Width != 1920 || result.Height != 1080 {
				t.Fatalf("classification/dimensions=%+v", result)
			}
			if result.DurationMS != 5000 {
				t.Fatalf("duration=%d", result.DurationMS)
			}
			if math.Abs(result.FrameRate-30) > 0.001 {
				t.Fatalf("frame rate=%f", result.FrameRate)
			}
			if result.VideoCodec != test.wantVideo || result.AudioCodec != test.wantAudio {
				t.Fatalf("codecs=%q/%q", result.VideoCodec, result.AudioCodec)
			}
			if result.BitRate <= 0 || result.VideoJSON == "" {
				t.Fatalf("technical metadata=%+v", result)
			}
		})
	}
}

func TestExtractAVIMetadata(t *testing.T) {
	data := buildAVIFixture()
	result, err := Extract("camera.avi", bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	if result.Kind != KindVideo || result.Width != 1280 || result.Height != 720 {
		t.Fatalf("classification/dimensions=%+v", result)
	}
	if result.DurationMS != 5000 {
		t.Fatalf("duration=%d", result.DurationMS)
	}
	if math.Abs(result.FrameRate-30) > 0.001 {
		t.Fatalf("frame rate=%f", result.FrameRate)
	}
	if result.VideoCodec != "h264" || result.AudioCodec != "aac" {
		t.Fatalf("codecs=%q/%q", result.VideoCodec, result.AudioCodec)
	}
	if result.BitRate <= 0 || result.VideoJSON == "" {
		t.Fatalf("technical metadata=%+v", result)
	}
}

func TestLegacyVideoParsersFailClosedOnInvalidContainers(t *testing.T) {
	for _, name := range []string{"broken.mkv", "broken.webm", "broken.avi"} {
		t.Run(name, func(t *testing.T) {
			data := []byte("not a video container")
			result, err := Extract(name, bytes.NewReader(data), int64(len(data)))
			if err != nil {
				t.Fatal(err)
			}
			if result.Kind != KindVideo {
				t.Fatalf("classified kind=%q", result.Kind)
			}
			if result.DurationMS != 0 || result.Width != 0 || result.Height != 0 ||
				result.VideoCodec != "" || result.VideoJSON != "" {
				t.Fatalf("invalid container produced metadata: %+v", result)
			}
		})
	}
}

func buildMatroskaFixture(videoCodec, audioCodec string) []byte {
	info := testEBMLElement([]byte{0x15, 0x49, 0xa9, 0x66}, bytes.Join([][]byte{
		testEBMLElement([]byte{0x2a, 0xd7, 0xb1}, testEBMLUint(1_000_000)),
		testEBMLElement([]byte{0x44, 0x89}, testEBMLFloat64(5000)),
	}, nil))

	video := testEBMLElement([]byte{0xae}, bytes.Join([][]byte{
		testEBMLElement([]byte{0x83}, testEBMLUint(1)),
		testEBMLElement([]byte{0x86}, []byte(videoCodec)),
		testEBMLElement([]byte{0x23, 0xe3, 0x83}, testEBMLUint(33_333_333)),
		testEBMLElement([]byte{0xe0}, bytes.Join([][]byte{
			testEBMLElement([]byte{0xb0}, testEBMLUint(1920)),
			testEBMLElement([]byte{0xba}, testEBMLUint(1080)),
		}, nil)),
	}, nil))
	audio := testEBMLElement([]byte{0xae}, bytes.Join([][]byte{
		testEBMLElement([]byte{0x83}, testEBMLUint(2)),
		testEBMLElement([]byte{0x86}, []byte(audioCodec)),
	}, nil))
	tracks := testEBMLElement(
		[]byte{0x16, 0x54, 0xae, 0x6b},
		append(video, audio...),
	)
	segment := testEBMLElement(
		[]byte{0x18, 0x53, 0x80, 0x67},
		append(info, tracks...),
	)
	header := testEBMLElement([]byte{0x1a, 0x45, 0xdf, 0xa3}, nil)
	return append(header, segment...)
}

func testEBMLElement(id, payload []byte) []byte {
	out := make([]byte, 0, len(id)+8+len(payload))
	out = append(out, id...)
	out = append(out, testEBMLSize(uint64(len(payload)))...)
	out = append(out, payload...)
	return out
}

func testEBMLSize(value uint64) []byte {
	for length := 1; length <= 8; length++ {
		bits := uint(length * 7)
		max := uint64(1)<<bits - 1
		if value >= max {
			continue
		}
		out := make([]byte, length)
		remaining := value
		for index := length - 1; index >= 0; index-- {
			out[index] = byte(remaining)
			remaining >>= 8
		}
		out[0] |= byte(1 << (8 - length))
		return out
	}
	panic("test EBML size too large")
}

func testEBMLUint(value uint64) []byte {
	length := 1
	for copy := value; copy > 0xff; copy >>= 8 {
		length++
	}
	out := make([]byte, length)
	for index := length - 1; index >= 0; index-- {
		out[index] = byte(value)
		value >>= 8
	}
	return out
}

func testEBMLFloat64(value float64) []byte {
	out := make([]byte, 8)
	binary.BigEndian.PutUint64(out, math.Float64bits(value))
	return out
}

func buildAVIFixture() []byte {
	avih := make([]byte, 56)
	binary.LittleEndian.PutUint32(avih[0:4], 33_333)
	binary.LittleEndian.PutUint32(avih[16:20], 150)
	binary.LittleEndian.PutUint32(avih[24:28], 2)
	binary.LittleEndian.PutUint32(avih[32:36], 1280)
	binary.LittleEndian.PutUint32(avih[36:40], 720)

	videoHeader := make([]byte, 56)
	copy(videoHeader[0:4], "vids")
	copy(videoHeader[4:8], "H264")
	binary.LittleEndian.PutUint32(videoHeader[20:24], 1)
	binary.LittleEndian.PutUint32(videoHeader[24:28], 30)
	binary.LittleEndian.PutUint32(videoHeader[32:36], 150)
	videoFormat := make([]byte, 40)
	binary.LittleEndian.PutUint32(videoFormat[0:4], 40)
	binary.LittleEndian.PutUint32(videoFormat[4:8], 1280)
	binary.LittleEndian.PutUint32(videoFormat[8:12], 720)
	binary.LittleEndian.PutUint16(videoFormat[12:14], 1)
	binary.LittleEndian.PutUint16(videoFormat[14:16], 24)
	copy(videoFormat[16:20], "H264")

	audioHeader := make([]byte, 56)
	copy(audioHeader[0:4], "auds")
	binary.LittleEndian.PutUint32(audioHeader[20:24], 1)
	binary.LittleEndian.PutUint32(audioHeader[24:28], 48_000)
	binary.LittleEndian.PutUint32(audioHeader[32:36], 240_000)
	audioFormat := make([]byte, 18)
	binary.LittleEndian.PutUint16(audioFormat[0:2], 0x00ff)
	binary.LittleEndian.PutUint16(audioFormat[2:4], 2)
	binary.LittleEndian.PutUint32(audioFormat[4:8], 48_000)

	videoList := testAVIList("strl",
		testAVIChunk("strh", videoHeader),
		testAVIChunk("strf", videoFormat),
	)
	audioList := testAVIList("strl",
		testAVIChunk("strh", audioHeader),
		testAVIChunk("strf", audioFormat),
	)
	hdrl := testAVIList("hdrl",
		testAVIChunk("avih", avih),
		videoList,
		audioList,
	)

	payload := append([]byte("AVI "), hdrl...)
	out := make([]byte, 8, 8+len(payload))
	copy(out[0:4], "RIFF")
	binary.LittleEndian.PutUint32(out[4:8], uint32(len(payload)))
	out = append(out, payload...)
	return out
}

func testAVIList(kind string, chunks ...[]byte) []byte {
	payload := []byte(kind)
	for _, chunk := range chunks {
		payload = append(payload, chunk...)
	}
	return testAVIChunk("LIST", payload)
}

func testAVIChunk(id string, payload []byte) []byte {
	out := make([]byte, 8, 8+len(payload)+1)
	copy(out[0:4], id)
	binary.LittleEndian.PutUint32(out[4:8], uint32(len(payload)))
	out = append(out, payload...)
	if len(payload)&1 != 0 {
		out = append(out, 0)
	}
	return out
}
