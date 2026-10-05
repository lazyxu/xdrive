package media

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
)

const (
	mpegPSPackStartCode      = byte(0xba)
	mpegPSProgramEndCode     = byte(0xb9)
	mpegPSPrivateStream1     = byte(0xbd)
	mpegPSProgramStreamMap   = byte(0xbc)
	maxPSMetadataScanBytes   = int64(8 << 20)
	maxPSElementaryBytes     = 2 << 20
	maxPSStartCodeCandidates = 1 << 20
)

type mpegPSInfo struct {
	DurationSeconds float64
	Width           int
	Height          int
	FrameRate       float64
	VideoCodec      string
	AudioCodec      string
	VideoStreamID   byte
	AudioStreamID   byte
}

type mpegPSWindow struct {
	firstPTS      map[byte]uint64
	lastPTS       map[byte]uint64
	videoStreamID byte
	audioStreamID byte
	videoPayload  []byte
	audioPayload  []byte
	privateAudio  string
	packFound     bool
}

func extractMPEGPSVideo(r io.ReadSeeker, size int64, out *Result) error {
	info, err := parseMPEGPS(r, size)
	if err != nil {
		return err
	}
	out.DurationMS = int64(info.DurationSeconds*1000 + 0.5)
	out.Width = info.Width
	out.Height = info.Height
	out.FrameRate = info.FrameRate
	out.VideoCodec = info.VideoCodec
	out.AudioCodec = info.AudioCodec
	if info.DurationSeconds > 0 && size > 0 {
		out.BitRate = int64(float64(size*8) / info.DurationSeconds)
	}
	if encoded, err := json.Marshal(map[string]any{
		"container":       "mpeg-ps",
		"duration_ms":     out.DurationMS,
		"frame_rate":      out.FrameRate,
		"bit_rate":        out.BitRate,
		"video_codec":     out.VideoCodec,
		"audio_codec":     out.AudioCodec,
		"video_stream_id": info.VideoStreamID,
		"audio_stream_id": info.AudioStreamID,
	}); err == nil {
		out.VideoJSON = string(encoded)
	}
	return nil
}

func parseMPEGPS(r io.ReadSeeker, size int64) (mpegPSInfo, error) {
	var out mpegPSInfo
	if r == nil {
		return out, errors.New("mpeg-ps reader is nil")
	}
	if size <= 0 {
		end, err := r.Seek(0, io.SeekEnd)
		if err != nil {
			return out, err
		}
		size = end
	}
	if size < 10 {
		return out, errors.New("short mpeg program stream")
	}

	headEnd := size
	if headEnd > maxPSMetadataScanBytes {
		headEnd = maxPSMetadataScanBytes
	}
	headData, err := readMPEGPSWindow(r, 0, headEnd)
	if err != nil {
		return out, err
	}
	head, err := scanMPEGPSWindow(headData, true)
	if err != nil {
		return out, err
	}
	if !head.packFound {
		return out, errors.New("mpeg program stream pack header not found")
	}
	if head.videoStreamID == 0 && head.audioStreamID == 0 {
		return out, errors.New("mpeg program stream media PES not found")
	}

	out.VideoStreamID = head.videoStreamID
	out.AudioStreamID = head.audioStreamID
	if head.videoStreamID != 0 {
		out.Width, out.Height, out.FrameRate = mpeg2VideoDimensionsAndFrameRate(head.videoPayload)
		out.VideoCodec = mpegPSVideoCodec(head.videoPayload)
	}
	if head.privateAudio != "" {
		out.AudioCodec = head.privateAudio
	} else if head.audioStreamID != 0 {
		out.AudioCodec = mpegPSAudioCodec(head.audioPayload)
	}

	timingStreamID := head.videoStreamID
	if timingStreamID == 0 {
		timingStreamID = head.audioStreamID
	}

	tail := head
	if size > headEnd {
		start := size - maxPSMetadataScanBytes
		tailData, readErr := readMPEGPSWindow(r, start, size)
		if readErr != nil {
			return out, readErr
		}
		tail, err = scanMPEGPSWindow(tailData, false)
		if err != nil {
			return out, err
		}
	}
	if timingStreamID != 0 {
		first, haveFirst := head.firstPTS[timingStreamID]
		last, haveLast := tail.lastPTS[timingStreamID]
		if !haveLast {
			last, haveLast = head.lastPTS[timingStreamID]
		}
		if haveFirst && haveLast {
			out.DurationSeconds = wrappedTimestampSeconds(
				first,
				last,
				uint64(1)<<33,
				90_000,
			)
		}
	}
	return out, nil
}

