package media

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
)

const (
	mpegTSPacketBytes      = int64(188)
	m2TSPacketBytes        = int64(192)
	m2TSSyncOffset         = int64(4)
	maxTSProbePackets      = 8
	maxTSMetadataScanBytes = int64(8 << 20)
	maxTSElementaryBytes   = 2 << 20
	maxPSISectionBytes     = 4096
)

type tsGeometry struct {
	PacketSize int64
	SyncOffset int64
}

type tsTrackInfo struct {
	PID        uint16 `json:"pid"`
	StreamType uint8  `json:"stream_type"`
	Kind       string `json:"type"`
	Codec      string `json:"codec,omitempty"`
}

type mpegTSInfo struct {
	PacketSize      int64
	SyncOffset      int64
	PCRPID          uint16
	Tracks          []tsTrackInfo
	DurationSeconds float64
	Width           int
	Height          int
	FrameRate       float64
	VideoCodec      string
	AudioCodec      string
}

type tsPacket struct {
	PID     uint16
	PUSI    bool
	Payload []byte
	PCR     *uint64
}

type tsTiming struct {
	firstPCR *uint64
	lastPCR  *uint64
	firstPTS *uint64
	lastPTS  *uint64
}

type psiAssembler struct {
	buf []byte
}

func extractMPEGTSVideo(r io.ReadSeeker, size int64, out *Result) error {
	info, err := parseMPEGTS(r, size)
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
		"container":   "mpeg-ts",
		"packet_size": info.PacketSize,
		"sync_offset": info.SyncOffset,
		"duration_ms": out.DurationMS,
		"frame_rate":  out.FrameRate,
		"bit_rate":    out.BitRate,
		"video_codec": out.VideoCodec,
		"audio_codec": out.AudioCodec,
		"pcr_pid":     info.PCRPID,
		"tracks":      info.Tracks,
	}); err == nil {
		out.VideoJSON = string(encoded)
	}
	return nil
}

func parseMPEGTS(r io.ReadSeeker, size int64) (mpegTSInfo, error) {
	var out mpegTSInfo
	if r == nil {
		return out, errors.New("mpeg-ts reader is nil")
	}
	if size <= 0 {
		end, err := r.Seek(0, io.SeekEnd)
		if err != nil {
			return out, err
		}
		size = end
	}
	geometry, err := detectTSGeometry(r, size)
	if err != nil {
		return out, err
	}
	out.PacketSize = geometry.PacketSize
	out.SyncOffset = geometry.SyncOffset

	probeEnd := size
	if probeEnd > maxTSMetadataScanBytes {
		probeEnd = maxTSMetadataScanBytes
	}
	pcrPID, tracks, err := discoverTSProgram(r, geometry, 0, probeEnd)
	if err != nil {
		return out, err
	}
	out.PCRPID = pcrPID
	out.Tracks = tracks

	videoPID := uint16(0xffff)
	timingPID := uint16(0xffff)
	for _, track := range tracks {
		switch track.Kind {
		case "video":
			if videoPID == 0xffff {
				videoPID = track.PID
				out.VideoCodec = track.Codec
			}
		case "audio":
			if out.AudioCodec == "" {
				out.AudioCodec = track.Codec
			}
		}
	}
	if videoPID != 0xffff {
		timingPID = videoPID
	} else if len(tracks) != 0 {
		timingPID = tracks[0].PID
	}

	firstTiming, elementary, err := collectTSMetadataWindow(
		r, geometry, 0, probeEnd, pcrPID, timingPID, videoPID, true,
	)
	if err != nil {
		return out, err
	}
	lastTiming := firstTiming
	if size > probeEnd {
		start := size - maxTSMetadataScanBytes
		start -= start % geometry.PacketSize
		lastTiming, _, err = collectTSMetadataWindow(
			r, geometry, start, size, pcrPID, timingPID, videoPID, false,
		)
		if err != nil {
			return out, err
		}
	}
	out.DurationSeconds = tsDuration(firstTiming, lastTiming)

	switch out.VideoCodec {
	case "h264":
		out.Width, out.Height, out.FrameRate = h264DimensionsAndFrameRate(elementary)
	case "hevc":
		out.Width, out.Height = hevcDimensions(elementary)
	case "mpeg2-video":
		out.Width, out.Height, out.FrameRate = mpeg2VideoDimensionsAndFrameRate(elementary)
	}
	return out, nil
}

