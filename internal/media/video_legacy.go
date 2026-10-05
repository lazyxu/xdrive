package media

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"strings"
)

const (
	ebmlHeaderID        = uint64(0x1A45DFA3)
	matroskaSegmentID   = uint64(0x18538067)
	matroskaInfoID      = uint64(0x1549A966)
	matroskaTracksID    = uint64(0x1654AE6B)
	matroskaTrackID     = uint64(0xAE)
	matroskaTrackType   = uint64(0x83)
	matroskaCodecID     = uint64(0x86)
	matroskaDefaultDur  = uint64(0x23E383)
	matroskaVideoID     = uint64(0xE0)
	matroskaPixelWidth  = uint64(0xB0)
	matroskaPixelHeight = uint64(0xBA)
	matroskaTimeScale   = uint64(0x2AD7B1)
	matroskaDuration    = uint64(0x4489)

	maxMatroskaTopLevelElements = 4096
	maxMatroskaMasterElements   = 4096
	maxMatroskaStringBytes      = 1024
	maxAVIHeaderBytes           = 1 << 20
)

type ebmlElement struct {
	ID        uint64
	DataStart int64
	Size      int64
	End       int64
	Unknown   bool
}

type matroskaTrackInfo struct {
	Kind              string  `json:"type"`
	Codec             string  `json:"codec,omitempty"`
	CodecID           string  `json:"codec_id,omitempty"`
	Width             int     `json:"width,omitempty"`
	Height            int     `json:"height,omitempty"`
	FrameRate         float64 `json:"frame_rate,omitempty"`
	DefaultDurationNS uint64  `json:"default_duration_ns,omitempty"`
}

type matroskaInfo struct {
	DurationSeconds float64
	TimestampScale  uint64
	Tracks          []matroskaTrackInfo
}

func extractMatroskaVideo(r io.ReadSeeker, size int64, out *Result) error {
	info, err := parseMatroska(r)
	if err != nil {
		return err
	}
	out.DurationMS = int64(info.DurationSeconds*1000 + 0.5)
	if info.DurationSeconds > 0 && size > 0 {
		out.BitRate = int64(float64(size*8) / info.DurationSeconds)
	}
	for _, track := range info.Tracks {
		switch track.Kind {
		case "video":
			if out.Width == 0 {
				out.Width = track.Width
				out.Height = track.Height
				out.FrameRate = track.FrameRate
				out.VideoCodec = track.Codec
			}
		case "audio":
			if out.AudioCodec == "" {
				out.AudioCodec = track.Codec
			}
		}
	}
	container := "matroska"
	if strings.EqualFold(strings.TrimSpace(out.MIMEType), "video/webm") {
		container = "webm"
	}
	if encoded, err := json.Marshal(map[string]any{
		"container":       container,
		"duration_ms":     out.DurationMS,
		"frame_rate":      out.FrameRate,
		"bit_rate":        out.BitRate,
		"video_codec":     out.VideoCodec,
		"audio_codec":     out.AudioCodec,
		"timestamp_scale": info.TimestampScale,
		"tracks":          info.Tracks,
	}); err == nil {
		out.VideoJSON = string(encoded)
	}
	return nil
}