func readMPEGPSWindow(r io.ReadSeeker, start, end int64) ([]byte, error) {
	if start < 0 {
		start = 0
	}
	if end < start {
		return nil, errors.New("invalid mpeg program stream window")
	}
	if _, err := r.Seek(start, io.SeekStart); err != nil {
		return nil, err
	}
	size := end - start
	data := make([]byte, int(size))
	if _, err := io.ReadFull(r, data); err != nil {
		return nil, err
	}
	return data, nil
}

func scanMPEGPSWindow(data []byte, collectPayload bool) (mpegPSWindow, error) {
	out := mpegPSWindow{
		firstPTS: make(map[byte]uint64),
		lastPTS:  make(map[byte]uint64),
	}
	if len(data) < 4 {
		return out, nil
	}

	candidates := 0
	for offset := 0; offset+4 <= len(data); {
		index := bytes.Index(data[offset:], []byte{0x00, 0x00, 0x01})
		if index < 0 {
			break
		}
		index += offset
		candidates++
		if candidates > maxPSStartCodeCandidates {
			return out, errors.New("too many mpeg program stream start codes")
		}
		code := data[index+3]
		switch {
		case code == mpegPSPackStartCode:
			out.packFound = true
		case code >= 0xe0 && code <= 0xef:
			packet, next, ok := mpegPSPESPacket(data, index)
			if ok {
				payload, pts, headerOK := parseMPEGPESPayload(packet)
				if headerOK {
					if out.videoStreamID == 0 {
						out.videoStreamID = code
					}
					recordMPEGPSPTS(&out, code, pts)
					if collectPayload && code == out.videoStreamID {
						appendBoundedMPEGPSPayload(&out.videoPayload, payload)
					}
					offset = next
					continue
				}
			}
		case code >= 0xc0 && code <= 0xdf:
			packet, next, ok := mpegPSPESPacket(data, index)
			if ok {
				payload, pts, headerOK := parseMPEGPESPayload(packet)
				if headerOK {
					if out.audioStreamID == 0 {
						out.audioStreamID = code
					}
					recordMPEGPSPTS(&out, code, pts)
					if collectPayload && code == out.audioStreamID {
						appendBoundedMPEGPSPayload(&out.audioPayload, payload)
					}
					offset = next
					continue
				}
			}
		case code == mpegPSPrivateStream1:
			packet, next, ok := mpegPSPESPacket(data, index)
			if ok {
				payload, pts, headerOK := parseMPEGPESPayload(packet)
				if headerOK {
					recordMPEGPSPTS(&out, code, pts)
					if out.audioStreamID == 0 {
						out.audioStreamID = code
					}
					if out.privateAudio == "" {
						out.privateAudio = mpegPSPrivateAudioCodec(payload)
					}
					offset = next
					continue
				}
			}
		case code == mpegPSProgramEndCode:
			return out, nil
		case code == mpegPSProgramStreamMap:
			// Program Stream Map is optional. Common MPEG-1/2 PS files expose
			// media sufficiently through PES stream IDs and elementary headers;
			// unknown map extensions are left uninterpreted rather than guessed.
		}
		offset = index + 4
	}
	return out, nil
}

func mpegPSPESPacket(data []byte, start int) ([]byte, int, bool) {
	if start < 0 || start+6 > len(data) ||
		data[start] != 0x00 || data[start+1] != 0x00 || data[start+2] != 0x01 {
		return nil, start + 1, false
	}
	length := int(data[start+4])<<8 | int(data[start+5])
	if length > 0 {
		end := start + 6 + length
		if end > len(data) {
			return nil, start + 4, false
		}
		return data[start:end], end, true
	}

	// MPEG-2 permits zero-length video PES packets. Bound such a packet at the
	// next system-layer start code (>= 0xB9); lower start codes belong to the
	// elementary video bitstream and must remain inside the PES payload.
	end := len(data)
	for offset := start + 6; offset+4 <= len(data); {
		index := bytes.Index(data[offset:], []byte{0x00, 0x00, 0x01})
		if index < 0 {
			break
		}
		index += offset
		if data[index+3] >= 0xb9 {
			end = index
			break
		}
		offset = index + 4
	}
	if end <= start+6 {
		return nil, start + 4, false
	}
	return data[start:end], end, true
}