func detectTSGeometry(r io.ReadSeeker, size int64) (tsGeometry, error) {
	candidates := []tsGeometry{
		{PacketSize: mpegTSPacketBytes, SyncOffset: 0},
		{PacketSize: m2TSPacketBytes, SyncOffset: m2TSSyncOffset},
	}
	for _, candidate := range candidates {
		required := candidate.SyncOffset + candidate.PacketSize*3
		if size < required {
			continue
		}
		probeSize := candidate.PacketSize * maxTSProbePackets
		if probeSize > size {
			probeSize = size
		}
		if _, err := r.Seek(0, io.SeekStart); err != nil {
			return tsGeometry{}, err
		}
		data := make([]byte, int(probeSize))
		if _, err := io.ReadFull(r, data); err != nil {
			return tsGeometry{}, err
		}
		matches := 0
		for packet := int64(0); packet < maxTSProbePackets; packet++ {
			index := candidate.SyncOffset + packet*candidate.PacketSize
			if index >= int64(len(data)) {
				break
			}
			if data[index] != 0x47 {
				break
			}
			matches++
		}
		if matches >= 3 {
			return candidate, nil
		}
	}
	return tsGeometry{}, errors.New("mpeg-ts packet geometry not found")
}

func scanTSPackets(
	r io.ReadSeeker,
	geometry tsGeometry,
	start, end int64,
	consume func(tsPacket) error,
) error {
	if start < 0 {
		start = 0
	}
	start -= start % geometry.PacketSize
	if end < start {
		return nil
	}
	buffer := make([]byte, int(geometry.PacketSize))
	for position := start; position+geometry.PacketSize <= end; position += geometry.PacketSize {
		if _, err := r.Seek(position, io.SeekStart); err != nil {
			return err
		}
		if _, err := io.ReadFull(r, buffer); err != nil {
			return err
		}
		packet, err := parseTSPacket(buffer, geometry)
		if err != nil {
			continue
		}
		if err := consume(packet); err != nil {
			return err
		}
	}
	return nil
}

func parseTSPacket(raw []byte, geometry tsGeometry) (tsPacket, error) {
	var out tsPacket
	start := int(geometry.SyncOffset)
	if start < 0 || start+188 > len(raw) || raw[start] != 0x47 {
		return out, errors.New("invalid mpeg-ts sync byte")
	}
	data := raw[start : start+188]
	if data[1]&0x80 != 0 {
		return out, errors.New("mpeg-ts transport error indicator set")
	}
	out.PUSI = data[1]&0x40 != 0
	out.PID = uint16(data[1]&0x1f)<<8 | uint16(data[2])
	adaptationControl := (data[3] >> 4) & 0x03
	if adaptationControl == 0 {
		return out, errors.New("invalid mpeg-ts adaptation control")
	}
	offset := 4
	if adaptationControl == 2 || adaptationControl == 3 {
		if offset >= len(data) {
			return out, errors.New("short mpeg-ts adaptation field")
		}
		length := int(data[offset])
		offset++
		if offset+length > len(data) {
			return out, errors.New("mpeg-ts adaptation field exceeds packet")
		}
		if length >= 7 && data[offset]&0x10 != 0 {
			p := data[offset+1 : offset+7]
			base := uint64(p[0])<<25 |
				uint64(p[1])<<17 |
				uint64(p[2])<<9 |
				uint64(p[3])<<1 |
				uint64(p[4]>>7)
			extension := uint64(p[4]&0x01)<<8 | uint64(p[5])
			value := base*300 + extension
			out.PCR = &value
		}
		offset += length
	}
	if adaptationControl == 2 || offset >= len(data) {
		return out, nil
	}
	out.Payload = data[offset:]
	return out, nil
}