func parseMatroska(r io.ReadSeeker) (matroskaInfo, error) {
	var out matroskaInfo
	if r == nil {
		return out, errors.New("matroska reader is nil")
	}
	end, err := r.Seek(0, io.SeekEnd)
	if err != nil {
		return out, err
	}
	if end < 8 {
		return out, errors.New("short matroska file")
	}
	first, err := readEBMLElement(r, 0, end)
	if err != nil || first.ID != ebmlHeaderID || first.Unknown {
		return out, errors.New("matroska EBML header not found")
	}

	position := first.End
	var segment ebmlElement
	foundSegment := false
	for i := 0; i < 32 && position < end; i++ {
		element, readErr := readEBMLElement(r, position, end)
		if readErr != nil {
			return out, readErr
		}
		if element.ID == matroskaSegmentID {
			segment = element
			foundSegment = true
			break
		}
		if element.Unknown {
			return out, errors.New("unknown-sized element before matroska segment")
		}
		position = element.End
	}
	if !foundSegment {
		return out, errors.New("matroska segment not found")
	}
	segmentEnd := segment.End
	if segment.Unknown {
		segmentEnd = end
	}
	if segmentEnd <= segment.DataStart || segmentEnd > end {
		return out, errors.New("invalid matroska segment bounds")
	}

	out.TimestampScale = 1_000_000
	var durationTicks float64
	position = segment.DataStart
	infoSeen := false
	tracksSeen := false
	for count := 0; count < maxMatroskaTopLevelElements && position < segmentEnd; count++ {
		element, readErr := readEBMLElement(r, position, segmentEnd)
		if readErr != nil {
			return out, readErr
		}
		switch element.ID {
		case matroskaInfoID:
			if element.Unknown {
				return out, errors.New("unknown-sized matroska info")
			}
			scale, duration, parseErr := parseMatroskaSegmentInfo(r, element)
			if parseErr != nil {
				return out, parseErr
			}
			if scale != 0 {
				out.TimestampScale = scale
			}
			if duration > 0 {
				durationTicks = duration
			}
			infoSeen = true
		case matroskaTracksID:
			if element.Unknown {
				return out, errors.New("unknown-sized matroska tracks")
			}
			tracks, parseErr := parseMatroskaTracks(r, element)
			if parseErr != nil {
				return out, parseErr
			}
			out.Tracks = tracks
			tracksSeen = true
		}
		if infoSeen && tracksSeen {
			break
		}
		if element.Unknown {
			break
		}
		position = element.End
	}
	if !tracksSeen || len(out.Tracks) == 0 {
		return out, errors.New("matroska tracks not found")
	}
	if durationTicks > 0 && out.TimestampScale > 0 {
		out.DurationSeconds = durationTicks * float64(out.TimestampScale) / 1_000_000_000
	}
	return out, nil
}

func parseMatroskaSegmentInfo(r io.ReadSeeker, master ebmlElement) (uint64, float64, error) {
	scale := uint64(1_000_000)
	duration := float64(0)
	position := master.DataStart
	for count := 0; count < maxMatroskaMasterElements && position < master.End; count++ {
		element, err := readEBMLElement(r, position, master.End)
		if err != nil {
			return 0, 0, err
		}
		switch element.ID {
		case matroskaTimeScale:
			value, readErr := readEBMLUnsigned(r, element)
			if readErr == nil && value != 0 {
				scale = value
			}
		case matroskaDuration:
			value, readErr := readEBMLFloat(r, element)
			if readErr == nil && value > 0 && !math.IsInf(value, 0) && !math.IsNaN(value) {
				duration = value
			}
		}
		if element.Unknown {
			return 0, 0, errors.New("unknown-sized element inside matroska info")
		}
		position = element.End
	}
	return scale, duration, nil
}

func parseMatroskaTracks(r io.ReadSeeker, master ebmlElement) ([]matroskaTrackInfo, error) {
	tracks := make([]matroskaTrackInfo, 0, 4)
	position := master.DataStart
	for count := 0; count < maxMatroskaMasterElements && position < master.End; count++ {
		element, err := readEBMLElement(r, position, master.End)
		if err != nil {
			return nil, err
		}
		if element.ID == matroskaTrackID {
			if element.Unknown {
				return nil, errors.New("unknown-sized matroska track entry")
			}
			track, parseErr := parseMatroskaTrack(r, element)
			if parseErr != nil {
				return nil, parseErr
			}
			if track.Kind != "" {
				tracks = append(tracks, track)
			}
		}
		if element.Unknown {
			return nil, errors.New("unknown-sized element inside matroska tracks")
		}
		position = element.End
	}
	return tracks, nil
}