func parseMPEGPESPayload(packet []byte) ([]byte, *uint64, bool) {
	if len(packet) < 7 ||
		packet[0] != 0x00 || packet[1] != 0x00 || packet[2] != 0x01 {
		return nil, nil, false
	}
	streamID := packet[3]
	if !mpegPSMediaStreamID(streamID) {
		return nil, nil, false
	}

	// MPEG-2 PES optional header.
	if len(packet) >= 9 && packet[6]&0xc0 == 0x80 {
		headerEnd := 9 + int(packet[8])
		if headerEnd > len(packet) {
			return nil, nil, false
		}
		var pts *uint64
		flags := (packet[7] >> 6) & 0x03
		if (flags == 2 || flags == 3) && len(packet) >= 14 {
			if value, ok := decodePTS(packet[9:14]); ok {
				pts = &value
			}
		}
		return packet[headerEnd:], pts, true
	}

	// MPEG-1 PES optional header.
	position := 6
	for position < len(packet) && packet[position] == 0xff {
		position++
	}
	if position+2 <= len(packet) && packet[position]&0xc0 == 0x40 {
		position += 2
	}
	if position >= len(packet) {
		return nil, nil, false
	}

	var pts *uint64
	switch packet[position] & 0xf0 {
	case 0x20:
		if position+5 > len(packet) {
			return nil, nil, false
		}
		if value, ok := decodePTS(packet[position : position+5]); ok {
			pts = &value
		}
		position += 5
	case 0x30:
		if position+10 > len(packet) {
			return nil, nil, false
		}
		if value, ok := decodePTS(packet[position : position+5]); ok {
			pts = &value
		}
		position += 10
	case 0x00:
		if packet[position] != 0x0f {
			return nil, nil, false
		}
		position++
	default:
		return nil, nil, false
	}
	if position > len(packet) {
		return nil, nil, false
	}
	return packet[position:], pts, true
}

func mpegPSMediaStreamID(streamID byte) bool {
	return streamID == mpegPSPrivateStream1 ||
		(streamID >= 0xc0 && streamID <= 0xdf) ||
		(streamID >= 0xe0 && streamID <= 0xef)
}

func recordMPEGPSPTS(out *mpegPSWindow, streamID byte, pts *uint64) {
	if out == nil || pts == nil {
		return
	}
	if _, exists := out.firstPTS[streamID]; !exists {
		out.firstPTS[streamID] = *pts
	}
	out.lastPTS[streamID] = *pts
}

func appendBoundedMPEGPSPayload(dst *[]byte, payload []byte) {
	if dst == nil || len(payload) == 0 || len(*dst) >= maxPSElementaryBytes {
		return
	}
	remaining := maxPSElementaryBytes - len(*dst)
	if len(payload) > remaining {
		payload = payload[:remaining]
	}
	*dst = append(*dst, payload...)
}

func mpegPSVideoCodec(data []byte) string {
	if len(data) == 0 || !containsMPEGStartCode(data, 0xb3) {
		return ""
	}
	for offset := 0; offset+5 <= len(data); {
		index := bytes.Index(data[offset:], []byte{0x00, 0x00, 0x01, 0xb5})
		if index < 0 {
			break
		}
		index += offset
		if index+5 <= len(data) && data[index+4]>>4 == 0x01 {
			return "mpeg2-video"
		}
		offset = index + 4
	}
	return "mpeg1-video"
}

func mpegPSAudioCodec(data []byte) string {
	for index := 0; index+4 <= len(data); index++ {
		if data[index] != 0xff || data[index+1]&0xe0 != 0xe0 {
			continue
		}
		versionID := (data[index+1] >> 3) & 0x03
		layerBits := (data[index+1] >> 1) & 0x03
		if versionID == 0x01 || layerBits == 0x00 {
			continue
		}
		switch layerBits {
		case 0x03:
			return "mp1"
		case 0x02:
			return "mp2"
		case 0x01:
			return "mp3"
		}
	}
	return "mpeg-audio"
}

func mpegPSPrivateAudioCodec(payload []byte) string {
	if len(payload) == 0 {
		return ""
	}
	substreamID := payload[0]
	switch {
	case substreamID >= 0x80 && substreamID <= 0x87:
		return "ac3"
	case substreamID >= 0x88 && substreamID <= 0x8f:
		return "dts"
	case substreamID >= 0xa0 && substreamID <= 0xa7:
		return "lpcm"
	default:
		return ""
	}
}

func containsMPEGStartCode(data []byte, code byte) bool {
	return bytes.Contains(data, []byte{0x00, 0x00, 0x01, code})
}