func discoverTSProgram(
	r io.ReadSeeker,
	geometry tsGeometry,
	start, end int64,
) (uint16, []tsTrackInfo, error) {
	pmtPID := uint16(0xffff)
	patAssembler := psiAssembler{}
	pmtAssembler := psiAssembler{}
	var pcrPID uint16
	var tracks []tsTrackInfo
	err := scanTSPackets(r, geometry, start, end, func(packet tsPacket) error {
		if len(packet.Payload) == 0 {
			return nil
		}
		if packet.PID == 0 {
			for _, section := range patAssembler.Feed(packet.Payload, packet.PUSI) {
				pid, ok := parsePAT(section)
				if ok {
					pmtPID = pid
				}
			}
			return nil
		}
		if pmtPID == 0xffff || packet.PID != pmtPID {
			return nil
		}
		for _, section := range pmtAssembler.Feed(packet.Payload, packet.PUSI) {
			pcr, parsedTracks, ok := parsePMT(section)
			if !ok {
				continue
			}
			pcrPID = pcr
			tracks = parsedTracks
			return io.EOF
		}
		return nil
	})
	if err != nil && !errors.Is(err, io.EOF) {
		return 0, nil, err
	}
	if pmtPID == 0xffff {
		return 0, nil, errors.New("mpeg-ts PAT did not expose a program")
	}
	if len(tracks) == 0 {
		return 0, nil, errors.New("mpeg-ts PMT did not expose media streams")
	}
	return pcrPID, tracks, nil
}

func (a *psiAssembler) Feed(payload []byte, start bool) [][]byte {
	if len(payload) == 0 {
		return nil
	}
	var out [][]byte
	if start {
		pointer := int(payload[0])
		if 1+pointer > len(payload) {
			a.buf = nil
			return nil
		}
		if len(a.buf) != 0 && pointer > 0 {
			a.buf = append(a.buf, payload[1:1+pointer]...)
			sections, complete := a.extract()
			out = append(out, sections...)
			if !complete {
				a.buf = nil
			}
		} else {
			a.buf = nil
		}
		payload = payload[1+pointer:]
		a.buf = append(a.buf, payload...)
		sections, _ := a.extract()
		out = append(out, sections...)
		return out
	}
	if len(a.buf) == 0 {
		return nil
	}
	a.buf = append(a.buf, payload...)
	sections, _ := a.extract()
	return sections
}

func (a *psiAssembler) extract() ([][]byte, bool) {
	var out [][]byte
	for {
		for len(a.buf) != 0 && a.buf[0] == 0xff {
			a.buf = a.buf[1:]
		}
		if len(a.buf) == 0 {
			return out, true
		}
		if len(a.buf) < 3 {
			return out, false
		}
		sectionLength := int(a.buf[1]&0x0f)<<8 | int(a.buf[2])
		total := 3 + sectionLength
		if sectionLength < 4 || total > maxPSISectionBytes {
			a.buf = nil
			return out, false
		}
		if len(a.buf) < total {
			return out, false
		}
		section := append([]byte(nil), a.buf[:total]...)
		out = append(out, section)
		a.buf = a.buf[total:]
	}
}

func parsePAT(section []byte) (uint16, bool) {
	if len(section) < 12 || section[0] != 0x00 || section[5]&0x01 == 0 {
		return 0, false
	}
	end := len(section) - 4
	for offset := 8; offset+4 <= end; offset += 4 {
		program := binary.BigEndian.Uint16(section[offset : offset+2])
		if program == 0 {
			continue
		}
		pid := uint16(section[offset+2]&0x1f)<<8 | uint16(section[offset+3])
		return pid, true
	}
	return 0, false
}

func parsePMT(section []byte) (uint16, []tsTrackInfo, bool) {
	if len(section) < 16 || section[0] != 0x02 || section[5]&0x01 == 0 {
		return 0, nil, false
	}
	pcrPID := uint16(section[8]&0x1f)<<8 | uint16(section[9])
	programInfoLength := int(section[10]&0x0f)<<8 | int(section[11])
	offset := 12 + programInfoLength
	end := len(section) - 4
	if offset > end {
		return 0, nil, false
	}
	tracks := make([]tsTrackInfo, 0, 4)
	for offset+5 <= end {
		streamType := section[offset]
		pid := uint16(section[offset+1]&0x1f)<<8 | uint16(section[offset+2])
		infoLength := int(section[offset+3]&0x0f)<<8 | int(section[offset+4])
		next := offset + 5 + infoLength
		if next > end {
			return 0, nil, false
		}
		kind, codec := tsStreamKindCodec(streamType, section[offset+5:next])
		if kind != "" {
			tracks = append(tracks, tsTrackInfo{
				PID: pid, StreamType: streamType, Kind: kind, Codec: codec,
			})
		}
		offset = next
	}
	return pcrPID, tracks, true
}