func parseMatroskaTrack(r io.ReadSeeker, master ebmlElement) (matroskaTrackInfo, error) {
	var out matroskaTrackInfo
	var trackType uint64
	position := master.DataStart
	for count := 0; count < maxMatroskaMasterElements && position < master.End; count++ {
		element, err := readEBMLElement(r, position, master.End)
		if err != nil {
			return out, err
		}
		switch element.ID {
		case matroskaTrackType:
			trackType, _ = readEBMLUnsigned(r, element)
		case matroskaCodecID:
			out.CodecID, _ = readEBMLString(r, element)
		case matroskaDefaultDur:
			out.DefaultDurationNS, _ = readEBMLUnsigned(r, element)
		case matroskaVideoID:
			if !element.Unknown {
				out.Width, out.Height = parseMatroskaVideoDimensions(r, element)
			}
		}
		if element.Unknown {
			return out, errors.New("unknown-sized element inside matroska track")
		}
		position = element.End
	}
	switch trackType {
	case 1:
		out.Kind = "video"
	case 2:
		out.Kind = "audio"
	default:
		return matroskaTrackInfo{}, nil
	}
	out.CodecID = strings.TrimSpace(out.CodecID)
	out.Codec = normalizeMatroskaCodec(out.CodecID)
	if out.Kind == "video" && out.DefaultDurationNS > 0 {
		out.FrameRate = 1_000_000_000 / float64(out.DefaultDurationNS)
	}
	return out, nil
}

func parseMatroskaVideoDimensions(r io.ReadSeeker, master ebmlElement) (int, int) {
	var width, height int
	position := master.DataStart
	for count := 0; count < maxMatroskaMasterElements && position < master.End; count++ {
		element, err := readEBMLElement(r, position, master.End)
		if err != nil {
			return width, height
		}
		switch element.ID {
		case matroskaPixelWidth:
			if value, readErr := readEBMLUnsigned(r, element); readErr == nil && value <= uint64(^uint(0)>>1) {
				width = int(value)
			}
		case matroskaPixelHeight:
			if value, readErr := readEBMLUnsigned(r, element); readErr == nil && value <= uint64(^uint(0)>>1) {
				height = int(value)
			}
		}
		if element.Unknown {
			return width, height
		}
		position = element.End
	}
	return width, height
}

func normalizeMatroskaCodec(codecID string) string {
	switch strings.ToUpper(strings.TrimSpace(codecID)) {
	case "V_MPEG4/ISO/AVC":
		return "h264"
	case "V_MPEGH/ISO/HEVC":
		return "hevc"
	case "V_VP8":
		return "vp8"
	case "V_VP9":
		return "vp9"
	case "V_AV1":
		return "av1"
	case "A_AAC":
		return "aac"
	case "A_OPUS":
		return "opus"
	case "A_VORBIS":
		return "vorbis"
	case "A_FLAC":
		return "flac"
	case "A_AC3":
		return "ac3"
	case "A_EAC3":
		return "eac3"
	default:
		return strings.TrimSpace(codecID)
	}
}

func readEBMLElement(r io.ReadSeeker, position, end int64) (ebmlElement, error) {
	var out ebmlElement
	id, idLen, _, err := readEBMLVINT(r, position, end, true)
	if err != nil {
		return out, err
	}
	size, sizeLen, unknown, err := readEBMLVINT(r, position+int64(idLen), end, false)
	if err != nil {
		return out, err
	}
	dataStart := position + int64(idLen+sizeLen)
	if dataStart > end {
		return out, errors.New("EBML element header exceeds container")
	}
	out = ebmlElement{ID: id, DataStart: dataStart, Unknown: unknown}
	if unknown {
		out.End = end
		return out, nil
	}
	if size > uint64(end-dataStart) || size > uint64(^uint64(0)>>1) {
		return ebmlElement{}, errors.New("EBML element exceeds container")
	}
	out.Size = int64(size)
	out.End = dataStart + out.Size
	return out, nil
}

