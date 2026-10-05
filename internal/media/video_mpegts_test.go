package media

import (
	"bytes"
	"encoding/binary"
	"math"
	"testing"
)

func TestExtractMPEGTSAndM2TSMetadata(t *testing.T) {
	base := buildMPEGTSFixture()
	for _, test := range []struct {
		name       string
		data       []byte
		packetSize int64
		syncOffset int64
	}{
		{name: "camera.mts", data: base, packetSize: 188, syncOffset: 0},
		{name: "camera.m2ts", data: wrapM2TSPackets(base), packetSize: 192, syncOffset: 4},
	} {
		t.Run(test.name, func(t *testing.T) {
			result, err := Extract(test.name, bytes.NewReader(test.data), int64(len(test.data)))
			if err != nil {
				t.Fatal(err)
			}
			if result.Kind != KindVideo || result.MIMEType != "video/mp2t" {
				t.Fatalf("classification=%+v", result)
			}
			if result.Width != 1280 || result.Height != 720 {
				t.Fatalf("dimensions=%dx%d", result.Width, result.Height)
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
			info, err := parseMPEGTS(bytes.NewReader(test.data), int64(len(test.data)))
			if err != nil {
				t.Fatal(err)
			}
			if info.PacketSize != test.packetSize || info.SyncOffset != test.syncOffset {
				t.Fatalf("geometry=%+v", info)
			}
			if info.PCRPID != 0x101 || len(info.Tracks) != 2 {
				t.Fatalf("program info=%+v", info)
			}
		})
	}
}

func TestExtractMPEGTSRecognizesHEVCWithoutGuessingDimensions(t *testing.T) {
	data := buildMPEGTSFixtureWithStreamType(0x24, nil)
	result, err := Extract("camera.mts", bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	if result.VideoCodec != "hevc" {
		t.Fatalf("video codec=%q", result.VideoCodec)
	}
	if result.Width != 0 || result.Height != 0 {
		t.Fatalf("missing HEVC SPS produced dimensions=%dx%d", result.Width, result.Height)
	}
}

func TestExtractMPEGTSFailsClosedOnInvalidPacketGeometry(t *testing.T) {
	data := []byte("not a transport stream")
	for _, name := range []string{"broken.mts", "broken.m2ts"} {
		t.Run(name, func(t *testing.T) {
			result, err := Extract(name, bytes.NewReader(data), int64(len(data)))
			if err != nil {
				t.Fatal(err)
			}
			if result.Kind != KindVideo {
				t.Fatalf("kind=%q", result.Kind)
			}
			if result.DurationMS != 0 || result.VideoCodec != "" ||
				result.Width != 0 || result.VideoJSON != "" {
				t.Fatalf("invalid transport stream produced metadata=%+v", result)
			}
		})
	}
}

func TestWrappedTimestampSecondsHandles33BitWrap(t *testing.T) {
	modulus := uint64(1) << 33
	start := modulus - 90_000
	end := uint64(90_000)
	if got := wrappedTimestampSeconds(start, end, modulus, 90_000); math.Abs(got-2) > 1e-9 {
		t.Fatalf("wrapped duration=%f want=2", got)
	}
}

func buildMPEGTSFixture() []byte {
	return buildMPEGTSFixtureWithStreamType(0x1b, buildTestH264SPS(1280, 720, 30))
}

func buildMPEGTSFixtureWithStreamType(videoType byte, sps []byte) []byte {
	const (
		pmtPID   = uint16(0x100)
		videoPID = uint16(0x101)
		audioPID = uint16(0x102)
	)
	packets := [][]byte{
		buildTSPacket(0, true, append([]byte{0}, buildPATSection(pmtPID)...), 0),
		buildTSPacket(pmtPID, true, append([]byte{0}, buildPMTSection(videoPID, audioPID, videoType)...), 0),
		buildTSPacket(videoPID, true, buildVideoPES(90_000, sps), 0),
		buildTSPacket(audioPID, true, buildAudioPES(90_000), 0),
		buildTSPacket(videoPID, true, buildVideoPES(540_000, nil), 1),
	}
	return bytes.Join(packets, nil)
}

func buildPATSection(pmtPID uint16) []byte {
	section := make([]byte, 16)
	section[0] = 0x00
	section[1] = 0xb0
	section[2] = 13
	binary.BigEndian.PutUint16(section[3:5], 1)
	section[5] = 0xc1
	section[6] = 0
	section[7] = 0
	binary.BigEndian.PutUint16(section[8:10], 1)
	section[10] = 0xe0 | byte(pmtPID>>8)
	section[11] = byte(pmtPID)
	return section
}

func buildPMTSection(videoPID, audioPID uint16, videoType byte) []byte {
	section := make([]byte, 26)
	section[0] = 0x02
	section[1] = 0xb0
	section[2] = 23
	binary.BigEndian.PutUint16(section[3:5], 1)
	section[5] = 0xc1
	section[6] = 0
	section[7] = 0
	section[8] = 0xe0 | byte(videoPID>>8)
	section[9] = byte(videoPID)
	section[10] = 0xf0
	section[11] = 0

	section[12] = videoType
	section[13] = 0xe0 | byte(videoPID>>8)
	section[14] = byte(videoPID)
	section[15] = 0xf0
	section[16] = 0

	section[17] = 0x0f
	section[18] = 0xe0 | byte(audioPID>>8)
	section[19] = byte(audioPID)
	section[20] = 0xf0
	section[21] = 0
	return section
}

func buildTSPacket(pid uint16, pusi bool, payload []byte, continuity byte) []byte {
	if len(payload) > 184 {
		panic("test TS payload exceeds one packet")
	}
	packet := bytes.Repeat([]byte{0xff}, 188)
	packet[0] = 0x47
	packet[1] = byte(pid >> 8)
	if pusi {
		packet[1] |= 0x40
	}
	packet[2] = byte(pid)
	packet[3] = 0x10 | continuity&0x0f
	copy(packet[4:], payload)
	return packet
}

func wrapM2TSPackets(ts []byte) []byte {
	if len(ts)%188 != 0 {
		panic("invalid test TS packet alignment")
	}
	out := make([]byte, 0, len(ts)/188*192)
	for offset := 0; offset < len(ts); offset += 188 {
		out = append(out, 0, 0, 0, 0)
		out = append(out, ts[offset:offset+188]...)
	}
	return out
}

func buildVideoPES(pts uint64, sps []byte) []byte {
	elementary := make([]byte, 0, len(sps)+16)
	if len(sps) != 0 {
		elementary = append(elementary, 0, 0, 0, 1, 0x67)
		elementary = append(elementary, sps...)
	}
	elementary = append(elementary, 0, 0, 0, 1, 0x65, 0x88, 0x84)
	return buildPES(0xe0, pts, elementary)
}

func buildAudioPES(pts uint64) []byte {
	return buildPES(0xc0, pts, []byte{0xff, 0xf1, 0x50, 0x80})
}

func buildPES(streamID byte, pts uint64, payload []byte) []byte {
	header := []byte{0, 0, 1, streamID, 0, 0, 0x80, 0x80, 5}
	header = append(header, encodeTestPTS(pts)...)
	return append(header, payload...)
}

func encodeTestPTS(value uint64) []byte {
	value &= (uint64(1) << 33) - 1
	return []byte{
		byte(0x20 | ((value>>30)&0x07)<<1 | 1),
		byte(value >> 22),
		byte(((value>>15)&0x7f)<<1 | 1),
		byte(value >> 7),
		byte((value&0x7f)<<1 | 1),
	}
}

type testBitWriter struct {
	data []byte
	bit  int
}

func (w *testBitWriter) bitValue(value uint64) {
	byteIndex := w.bit / 8
	if byteIndex >= len(w.data) {
		w.data = append(w.data, 0)
	}
	if value&1 != 0 {
		w.data[byteIndex] |= 1 << (7 - (w.bit % 8))
	}
	w.bit++
}

func (w *testBitWriter) bitsValue(value uint64, count int) {
	for shift := count - 1; shift >= 0; shift-- {
		w.bitValue((value >> shift) & 1)
	}
}

func (w *testBitWriter) ueValue(value uint64) {
	codeNum := value + 1
	bits := 0
	for copy := codeNum; copy != 0; copy >>= 1 {
		bits++
	}
	for i := 0; i < bits-1; i++ {
		w.bitValue(0)
	}
	w.bitsValue(codeNum, bits)
}

func (w *testBitWriter) finishRBSP() []byte {
	w.bitValue(1)
	for w.bit%8 != 0 {
		w.bitValue(0)
	}
	return append([]byte(nil), w.data...)
}

func buildTestH264SPS(width, height int, fps int) []byte {
	if width%16 != 0 || height%16 != 0 || fps <= 0 {
		panic("test SPS dimensions/fps must be macroblock aligned and positive")
	}
	var w testBitWriter
	w.bitsValue(66, 8)
	w.bitsValue(0, 8)
	w.bitsValue(40, 8)
	w.ueValue(0)
	w.ueValue(0)
	w.ueValue(0)
	w.ueValue(0)
	w.ueValue(1)
	w.bitValue(0)
	w.ueValue(uint64(width/16 - 1))
	w.ueValue(uint64(height/16 - 1))
	w.bitValue(1)
	w.bitValue(1)
	w.bitValue(0)
	w.bitValue(1)

	w.bitValue(0)
	w.bitValue(0)
	w.bitValue(0)
	w.bitValue(0)
	w.bitValue(1)
	w.bitsValue(1000, 32)
	w.bitsValue(uint64(fps*2000), 32)
	w.bitValue(1)
	return w.finishRBSP()
}