func tsStreamKindCodec(streamType uint8, descriptors []byte) (string, string) {
	switch streamType {
	case 0x01:
		return "video", "mpeg1-video"
	case 0x02:
		return "video", "mpeg2-video"
	case 0x10:
		return "video", "mpeg4"
	case 0x1b:
		return "video", "h264"
	case 0x24:
		return "video", "hevc"
	case 0x03:
		return "audio", "mpeg1-audio"
	case 0x04:
		return "audio", "mpeg2-audio"
	case 0x0f:
		return "audio", "aac"
	case 0x11:
		return "audio", "aac-latm"
	case 0x81:
		return "audio", "ac3"
	case 0x87:
		return "audio", "eac3"
	case 0x06:
		for offset := 0; offset+2 <= len(descriptors); {
			tag := descriptors[offset]
			length := int(descriptors[offset+1])
			next := offset + 2 + length
			if next > len(descriptors) {
				break
			}
			data := descriptors[offset+2 : next]
			switch tag {
			case 0x6a:
				return "audio", "ac3"
			case 0x7a:
				return "audio", "eac3"
			case 0x7b:
				return "audio", "dts"
			case 0x05:
				if len(data) >= 4 {
					switch string(data[:4]) {
					case "AC-3":
						return "audio", "ac3"
					case "EAC3":
						return "audio", "eac3"
					case "DTS1", "DTS2", "DTS3":
						return "audio", "dts"
					}
				}
			}
			offset = next
		}
	}
	return "", ""
}

func collectTSMetadataWindow(
	r io.ReadSeeker,
	geometry tsGeometry,
	start, end int64,
	pcrPID, timingPID, videoPID uint16,
	collectElementary bool,
) (tsTiming, []byte, error) {
	var timing tsTiming
	elementary := make([]byte, 0, 64<<10)
	err := scanTSPackets(r, geometry, start, end, func(packet tsPacket) error {
		if packet.PID == pcrPID && packet.PCR != nil {
			value := *packet.PCR
			if timing.firstPCR == nil {
				copy := value
				timing.firstPCR = &copy
			}
			copy := value
			timing.lastPCR = &copy
		}
		if packet.PID != timingPID || len(packet.Payload) == 0 {
			return nil
		}
		payload := packet.Payload
		var pts *uint64
		if packet.PUSI {
			var data []byte
			data, pts = parsePESPayload(payload)
			payload = data
		}
		if pts != nil {
			value := *pts
			if timing.firstPTS == nil {
				copy := value
				timing.firstPTS = &copy
			}
			copy := value
			timing.lastPTS = &copy
		}
		if collectElementary && packet.PID == videoPID && len(payload) != 0 &&
			len(elementary) < maxTSElementaryBytes {
			remaining := maxTSElementaryBytes - len(elementary)
			if len(payload) > remaining {
				payload = payload[:remaining]
			}
			elementary = append(elementary, payload...)
		}
		return nil
	})
	return timing, elementary, err
}

func parsePESPayload(payload []byte) ([]byte, *uint64) {
	if len(payload) < 9 ||
		payload[0] != 0x00 || payload[1] != 0x00 || payload[2] != 0x01 {
		return nil, nil
	}
	headerEnd := 9 + int(payload[8])
	if headerEnd > len(payload) {
		return nil, nil
	}
	var pts *uint64
	flags := (payload[7] >> 6) & 0x03
	if (flags == 2 || flags == 3) && len(payload) >= 14 {
		if value, ok := decodePTS(payload[9:14]); ok {
			pts = &value
		}
	}
	return payload[headerEnd:], pts
}