func readEBMLVINT(
	r io.ReadSeeker,
	position, end int64,
	isID bool,
) (uint64, int, bool, error) {
	if position < 0 || position >= end {
		return 0, 0, false, io.EOF
	}
	if _, err := r.Seek(position, io.SeekStart); err != nil {
		return 0, 0, false, err
	}
	var first [1]byte
	if _, err := io.ReadFull(r, first[:]); err != nil {
		return 0, 0, false, err
	}
	mask := byte(0x80)
	length := 1
	for length <= 8 && first[0]&mask == 0 {
		mask >>= 1
		length++
	}
	maxLength := 8
	if isID {
		maxLength = 4
	}
	if mask == 0 || length > maxLength || position+int64(length) > end {
		return 0, 0, false, errors.New("invalid EBML variable integer")
	}
	buf := make([]byte, length)
	buf[0] = first[0]
	if length > 1 {
		if _, err := io.ReadFull(r, buf[1:]); err != nil {
			return 0, 0, false, err
		}
	}
	value := uint64(0)
	unknown := false
	if isID {
		for _, b := range buf {
			value = value<<8 | uint64(b)
		}
		return value, length, false, nil
	}

	firstValue := first[0] & (mask - 1)
	value = uint64(firstValue)
	unknown = firstValue == mask-1
	for _, b := range buf[1:] {
		value = value<<8 | uint64(b)
		unknown = unknown && b == 0xff
	}
	return value, length, unknown, nil
}

func readEBMLUnsigned(r io.ReadSeeker, element ebmlElement) (uint64, error) {
	if element.Unknown || element.Size <= 0 || element.Size > 8 {
		return 0, errors.New("invalid EBML unsigned integer")
	}
	if _, err := r.Seek(element.DataStart, io.SeekStart); err != nil {
		return 0, err
	}
	data := make([]byte, int(element.Size))
	if _, err := io.ReadFull(r, data); err != nil {
		return 0, err
	}
	var value uint64
	for _, b := range data {
		value = value<<8 | uint64(b)
	}
	return value, nil
}

func readEBMLFloat(r io.ReadSeeker, element ebmlElement) (float64, error) {
	if element.Unknown {
		return 0, errors.New("unknown-sized EBML float")
	}
	if _, err := r.Seek(element.DataStart, io.SeekStart); err != nil {
		return 0, err
	}
	switch element.Size {
	case 4:
		var data [4]byte
		if _, err := io.ReadFull(r, data[:]); err != nil {
			return 0, err
		}
		return float64(math.Float32frombits(binary.BigEndian.Uint32(data[:]))), nil
	case 8:
		var data [8]byte
		if _, err := io.ReadFull(r, data[:]); err != nil {
			return 0, err
		}
		return math.Float64frombits(binary.BigEndian.Uint64(data[:])), nil
	default:
		return 0, errors.New("unsupported EBML float size")
	}
}

func readEBMLString(r io.ReadSeeker, element ebmlElement) (string, error) {
	if element.Unknown || element.Size < 0 || element.Size > maxMatroskaStringBytes {
		return "", errors.New("invalid EBML string size")
	}
	if _, err := r.Seek(element.DataStart, io.SeekStart); err != nil {
		return "", err
	}
	data := make([]byte, int(element.Size))
	if _, err := io.ReadFull(r, data); err != nil {
		return "", err
	}
	return strings.TrimRight(string(data), "\x00"), nil
}

type aviTrackInfo struct {
	Kind      string  `json:"type"`
	Codec     string  `json:"codec,omitempty"`
	Handler   string  `json:"handler,omitempty"`
	Width     int     `json:"width,omitempty"`
	Height    int     `json:"height,omitempty"`
	FrameRate float64 `json:"frame_rate,omitempty"`
	Duration  float64 `json:"duration_seconds,omitempty"`
	FormatTag uint16  `json:"audio_format_tag,omitempty"`
}