func decodePTS(data []byte) (uint64, bool) {
	if len(data) < 5 ||
		data[0]&0x01 == 0 ||
		data[2]&0x01 == 0 ||
		data[4]&0x01 == 0 {
		return 0, false
	}
	value := uint64((data[0]>>1)&0x07)<<30 |
		uint64(data[1])<<22 |
		uint64(data[2]>>1)<<15 |
		uint64(data[3])<<7 |
		uint64(data[4]>>1)
	return value, true
}

func tsDuration(first, last tsTiming) float64 {
	if first.firstPCR != nil && last.lastPCR != nil {
		if seconds := wrappedTimestampSeconds(
			*first.firstPCR, *last.lastPCR, (uint64(1)<<33)*300, 27_000_000,
		); seconds > 0 {
			return seconds
		}
	}
	if first.firstPTS != nil && last.lastPTS != nil {
		return wrappedTimestampSeconds(
			*first.firstPTS, *last.lastPTS, uint64(1)<<33, 90_000,
		)
	}
	return 0
}

func wrappedTimestampSeconds(start, end, modulus uint64, rate float64) float64 {
	if rate <= 0 || modulus == 0 {
		return 0
	}
	var delta uint64
	if end >= start {
		delta = end - start
	} else {
		delta = modulus - start + end
	}
	seconds := float64(delta) / rate
	if seconds <= 0 || seconds > 7*24*60*60 {
		return 0
	}
	return seconds
}

func h264DimensionsAndFrameRate(data []byte) (int, int, float64) {
	for _, nalu := range annexBNALUs(data) {
		if len(nalu) < 2 || nalu[0]&0x1f != 7 {
			continue
		}
		if width, height, fps, ok := parseH264SPS(nalu[1:]); ok {
			return width, height, fps
		}
	}
	return 0, 0, 0
}

func parseH264SPS(raw []byte) (int, int, float64, bool) {
	rbsp := removeEmulationPrevention(raw)
	reader := bitReader{data: rbsp}
	profile, ok := reader.bits(8)
	if !ok {
		return 0, 0, 0, false
	}
	if _, ok = reader.bits(8); !ok {
		return 0, 0, 0, false
	}
	if _, ok = reader.bits(8); !ok {
		return 0, 0, 0, false
	}
	if _, ok = reader.ue(); !ok {
		return 0, 0, 0, false
	}

	chromaFormat := uint64(1)
	separateColourPlane := false
	switch profile {
	case 100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135:
		chromaFormat, ok = reader.ue()
		if !ok || chromaFormat > 3 {
			return 0, 0, 0, false
		}
		if chromaFormat == 3 {
			bit, readOK := reader.bit()
			if !readOK {
				return 0, 0, 0, false
			}
			separateColourPlane = bit != 0
		}
		if _, ok = reader.ue(); !ok {
			return 0, 0, 0, false
		}
		if _, ok = reader.ue(); !ok {
			return 0, 0, 0, false
		}
		if _, ok = reader.bit(); !ok {
			return 0, 0, 0, false
		}
		scalingPresent, readOK := reader.bit()
		if !readOK {
			return 0, 0, 0, false
		}
		if scalingPresent != 0 {
			count := 8
			if chromaFormat == 3 {
				count = 12
			}
			for i := 0; i < count; i++ {
				present, presentOK := reader.bit()
				if !presentOK {
					return 0, 0, 0, false
				}
				if present != 0 && !skipH264ScalingList(&reader, 16+48*(i/6)) {
					return 0, 0, 0, false
				}
			}
		}
	}
	if _, ok = reader.ue(); !ok {
		return 0, 0, 0, false
	}
	picOrderCntType, ok := reader.ue()
	if !ok {
		return 0, 0, 0, false
	}
	switch picOrderCntType {
	case 0:
		if _, ok = reader.ue(); !ok {
			return 0, 0, 0, false
		}
	case 1:
		if _, ok = reader.bit(); !ok {
			return 0, 0, 0, false
		}
		if _, ok = reader.se(); !ok {
			return 0, 0, 0, false
		}
		if _, ok = reader.se(); !ok {
			return 0, 0, 0, false
		}
		count, countOK := reader.ue()
		if !countOK || count > 256 {
			return 0, 0, 0, false
		}
		for i := uint64(0); i < count; i++ {
			if _, ok = reader.se(); !ok {
				return 0, 0, 0, false
			}
		}
	}
	if _, ok = reader.ue(); !ok {
		return 0, 0, 0, false
	}
	if _, ok = reader.bit(); !ok {
		return 0, 0, 0, false
	}
	widthMbs, ok := reader.ue()
	if !ok {
		return 0, 0, 0, false
	}
	heightMapUnits, ok := reader.ue()
	if !ok {
		return 0, 0, 0, false
	}
	frameMbsOnly, ok := reader.bit()
	if !ok {
		return 0, 0, 0, false
	}
	if frameMbsOnly == 0 {
		if _, ok = reader.bit(); !ok {
			return 0, 0, 0, false
		}
	}
	if _, ok = reader.bit(); !ok {
		return 0, 0, 0, false
	}
	cropFlag, ok := reader.bit()
	if !ok {
		return 0, 0, 0, false
	}
	var cropLeft, cropRight, cropTop, cropBottom uint64
	if cropFlag != 0 {
		if cropLeft, ok = reader.ue(); !ok {
			return 0, 0, 0, false
		}
		if cropRight, ok = reader.ue(); !ok {
			return 0, 0, 0, false
		}
		if cropTop, ok = reader.ue(); !ok {
			return 0, 0, 0, false
		}
		if cropBottom, ok = reader.ue(); !ok {
			return 0, 0, 0, false
		}
	}

	width := int((widthMbs + 1) * 16)
	height := int((heightMapUnits + 1) * 16 * (2 - uint64(frameMbsOnly)))
	chromaArrayType := chromaFormat
	if separateColourPlane {
		chromaArrayType = 0
	}
	cropUnitX, cropUnitY := uint64(1), uint64(2-frameMbsOnly)
	switch chromaArrayType {
	case 1:
		cropUnitX, cropUnitY = 2, 2*(2-uint64(frameMbsOnly))
	case 2:
		cropUnitX, cropUnitY = 2, 2-uint64(frameMbsOnly)
	case 3:
		cropUnitX, cropUnitY = 1, 2-uint64(frameMbsOnly)
	}
	cropX := cropUnitX * (cropLeft + cropRight)
	cropY := cropUnitY * (cropTop + cropBottom)
	if cropX >= uint64(width) || cropY >= uint64(height) {
		return 0, 0, 0, false
	}
	width -= int(cropX)
	height -= int(cropY)

	fps := float64(0)
	vuiPresent, ok := reader.bit()
	if ok && vuiPresent != 0 {
		fps = parseH264VUITiming(&reader)
	}
	if width <= 0 || height <= 0 {
		return 0, 0, 0, false
	}
	return width, height, fps, true
}

func skipH264ScalingList(reader *bitReader, size int) bool {
	lastScale := int64(8)
	nextScale := int64(8)
	for i := 0; i < size; i++ {
		if nextScale != 0 {
			delta, ok := reader.se()
			if !ok {
				return false
			}
			nextScale = (lastScale + delta + 256) % 256
		}
		if nextScale != 0 {
			lastScale = nextScale
		}
	}
	return true
}

func parseH264VUITiming(reader *bitReader) float64 {
	aspect, ok := reader.bit()
	if !ok {
		return 0
	}
	if aspect != 0 {
		idc, ok := reader.bits(8)
		if !ok {
			return 0
		}
		if idc == 255 {
			if _, ok = reader.bits(16); !ok {
				return 0
			}
			if _, ok = reader.bits(16); !ok {
				return 0
			}
		}
	}
	overscan, ok := reader.bit()
	if !ok {
		return 0
	}
	if overscan != 0 {
		if _, ok = reader.bit(); !ok {
			return 0
		}
	}
	videoSignal, ok := reader.bit()
	if !ok {
		return 0
	}
	if videoSignal != 0 {
		if _, ok = reader.bits(3); !ok {
			return 0
		}
		if _, ok = reader.bit(); !ok {
			return 0
		}
		colourDescription, colourOK := reader.bit()
		if !colourOK {
			return 0
		}
		if colourDescription != 0 {
			if _, ok = reader.bits(24); !ok {
				return 0
			}
		}
	}
	chromaLoc, ok := reader.bit()
	if !ok {
		return 0
	}
	if chromaLoc != 0 {
		if _, ok = reader.ue(); !ok {
			return 0
		}
		if _, ok = reader.ue(); !ok {
			return 0
		}
	}
	timingPresent, ok := reader.bit()
	if !ok || timingPresent == 0 {
		return 0
	}
	numUnits, ok := reader.bits(32)
	if !ok {
		return 0
	}
	timeScale, ok := reader.bits(32)
	if !ok {
		return 0
	}
	if _, ok = reader.bit(); !ok || numUnits == 0 {
		return 0
	}
	return float64(timeScale) / (2 * float64(numUnits))
}