type aviInfo struct {
	DurationSeconds float64
	FrameRate       float64
	Width           int
	Height          int
	Tracks          []aviTrackInfo
}

type riffChunk struct {
	ID        string
	DataStart int64
	Size      int64
	End       int64
	Next      int64
}

func extractAVIVideo(r io.ReadSeeker, size int64, out *Result) error {
	info, err := parseAVI(r)
	if err != nil {
		return err
	}
	out.DurationMS = int64(info.DurationSeconds*1000 + 0.5)
	out.Width = info.Width
	out.Height = info.Height
	out.FrameRate = info.FrameRate
	if info.DurationSeconds > 0 && size > 0 {
		out.BitRate = int64(float64(size*8) / info.DurationSeconds)
	}
	for _, track := range info.Tracks {
		switch track.Kind {
		case "video":
			if out.VideoCodec == "" {
				out.VideoCodec = track.Codec
			}
			if out.Width == 0 {
				out.Width = track.Width
				out.Height = track.Height
			}
			if out.FrameRate == 0 {
				out.FrameRate = track.FrameRate
			}
		case "audio":
			if out.AudioCodec == "" {
				out.AudioCodec = track.Codec
			}
		}
	}
	if encoded, err := json.Marshal(map[string]any{
		"container":   "avi",
		"duration_ms": out.DurationMS,
		"frame_rate":  out.FrameRate,
		"bit_rate":    out.BitRate,
		"video_codec": out.VideoCodec,
		"audio_codec": out.AudioCodec,
		"tracks":      info.Tracks,
	}); err == nil {
		out.VideoJSON = string(encoded)
	}
	return nil
}

func parseAVI(r io.ReadSeeker) (aviInfo, error) {
	var out aviInfo
	if r == nil {
		return out, errors.New("avi reader is nil")
	}
	end, err := r.Seek(0, io.SeekEnd)
	if err != nil {
		return out, err
	}
	if end < 12 {
		return out, errors.New("short AVI file")
	}
	if _, err := r.Seek(0, io.SeekStart); err != nil {
		return out, err
	}
	var header [12]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return out, err
	}
	if string(header[:4]) != "RIFF" || string(header[8:12]) != "AVI " {
		return out, errors.New("AVI RIFF header not found")
	}
	riffSize := int64(binary.LittleEndian.Uint32(header[4:8]))
	riffEnd := int64(8) + riffSize
	if riffEnd > end {
		riffEnd = end
	}
	if riffEnd < 12 {
		return out, errors.New("invalid AVI RIFF size")
	}

	position := int64(12)
	foundHeaders := false
	for count := 0; count < 4096 && position+8 <= riffEnd; count++ {
		chunk, readErr := readRIFFChunk(r, position, riffEnd)
		if readErr != nil {
			return out, readErr
		}
		if chunk.ID == "LIST" && chunk.Size >= 4 {
			listType, typeErr := readFourCC(r, chunk.DataStart)
			if typeErr != nil {
				return out, typeErr
			}
			if listType == "hdrl" {
				if err := parseAVIHeaderList(r, chunk.DataStart+4, chunk.End, &out); err != nil {
					return out, err
				}
				foundHeaders = true
				break
			}
		}
		position = chunk.Next
	}
	if !foundHeaders {
		return out, errors.New("AVI hdrl list not found")
	}
	if out.DurationSeconds <= 0 {
		for _, track := range out.Tracks {
			if track.Kind == "video" && track.Duration > out.DurationSeconds {
				out.DurationSeconds = track.Duration
			}
		}
	}
	if out.Width == 0 || out.Height == 0 || out.FrameRate == 0 {
		for _, track := range out.Tracks {
			if track.Kind != "video" {
				continue
			}
			if out.Width == 0 {
				out.Width = track.Width
				out.Height = track.Height
			}
			if out.FrameRate == 0 {
				out.FrameRate = track.FrameRate
			}
			break
		}
	}
	if len(out.Tracks) == 0 {
		return out, errors.New("AVI streams not found")
	}
	return out, nil
}