func hevcDimensions(data []byte) (int, int) {
	for _, nalu := range annexBNALUs(data) {
		if len(nalu) < 4 || (nalu[0]>>1)&0x3f != 33 {
			continue
		}
		if width, height, ok := parseHEVCSPS(nalu[2:]); ok {
			return width, height
		}
	}
	return 0, 0
}

func parseHEVCSPS(raw []byte) (int, int, bool) {
	reader := bitReader{data: removeEmulationPrevention(raw)}
	if _, ok := reader.bits(4); !ok {
		return 0, 0, false
	}
	maxSubLayers, ok := reader.bits(3)
	if !ok {
		return 0, 0, false
	}
	if _, ok = reader.bit(); !ok {
		return 0, 0, false
	}
	if !skipHEVCProfileTierLevel(&reader, int(maxSubLayers)) {
		return 0, 0, false
	}
	if _, ok = reader.ue(); !ok {
		return 0, 0, false
	}
	chromaFormat, ok := reader.ue()
	if !ok || chromaFormat > 3 {
		return 0, 0, false
	}
	separateColourPlane := false
	if chromaFormat == 3 {
		bit, readOK := reader.bit()
		if !readOK {
			return 0, 0, false
		}
		separateColourPlane = bit != 0
	}
	width, ok := reader.ue()
	if !ok {
		return 0, 0, false
	}
	height, ok := reader.ue()
	if !ok {
		return 0, 0, false
	}
	window, ok := reader.bit()
	if !ok {
		return 0, 0, false
	}
	var left, right, top, bottom uint64
	if window != 0 {
		if left, ok = reader.ue(); !ok {
			return 0, 0, false
		}
		if right, ok = reader.ue(); !ok {
			return 0, 0, false
		}
		if top, ok = reader.ue(); !ok {
			return 0, 0, false
		}
		if bottom, ok = reader.ue(); !ok {
			return 0, 0, false
		}
	}
	arrayType := chromaFormat
	if separateColourPlane {
		arrayType = 0
	}
	subWidth, subHeight := uint64(1), uint64(1)
	switch arrayType {
	case 1:
		subWidth, subHeight = 2, 2
	case 2:
		subWidth, subHeight = 2, 1
	}
	cropX := subWidth * (left + right)
	cropY := subHeight * (top + bottom)
	if cropX >= width || cropY >= height || width == 0 || height == 0 {
		return 0, 0, false
	}
	return int(width - cropX), int(height - cropY), true
}

func skipHEVCProfileTierLevel(reader *bitReader, maxSubLayers int) bool {
	if _, ok := reader.bits(2 + 1 + 5); !ok {
		return false
	}
	if _, ok := reader.bits(32); !ok {
		return false
	}
	if _, ok := reader.bits(4); !ok {
		return false
	}
	if _, ok := reader.bits(44); !ok {
		return false
	}
	if _, ok := reader.bits(8); !ok {
		return false
	}
	profilePresent := make([]uint64, maxSubLayers)
	levelPresent := make([]uint64, maxSubLayers)
	for i := 0; i < maxSubLayers; i++ {
		var ok bool
		profilePresent[i], ok = reader.bit()
		if !ok {
			return false
		}
		levelPresent[i], ok = reader.bit()
		if !ok {
			return false
		}
	}
	if maxSubLayers > 0 {
		for i := maxSubLayers; i < 8; i++ {
			if _, ok := reader.bits(2); !ok {
				return false
			}
		}
	}
	for i := 0; i < maxSubLayers; i++ {
		if profilePresent[i] != 0 {
			if _, ok := reader.bits(2 + 1 + 5); !ok {
				return false
			}
			if _, ok := reader.bits(32); !ok {
				return false
			}
			if _, ok := reader.bits(4); !ok {
				return false
			}
			if _, ok := reader.bits(44); !ok {
				return false
			}
		}
		if levelPresent[i] != 0 {
			if _, ok := reader.bits(8); !ok {
				return false
			}
		}
	}
	return true
}

func mpeg2VideoDimensionsAndFrameRate(data []byte) (int, int, float64) {
	for index := 0; index+8 <= len(data); index++ {
		if data[index] != 0x00 || data[index+1] != 0x00 ||
			data[index+2] != 0x01 || data[index+3] != 0xb3 {
			continue
		}
		width := int(data[index+4])<<4 | int(data[index+5]>>4)
		height := int(data[index+5]&0x0f)<<8 | int(data[index+6])
		code := data[index+7] & 0x0f
		fps := map[byte]float64{
			1: 24000.0 / 1001,
			2: 24,
			3: 25,
			4: 30000.0 / 1001,
			5: 30,
			6: 50,
			7: 60000.0 / 1001,
			8: 60,
		}[code]
		if width > 0 && height > 0 {
			return width, height, fps
		}
	}
	return 0, 0, 0
}

func annexBNALUs(data []byte) [][]byte {
	var starts []int
	var prefixLengths []int
	for index := 0; index+3 < len(data); {
		prefix := 0
		switch {
		case index+4 <= len(data) &&
			data[index] == 0 && data[index+1] == 0 &&
			data[index+2] == 0 && data[index+3] == 1:
			prefix = 4
		case data[index] == 0 && data[index+1] == 0 && data[index+2] == 1:
			prefix = 3
		}
		if prefix == 0 {
			index++
			continue
		}
		starts = append(starts, index)
		prefixLengths = append(prefixLengths, prefix)
		index += prefix
	}
	out := make([][]byte, 0, len(starts))
	for i, start := range starts {
		payloadStart := start + prefixLengths[i]
		payloadEnd := len(data)
		if i+1 < len(starts) {
			payloadEnd = starts[i+1]
		}
		for payloadEnd > payloadStart && data[payloadEnd-1] == 0 {
			payloadEnd--
		}
		if payloadStart < payloadEnd {
			out = append(out, data[payloadStart:payloadEnd])
		}
	}
	return out
}

func removeEmulationPrevention(data []byte) []byte {
	out := make([]byte, 0, len(data))
	zeroes := 0
	for _, value := range data {
		if zeroes >= 2 && value == 0x03 {
			zeroes = 0
			continue
		}
		out = append(out, value)
		if value == 0 {
			zeroes++
		} else {
			zeroes = 0
		}
	}
	return out
}

type bitReader struct {
	data   []byte
	bitPos int
}

func (r *bitReader) bit() (uint64, bool) {
	return r.bits(1)
}

func (r *bitReader) bits(count int) (uint64, bool) {
	if count < 0 || count > 64 || r.bitPos+count > len(r.data)*8 {
		return 0, false
	}
	var out uint64
	for i := 0; i < count; i++ {
		byteIndex := r.bitPos / 8
		bitIndex := 7 - (r.bitPos % 8)
		out = out<<1 | uint64((r.data[byteIndex]>>bitIndex)&1)
		r.bitPos++
	}
	return out, true
}

func (r *bitReader) ue() (uint64, bool) {
	zeroes := 0
	for {
		value, ok := r.bit()
		if !ok {
			return 0, false
		}
		if value != 0 {
			break
		}
		zeroes++
		if zeroes > 63 {
			return 0, false
		}
	}
	if zeroes == 0 {
		return 0, true
	}
	suffix, ok := r.bits(zeroes)
	if !ok {
		return 0, false
	}
	return (uint64(1)<<zeroes - 1) + suffix, true
}

func (r *bitReader) se() (int64, bool) {
	value, ok := r.ue()
	if !ok {
		return 0, false
	}
	if value&1 != 0 {
		return int64((value + 1) / 2), true
	}
	return -int64(value / 2), true
}