func parseAVIHeaderList(r io.ReadSeeker, start, end int64, out *aviInfo) error {
	position := start
	for count := 0; count < 4096 && position+8 <= end; count++ {
		chunk, err := readRIFFChunk(r, position, end)
		if err != nil {
			return err
		}
		switch chunk.ID {
		case "avih":
			if err := parseAVIMainHeader(r, chunk, out); err != nil {
				return err
			}
		case "LIST":
			if chunk.Size >= 4 {
				listType, typeErr := readFourCC(r, chunk.DataStart)
				if typeErr != nil {
					return typeErr
				}
				if listType == "strl" {
					track, trackErr := parseAVIStreamList(r, chunk.DataStart+4, chunk.End)
					if trackErr != nil {
						return trackErr
					}
					if track.Kind != "" {
						out.Tracks = append(out.Tracks, track)
					}
				}
			}
		}
		position = chunk.Next
	}
	return nil
}

func parseAVIMainHeader(r io.ReadSeeker, chunk riffChunk, out *aviInfo) error {
	data, err := readRIFFPayload(r, chunk, 56)
	if err != nil {
		return err
	}
	if len(data) < 40 {
		return errors.New("short AVI main header")
	}
	microseconds := binary.LittleEndian.Uint32(data[0:4])
	totalFrames := binary.LittleEndian.Uint32(data[16:20])
	out.Width = int(binary.LittleEndian.Uint32(data[32:36]))
	out.Height = int(binary.LittleEndian.Uint32(data[36:40]))
	if microseconds > 0 {
		out.FrameRate = 1_000_000 / float64(microseconds)
		if totalFrames > 0 {
			out.DurationSeconds = float64(microseconds) * float64(totalFrames) / 1_000_000
		}
	}
	return nil
}

func parseAVIStreamList(r io.ReadSeeker, start, end int64) (aviTrackInfo, error) {
	var out aviTrackInfo
	var formatChunk *riffChunk
	position := start
	for count := 0; count < 4096 && position+8 <= end; count++ {
		chunk, err := readRIFFChunk(r, position, end)
		if err != nil {
			return out, err
		}
		switch chunk.ID {
		case "strh":
			if err := parseAVIStreamHeader(r, chunk, &out); err != nil {
				return out, err
			}
		case "strf":
			copy := chunk
			formatChunk = &copy
		}
		position = chunk.Next
	}
	if formatChunk != nil {
		if err := parseAVIStreamFormat(r, *formatChunk, &out); err != nil {
			return out, err
		}
	}
	return out, nil
}

func parseAVIStreamHeader(r io.ReadSeeker, chunk riffChunk, out *aviTrackInfo) error {
	data, err := readRIFFPayload(r, chunk, 64)
	if err != nil {
		return err
	}
	if len(data) < 48 {
		return errors.New("short AVI stream header")
	}
	streamType := string(data[0:4])
	out.Handler = cleanFourCC(data[4:8])
	switch streamType {
	case "vids", "iavs":
		out.Kind = "video"
	case "auds":
		out.Kind = "audio"
	default:
		return nil
	}
	scale := binary.LittleEndian.Uint32(data[20:24])
	rate := binary.LittleEndian.Uint32(data[24:28])
	length := binary.LittleEndian.Uint32(data[32:36])
	if rate > 0 && scale > 0 {
		if out.Kind == "video" {
			out.FrameRate = float64(rate) / float64(scale)
		}
		out.Duration = float64(length) * float64(scale) / float64(rate)
	}
	if out.Kind == "video" {
		out.Codec = normalizeAVIVideoCodec(out.Handler)
	}
	return nil
}

func parseAVIStreamFormat(r io.ReadSeeker, chunk riffChunk, out *aviTrackInfo) error {
	data, err := readRIFFPayload(r, chunk, maxAVIHeaderBytes)
	if err != nil {
		return err
	}
	switch out.Kind {
	case "video":
		if len(data) < 20 {
			return nil
		}
		width := int64(int32(binary.LittleEndian.Uint32(data[4:8])))
		height := int64(int32(binary.LittleEndian.Uint32(data[8:12])))
		if width < 0 {
			width = -width
		}
		if height < 0 {
			height = -height
		}
		if width > 0 && width <= int64(^uint(0)>>1) {
			out.Width = int(width)
		}
		if height > 0 && height <= int64(^uint(0)>>1) {
			out.Height = int(height)
		}
		if out.Codec == "" {
			out.Codec = normalizeAVIVideoCodec(cleanFourCC(data[16:20]))
		}
	case "audio":
		if len(data) < 2 {
			return nil
		}
		out.FormatTag = binary.LittleEndian.Uint16(data[:2])
		out.Codec = normalizeAVIAudioCodec(out.FormatTag)
	}
	return nil
}

func normalizeAVIVideoCodec(value string) string {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "H264", "X264", "AVC1":
		return "h264"
	case "H265", "HEVC", "X265":
		return "hevc"
	case "DIVX", "XVID", "FMP4":
		return "mpeg4"
	case "MJPG", "JPEG":
		return "mjpeg"
	case "DVSD", "DVHD", "DVSL":
		return "dv"
	default:
		return strings.TrimSpace(value)
	}
}

func normalizeAVIAudioCodec(tag uint16) string {
	switch tag {
	case 0x0001:
		return "pcm"
	case 0x0050:
		return "mpeg-audio"
	case 0x0055:
		return "mp3"
	case 0x00ff:
		return "aac"
	case 0x2000:
		return "ac3"
	case 0x2001:
		return "dts"
	default:
		if tag == 0 {
			return ""
		}
		return fmt.Sprintf("wave:0x%04x", tag)
	}
}

func readRIFFChunk(r io.ReadSeeker, position, end int64) (riffChunk, error) {
	var out riffChunk
	if position < 0 || position+8 > end {
		return out, io.EOF
	}
	if _, err := r.Seek(position, io.SeekStart); err != nil {
		return out, err
	}
	var header [8]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return out, err
	}
	size := int64(binary.LittleEndian.Uint32(header[4:8]))
	dataStart := position + 8
	if size > end-dataStart {
		return out, errors.New("RIFF chunk exceeds container")
	}
	chunkEnd := dataStart + size
	next := chunkEnd
	if size&1 != 0 {
		next++
	}
	if next > end {
		return out, errors.New("RIFF chunk padding exceeds container")
	}
	return riffChunk{
		ID: string(header[:4]), DataStart: dataStart, Size: size, End: chunkEnd, Next: next,
	}, nil
}

func readRIFFPayload(r io.ReadSeeker, chunk riffChunk, max int64) ([]byte, error) {
	if chunk.Size < 0 || chunk.Size > max {
		return nil, errors.New("RIFF chunk exceeds metadata limit")
	}
	if _, err := r.Seek(chunk.DataStart, io.SeekStart); err != nil {
		return nil, err
	}
	data := make([]byte, int(chunk.Size))
	if _, err := io.ReadFull(r, data); err != nil {
		return nil, err
	}
	return data, nil
}

func readFourCC(r io.ReadSeeker, position int64) (string, error) {
	if _, err := r.Seek(position, io.SeekStart); err != nil {
		return "", err
	}
	var value [4]byte
	if _, err := io.ReadFull(r, value[:]); err != nil {
		return "", err
	}
	return string(value[:]), nil
}

func cleanFourCC(value []byte) string {
	if len(value) < 4 {
		return ""
	}
	allZero := true
	for _, b := range value[:4] {
		if b != 0 {
			allZero = false
			break
		}
	}
	if allZero {
		return ""
	}
	return strings.TrimSpace(string(value[:4]))
}
