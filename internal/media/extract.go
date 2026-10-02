package media

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strings"
	"time"
)

const maxEmbeddedMetadataBytes = 32 << 20

type Result struct {
	Kind                     string
	MIMEType                 string
	ContainerKind            string
	ContainerJSON            string
	LivePhotoAssetIdentifier string
	Width                    int
	Height                   int
	Orientation              int
	RotationDegrees          int
	DurationMS               int64
	FrameRate                float64
	BitRate                  int64
	VideoCodec               string
	AudioCodec               string
	CapturedAt               *time.Time
	Latitude                 *float64
	Longitude                *float64
	AltitudeM                *float64
	CameraMake               string
	CameraModel              string
	LensModel                string
	EXIFJSON                 string
	VideoJSON                string
}

const (
	KindImage = "image"
	KindVideo = "video"
	KindOther = "other"
)

var imageExtensions = map[string]bool{
	".jpg":  true,
	".jpeg": true,
	".png":  true,
	".gif":  true,
	".webp": true,
	".heic": true,
	".heif": true,
	".avif": true,
	".tif":  true,
	".tiff": true,
	".bmp":  true,
}

var videoExtensions = map[string]bool{
	".mp4":  true,
	".mov":  true,
	".m4v":  true,
	".3gp":  true,
	".3g2":  true,
	".mkv":  true,
	".webm": true,
	".avi":  true,
	".mts":  true,
	".m2ts": true,
	".mpeg": true,
	".mpg":  true,
}

func Extract(name string, r io.ReadSeeker, size int64) (Result, error) {
	result := Result{Orientation: 1}
	if r == nil {
		return result, errors.New("media reader is nil")
	}
	if strings.EqualFold(filepath.Ext(name), ".livp") {
		readerAt, ok := r.(io.ReaderAt)
		if !ok {
			return result, errors.New("livp reader does not support random access")
		}
		return extractLIVP(readerAt, size)
	}
	if _, err := r.Seek(0, io.SeekStart); err != nil {
		return result, err
	}

	header := make([]byte, 512)
	n, err := io.ReadFull(r, header)
	if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, io.ErrUnexpectedEOF) {
		return result, err
	}
	header = header[:n]
	result.MIMEType = detectMIME(name, header)
	result.Kind = classify(name, result.MIMEType, header)

	switch result.Kind {
	case KindImage:
		if err := extractImage(r, header, &result); err != nil {
			return result, err
		}
	case KindVideo:
		if err := extractVideo(r, size, &result); err != nil {
			return result, err
		}
	}
	return result, nil
}

func detectMIME(name string, header []byte) string {
	detected := ""
	if len(header) != 0 {
		detected = http.DetectContentType(header)
		if semi := strings.IndexByte(detected, ';'); semi >= 0 {
			detected = strings.TrimSpace(detected[:semi])
		}
	}

	ext := strings.ToLower(filepath.Ext(name))
	if detected == "" || detected == "application/octet-stream" || detected == "text/plain" {
		if byExt := mime.TypeByExtension(ext); byExt != "" {
			if semi := strings.IndexByte(byExt, ';'); semi >= 0 {
				byExt = strings.TrimSpace(byExt[:semi])
			}
			return byExt
		}
	}

	if detected == "" || detected == "application/octet-stream" || detected == "text/plain" {
		switch ext {
		case ".heic", ".heif":
			return "image/heic"
		case ".avif":
			return "image/avif"
		case ".webp":
			return "image/webp"
		case ".tif", ".tiff":
			return "image/tiff"
		case ".bmp":
			return "image/bmp"
		case ".mov":
			return "video/quicktime"
		case ".mkv":
			return "video/x-matroska"
		case ".webm":
			return "video/webm"
		case ".avi":
			return "video/x-msvideo"
		case ".mts", ".m2ts":
			return "video/mp2t"
		case ".mpeg", ".mpg":
			return "video/mpeg"
		}
	}
	return detected
}

func classify(name, mimeType string, header []byte) string {
	ext := strings.ToLower(filepath.Ext(name))
	if strings.HasPrefix(mimeType, "image/") || imageExtensions[ext] {
		return KindImage
	}
	if strings.HasPrefix(mimeType, "video/") || videoExtensions[ext] {
		return KindVideo
	}
	if len(header) >= 12 && string(header[4:8]) == "ftyp" {
		if isImageBrand(string(header[8:12])) {
			return KindImage
		}
		return KindVideo
	}
	return KindOther
}

func isImageBrand(brand string) bool {
	switch brand {
	case "heic", "heix", "hevc", "hevx", "mif1", "msf1", "avif", "avis":
		return true
	default:
		return false
	}
}

func extractImage(r io.ReadSeeker, header []byte, out *Result) error {
	if _, err := r.Seek(0, io.SeekStart); err != nil {
		return err
	}
	if cfg, format, err := image.DecodeConfig(r); err == nil {
		out.Width = cfg.Width
		out.Height = cfg.Height
		if out.MIMEType == "" || out.MIMEType == "application/octet-stream" {
			out.MIMEType = "image/" + format
		}
	} else {
		switch {
		case strings.EqualFold(out.MIMEType, "image/webp"):
			if width, height, ok := webPDimensions(r); ok {
				out.Width, out.Height = width, height
			}
		case strings.EqualFold(out.MIMEType, "image/bmp"):
			if width, height, ok := bmpDimensions(r); ok {
				out.Width, out.Height = width, height
			}
		default:
			if width, height, ok := isoImageDimensions(r); ok {
				out.Width, out.Height = width, height
			}
		}
	}

	var exif *exifData
	switch {
	case isJPEG(header):
		exif, _ = readJPEGExif(r)
	case isTIFF(header):
		if _, err := r.Seek(0, io.SeekStart); err == nil {
			data, _ := io.ReadAll(io.LimitReader(r, maxEmbeddedMetadataBytes))
			exif, _ = parseTIFF(data)
		}
	default:
		exif, _ = readEmbeddedEXIF(r)
	}
	if exif != nil {
		applyEXIF(out, exif)
	}
	return nil
}

func isJPEG(header []byte) bool {
	return len(header) >= 3 &&
		header[0] == 0xff &&
		header[1] == 0xd8 &&
		header[2] == 0xff
}

func isTIFF(header []byte) bool {
	return len(header) >= 4 &&
		(string(header[:4]) == "II*\x00" || string(header[:4]) == "MM\x00*")
}

type exifData struct {
	Orientation              int
	PixelWidth               int
	PixelHeight              int
	LivePhotoAssetIdentifier string
	CapturedAt               *time.Time
	Latitude                 *float64
	Longitude                *float64
	AltitudeM                *float64
	CameraMake               string
	CameraModel              string
	LensModel                string
	Fields                   map[string]any
}

func applyEXIF(out *Result, exif *exifData) {
	if exif.Orientation >= 1 && exif.Orientation <= 8 {
		out.Orientation = exif.Orientation
	}
	if out.Width == 0 && exif.PixelWidth > 0 {
		out.Width = exif.PixelWidth
	}
	if out.Height == 0 && exif.PixelHeight > 0 {
		out.Height = exif.PixelHeight
	}
	out.CapturedAt = exif.CapturedAt
	out.Latitude = exif.Latitude
	out.Longitude = exif.Longitude
	out.AltitudeM = exif.AltitudeM
	out.CameraMake = exif.CameraMake
	out.CameraModel = exif.CameraModel
	out.LensModel = exif.LensModel
	out.LivePhotoAssetIdentifier = exif.LivePhotoAssetIdentifier
	if len(exif.Fields) != 0 {
		if encoded, err := json.Marshal(exif.Fields); err == nil {
			out.EXIFJSON = string(encoded)
		}
	}
}

func readJPEGExif(r io.ReadSeeker) (*exifData, error) {
	if _, err := r.Seek(2, io.SeekStart); err != nil {
		return nil, err
	}
	for {
		var marker [2]byte
		if _, err := io.ReadFull(r, marker[:]); err != nil {
			return nil, err
		}
		if marker[0] != 0xff {
			return nil, errors.New("invalid jpeg marker")
		}
		for marker[1] == 0xff {
			if _, err := io.ReadFull(r, marker[1:2]); err != nil {
				return nil, err
			}
		}
		if marker[1] == 0xd9 || marker[1] == 0xda {
			return nil, nil
		}
		if marker[1] >= 0xd0 && marker[1] <= 0xd7 {
			continue
		}

		var lengthBytes [2]byte
		if _, err := io.ReadFull(r, lengthBytes[:]); err != nil {
			return nil, err
		}
		segmentLength := int(binary.BigEndian.Uint16(lengthBytes[:]))
		if segmentLength < 2 {
			return nil, errors.New("invalid jpeg segment")
		}
		payloadLength := segmentLength - 2
		if marker[1] == 0xe1 && payloadLength >= 6 && payloadLength <= maxEmbeddedMetadataBytes {
			payload := make([]byte, payloadLength)
			if _, err := io.ReadFull(r, payload); err != nil {
				return nil, err
			}
			if bytes.HasPrefix(payload, []byte("Exif\x00\x00")) {
				return parseTIFF(payload[6:])
			}
			continue
		}
		if _, err := r.Seek(int64(payloadLength), io.SeekCurrent); err != nil {
			return nil, err
		}
	}
}

func readEmbeddedEXIF(r io.ReadSeeker) (*exifData, error) {
	if _, err := r.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	data, err := io.ReadAll(io.LimitReader(r, maxEmbeddedMetadataBytes))
	if err != nil {
		return nil, err
	}
	if index := bytes.Index(data, []byte("Exif\x00\x00")); index >= 0 {
		if exif, err := parseTIFF(data[index+6:]); err == nil {
			return exif, nil
		}
	}
	for _, signature := range [][]byte{[]byte("II*\x00"), []byte("MM\x00*")} {
		search := data
		base := 0
		for {
			index := bytes.Index(search, signature)
			if index < 0 {
				break
			}
			offset := base + index
			if exif, err := parseTIFF(data[offset:]); err == nil {
				return exif, nil
			}
			base = offset + len(signature)
			if base >= len(data) {
				break
			}
			search = data[base:]
		}
	}
	return nil, nil
}

type tiffReader struct {
	data  []byte
	order binary.ByteOrder
}

func parseTIFF(data []byte) (*exifData, error) {
	if len(data) < 8 {
		return nil, errors.New("short tiff")
	}
	var order binary.ByteOrder
	switch string(data[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return nil, errors.New("invalid tiff byte order")
	}
	if order.Uint16(data[2:4]) != 42 {
		return nil, errors.New("invalid tiff magic")
	}

	reader := tiffReader{data: data, order: order}
	rootOffset := int(order.Uint32(data[4:8]))
	out := &exifData{
		Orientation: 1,
		Fields:      map[string]any{},
	}
	exifOffset, gpsOffset, err := reader.parseIFD(
		rootOffset,
		func(tag, typ uint16, count uint32, value []byte) {
			switch tag {
			case 0x0100:
				out.PixelWidth = int(reader.firstUint(typ, count, value))
			case 0x0101:
				out.PixelHeight = int(reader.firstUint(typ, count, value))
			case 0x010e:
				addASCIIField(out.Fields, "image_description", value)
			case 0x010f:
				out.CameraMake = cleanASCII(value)
				if out.CameraMake != "" {
					out.Fields["make"] = out.CameraMake
				}
			case 0x0110:
				out.CameraModel = cleanASCII(value)
				if out.CameraModel != "" {
					out.Fields["model"] = out.CameraModel
				}
			case 0x0112:
				orientation := int(reader.firstUint(typ, count, value))
				if orientation >= 1 && orientation <= 8 {
					out.Orientation = orientation
					out.Fields["orientation"] = orientation
				}
			case 0x0131:
				addASCIIField(out.Fields, "software", value)
			}
		},
	)
	if err != nil {
		return nil, err
	}

	if exifOffset > 0 {
		var capturedRaw string
		_, _, _ = reader.parseIFD(
			exifOffset,
			func(tag, typ uint16, count uint32, value []byte) {
				switch tag {
				case 0x829a:
					addRationalField(reader, out.Fields, "exposure_time_seconds", typ, count, value)
				case 0x829d:
					addRationalField(reader, out.Fields, "f_number", typ, count, value)
				case 0x8827:
					if iso := reader.firstUint(typ, count, value); iso != 0 {
						out.Fields["iso"] = iso
					}
				case 0x9003:
					capturedRaw = cleanASCII(value)
					if capturedRaw != "" {
						out.Fields["datetime_original"] = capturedRaw
					}
				case 0x9004:
					if capturedRaw == "" {
						capturedRaw = cleanASCII(value)
						if capturedRaw != "" {
							out.Fields["datetime_digitized"] = capturedRaw
						}
					}
				case 0x9204:
					values := reader.signedRationals(typ, count, value)
					if len(values) > 0 {
						out.Fields["exposure_bias_ev"] = values[0]
					}
				case 0x9209:
					out.Fields["flash"] = reader.firstUint(typ, count, value)
				case 0x920a:
					addRationalField(reader, out.Fields, "focal_length_mm", typ, count, value)
				case 0x927c:
					out.LivePhotoAssetIdentifier = appleMakerNoteContentIdentifier(value)
				case 0xa002:
					if width := int(reader.firstUint(typ, count, value)); width > 0 {
						out.PixelWidth = width
					}
				case 0xa003:
					if height := int(reader.firstUint(typ, count, value)); height > 0 {
						out.PixelHeight = height
					}
				case 0xa405:
					if focal35 := reader.firstUint(typ, count, value); focal35 != 0 {
						out.Fields["focal_length_35mm"] = focal35
					}
				case 0xa434:
					out.LensModel = cleanASCII(value)
					if out.LensModel != "" {
						out.Fields["lens_model"] = out.LensModel
					}
				}
			},
		)
		if capturedRaw != "" {
			if captured, ok := parseExifTime(capturedRaw); ok {
				out.CapturedAt = &captured
			}
		}
	}

	if gpsOffset > 0 {
		var latitudeRef, longitudeRef string
		var latitude, longitude []float64
		var altitude *float64
		var altitudeRef uint64
		_, _, _ = reader.parseIFD(
			gpsOffset,
			func(tag, typ uint16, count uint32, value []byte) {
				switch tag {
				case 1:
					latitudeRef = cleanASCII(value)
				case 2:
					latitude = reader.rationals(typ, count, value)
				case 3:
					longitudeRef = cleanASCII(value)
				case 4:
					longitude = reader.rationals(typ, count, value)
				case 5:
					altitudeRef = reader.firstUint(typ, count, value)
				case 6:
					values := reader.rationals(typ, count, value)
					if len(values) > 0 {
						value := values[0]
						altitude = &value
					}
				}
			},
		)
		if len(latitude) >= 3 {
			value := latitude[0] + latitude[1]/60 + latitude[2]/3600
			if strings.EqualFold(latitudeRef, "S") {
				value = -value
			}
			out.Latitude = &value
			out.Fields["latitude"] = value
		}
		if len(longitude) >= 3 {
			value := longitude[0] + longitude[1]/60 + longitude[2]/3600
			if strings.EqualFold(longitudeRef, "W") {
				value = -value
			}
			out.Longitude = &value
			out.Fields["longitude"] = value
		}
		if altitude != nil {
			if altitudeRef == 1 {
				*altitude = -*altitude
			}
			out.AltitudeM = altitude
			out.Fields["altitude_m"] = *altitude
		}
	}
	return out, nil
}

func addASCIIField(fields map[string]any, name string, value []byte) {
	if text := cleanASCII(value); text != "" {
		fields[name] = text
	}
}

func addRationalField(
	reader tiffReader,
	fields map[string]any,
	name string,
	typ uint16,
	count uint32,
	value []byte,
) {
	values := reader.rationals(typ, count, value)
	if len(values) > 0 {
		fields[name] = values[0]
	}
}

func (t tiffReader) parseIFD(
	offset int,
	visit func(tag, typ uint16, count uint32, value []byte),
) (int, int, error) {
	if offset < 0 || offset+2 > len(t.data) {
		return 0, 0, errors.New("invalid ifd offset")
	}
	entryCount := int(t.order.Uint16(t.data[offset : offset+2]))
	if entryCount > 4096 || offset+2+entryCount*12 > len(t.data) {
		return 0, 0, errors.New("invalid ifd size")
	}

	exifOffset, gpsOffset := 0, 0
	for index := 0; index < entryCount; index++ {
		base := offset + 2 + index*12
		tag := t.order.Uint16(t.data[base : base+2])
		typ := t.order.Uint16(t.data[base+2 : base+4])
		count := t.order.Uint32(t.data[base+4 : base+8])
		value, ok := t.valueBytes(typ, count, t.data[base+8:base+12])
		if !ok {
			continue
		}
		switch tag {
		case 0x8769:
			exifOffset = int(t.firstUint(typ, count, value))
		case 0x8825:
			gpsOffset = int(t.firstUint(typ, count, value))
		}
		visit(tag, typ, count, value)
	}
	return exifOffset, gpsOffset, nil
}

func tiffTypeSize(typ uint16) int {
	switch typ {
	case 1, 2, 6, 7:
		return 1
	case 3, 8:
		return 2
	case 4, 9, 11:
		return 4
	case 5, 10, 12:
		return 8
	default:
		return 0
	}
}

func (t tiffReader) valueBytes(
	typ uint16,
	count uint32,
	inline []byte,
) ([]byte, bool) {
	unit := tiffTypeSize(typ)
	if unit == 0 || count > 1<<20 {
		return nil, false
	}
	total64 := uint64(unit) * uint64(count)
	if total64 > uint64(len(t.data)) {
		return nil, false
	}
	total := int(total64)
	if total <= 4 {
		return inline[:total], true
	}
	offset := int(t.order.Uint32(inline))
	if offset < 0 || offset+total > len(t.data) {
		return nil, false
	}
	return t.data[offset : offset+total], true
}

func (t tiffReader) firstUint(
	typ uint16,
	count uint32,
	value []byte,
) uint64 {
	if count == 0 {
		return 0
	}
	switch typ {
	case 1, 6, 7:
		if len(value) >= 1 {
			return uint64(value[0])
		}
	case 3, 8:
		if len(value) >= 2 {
			return uint64(t.order.Uint16(value[:2]))
		}
	case 4, 9:
		if len(value) >= 4 {
			return uint64(t.order.Uint32(value[:4]))
		}
	}
	return 0
}

func (t tiffReader) rationals(
	typ uint16,
	count uint32,
	value []byte,
) []float64 {
	if typ != 5 {
		return nil
	}
	out := make([]float64, 0, count)
	for index := 0; index < int(count); index++ {
		base := index * 8
		if base+8 > len(value) {
			break
		}
		numerator := t.order.Uint32(value[base : base+4])
		denominator := t.order.Uint32(value[base+4 : base+8])
		if denominator == 0 {
			continue
		}
		out = append(out, float64(numerator)/float64(denominator))
	}
	return out
}

func (t tiffReader) signedRationals(
	typ uint16,
	count uint32,
	value []byte,
) []float64 {
	if typ != 10 {
		return nil
	}
	out := make([]float64, 0, count)
	for index := 0; index < int(count); index++ {
		base := index * 8
		if base+8 > len(value) {
			break
		}
		numerator := int32(t.order.Uint32(value[base : base+4]))
		denominator := int32(t.order.Uint32(value[base+4 : base+8]))
		if denominator == 0 {
			continue
		}
		out = append(out, float64(numerator)/float64(denominator))
	}
	return out
}

func cleanASCII(value []byte) string {
	return strings.TrimSpace(strings.TrimRight(string(value), "\x00"))
}

func parseExifTime(raw string) (time.Time, bool) {
	for _, layout := range []string{
		"2006:01:02 15:04:05",
		"2006-01-02 15:04:05",
		time.RFC3339,
	} {
		if parsed, err := time.Parse(layout, strings.TrimSpace(raw)); err == nil {
			return parsed.UTC(), true
		}
	}
	return time.Time{}, false
}

func webPDimensions(r io.ReadSeeker) (int, int, bool) {
	if _, err := r.Seek(0, io.SeekStart); err != nil {
		return 0, 0, false
	}
	data, _ := io.ReadAll(io.LimitReader(r, 8<<20))
	if len(data) < 30 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WEBP" {
		return 0, 0, false
	}
	for offset := 12; offset+8 <= len(data); {
		kind := string(data[offset : offset+4])
		size := int(binary.LittleEndian.Uint32(data[offset+4 : offset+8]))
		start := offset + 8
		end := start + size
		if end > len(data) {
			break
		}
		switch kind {
		case "VP8X":
			if size >= 10 {
				width := 1 +
					int(data[start+4]) +
					(int(data[start+5]) << 8) +
					(int(data[start+6]) << 16)
				height := 1 +
					int(data[start+7]) +
					(int(data[start+8]) << 8) +
					(int(data[start+9]) << 16)
				return width, height, true
			}
		case "VP8L":
			if size >= 5 && data[start] == 0x2f {
				bits := binary.LittleEndian.Uint32(data[start+1 : start+5])
				return int(bits&0x3fff) + 1, int((bits>>14)&0x3fff) + 1, true
			}
		case "VP8 ":
			for index := start; index+7 <= end; index++ {
				if data[index] == 0x9d &&
					data[index+1] == 0x01 &&
					data[index+2] == 0x2a {
					width := int(
						binary.LittleEndian.Uint16(data[index+3:index+5]) & 0x3fff,
					)
					height := int(
						binary.LittleEndian.Uint16(data[index+5:index+7]) & 0x3fff,
					)
					return width, height, true
				}
			}
		}
		offset = end + (size & 1)
	}
	return 0, 0, false
}

func bmpDimensions(r io.ReadSeeker) (int, int, bool) {
	if _, err := r.Seek(0, io.SeekStart); err != nil {
		return 0, 0, false
	}
	header := make([]byte, 26)
	if _, err := io.ReadFull(r, header); err != nil {
		return 0, 0, false
	}
	if string(header[:2]) != "BM" {
		return 0, 0, false
	}
	width := int(int32(binary.LittleEndian.Uint32(header[18:22])))
	height := int(int32(binary.LittleEndian.Uint32(header[22:26])))
	if width <= 0 || height == 0 {
		return 0, 0, false
	}
	if height < 0 {
		height = -height
	}
	return width, height, true
}

func isoImageDimensions(r io.ReadSeeker) (int, int, bool) {
	if _, err := r.Seek(0, io.SeekStart); err != nil {
		return 0, 0, false
	}
	data, _ := io.ReadAll(io.LimitReader(r, 16<<20))
	for index := 4; index+16 <= len(data); index++ {
		if string(data[index:index+4]) != "ispe" {
			continue
		}
		size := int(binary.BigEndian.Uint32(data[index-4 : index]))
		if size < 20 || index-4+size > len(data) {
			continue
		}
		payload := index + 4
		if payload+12 > len(data) {
			continue
		}
		width := int(binary.BigEndian.Uint32(data[payload+4 : payload+8]))
		height := int(binary.BigEndian.Uint32(data[payload+8 : payload+12]))
		if width > 0 && height > 0 {
			return width, height, true
		}
	}
	return 0, 0, false
}

type mp4Track struct {
	Handler  string  `json:"handler,omitempty"`
	Width    int     `json:"width,omitempty"`
	Height   int     `json:"height,omitempty"`
	Rotation int     `json:"rotation_degrees,omitempty"`
	Codec    string  `json:"codec,omitempty"`
	Duration float64 `json:"duration_seconds,omitempty"`
	Samples  uint64  `json:"samples,omitempty"`
}

type mp4Info struct {
	Duration                 float64
	CapturedAt               *time.Time
	LivePhotoAssetIdentifier string
	Tracks                   []mp4Track
}

type mp4Box struct {
	Start  int64
	Size   int64
	Header int64
	Type   string
}

func extractVideo(r io.ReadSeeker, size int64, out *Result) error {
	info, err := parseMP4(r)
	if err != nil {
		// Non-ISO containers still participate in Gallery by type. The built-in
		// parser leaves codec-specific fields empty instead of requiring ffprobe.
		return nil
	}
	out.DurationMS = int64(info.Duration*1000 + 0.5)
	if info.Duration > 0 && size > 0 {
		out.BitRate = int64(float64(size*8) / info.Duration)
	}
	if info.CapturedAt != nil {
		out.CapturedAt = info.CapturedAt
	}
	out.LivePhotoAssetIdentifier = info.LivePhotoAssetIdentifier
	for _, track := range info.Tracks {
		switch track.Handler {
		case "vide":
			if out.Width == 0 {
				out.Width = track.Width
				out.Height = track.Height
				out.RotationDegrees = track.Rotation
				out.VideoCodec = track.Codec
				if track.Duration > 0 && track.Samples > 0 {
					out.FrameRate = float64(track.Samples) / track.Duration
				}
			}
		case "soun":
			if out.AudioCodec == "" {
				out.AudioCodec = track.Codec
			}
		}
	}
	if encoded, err := json.Marshal(map[string]any{
		"duration_ms":      out.DurationMS,
		"frame_rate":       out.FrameRate,
		"bit_rate":         out.BitRate,
		"rotation_degrees": out.RotationDegrees,
		"video_codec":      out.VideoCodec,
		"audio_codec":      out.AudioCodec,
		"tracks":           info.Tracks,
	}); err == nil {
		out.VideoJSON = string(encoded)
	}
	return nil
}

func readBoxHeader(r io.ReadSeeker, position, end int64) (mp4Box, error) {
	if position+8 > end {
		return mp4Box{}, io.EOF
	}
	if _, err := r.Seek(position, io.SeekStart); err != nil {
		return mp4Box{}, err
	}
	var header [16]byte
	if _, err := io.ReadFull(r, header[:8]); err != nil {
		return mp4Box{}, err
	}

	size := int64(binary.BigEndian.Uint32(header[:4]))
	headerSize := int64(8)
	boxType := string(header[4:8])
	if size == 1 {
		if _, err := io.ReadFull(r, header[8:16]); err != nil {
			return mp4Box{}, err
		}
		largeSize := binary.BigEndian.Uint64(header[8:16])
		if largeSize > uint64(1<<63-1) {
			return mp4Box{}, errors.New("mp4 box exceeds supported size")
		}
		size = int64(largeSize)
		headerSize = 16
	} else if size == 0 {
		size = end - position
	}
	if size < headerSize || position+size > end {
		return mp4Box{}, errors.New("invalid mp4 box size")
	}
	return mp4Box{
		Start:  position,
		Size:   size,
		Header: headerSize,
		Type:   boxType,
	}, nil
}

func parseMP4(r io.ReadSeeker) (mp4Info, error) {
	var out mp4Info
	end, err := r.Seek(0, io.SeekEnd)
	if err != nil {
		return out, err
	}
	if end < 8 {
		return out, errors.New("short media")
	}
	for position := int64(0); position+8 <= end; {
		box, err := readBoxHeader(r, position, end)
		if err != nil {
			return out, err
		}
		if box.Type == "moov" {
			if err := parseMoov(r, box, &out); err != nil {
				return out, err
			}
			if out.Duration > 0 || len(out.Tracks) > 0 || out.LivePhotoAssetIdentifier != "" {
				return out, nil
			}
		}
		position += box.Size
	}
	return out, errors.New("mp4 moov not found")
}

func parseMoov(r io.ReadSeeker, moov mp4Box, out *mp4Info) error {
	start := moov.Start + moov.Header
	end := moov.Start + moov.Size
	for position := start; position+8 <= end; {
		box, err := readBoxHeader(r, position, end)
		if err != nil {
			return err
		}
		switch box.Type {
		case "mvhd":
			duration, created, _ := parseMVHD(r, box)
			if duration > 0 {
				out.Duration = duration
			}
			if !created.IsZero() {
				value := created.UTC()
				out.CapturedAt = &value
			}
		case "trak":
			track, _ := parseTrak(r, box)
			if track.Handler != "" {
				out.Tracks = append(out.Tracks, track)
			}
		case "meta":
			if out.LivePhotoAssetIdentifier == "" {
				out.LivePhotoAssetIdentifier = quickTimeContentIdentifier(r, box)
			}
		case "udta":
			if out.LivePhotoAssetIdentifier == "" {
				out.LivePhotoAssetIdentifier = quickTimeContentIdentifierInContainer(r, box)
			}
		}
		position += box.Size
	}
	return nil
}

func boxPayload(r io.ReadSeeker, box mp4Box, max int64) ([]byte, error) {
	length := box.Size - box.Header
	if length < 0 || length > max {
		return nil, errors.New("mp4 box too large")
	}
	if _, err := r.Seek(box.Start+box.Header, io.SeekStart); err != nil {
		return nil, err
	}
	data := make([]byte, length)
	if _, err := io.ReadFull(r, data); err != nil {
		return nil, err
	}
	return data, nil
}

func parseMVHD(r io.ReadSeeker, box mp4Box) (float64, time.Time, error) {
	data, err := boxPayload(r, box, 256)
	if err != nil {
		return 0, time.Time{}, err
	}
	if len(data) < 20 {
		return 0, time.Time{}, errors.New("short mvhd")
	}

	var created uint64
	var timescale uint32
	var duration uint64
	if data[0] == 1 {
		if len(data) < 32 {
			return 0, time.Time{}, errors.New("short mvhd v1")
		}
		created = binary.BigEndian.Uint64(data[4:12])
		timescale = binary.BigEndian.Uint32(data[20:24])
		duration = binary.BigEndian.Uint64(data[24:32])
	} else {
		created = uint64(binary.BigEndian.Uint32(data[4:8]))
		timescale = binary.BigEndian.Uint32(data[12:16])
		duration = uint64(binary.BigEndian.Uint32(data[16:20]))
	}

	var seconds float64
	if timescale > 0 {
		seconds = float64(duration) / float64(timescale)
	}
	return seconds, mp4EpochTime(created), nil
}

func mp4EpochTime(seconds uint64) time.Time {
	const epochDelta = 2_082_844_800
	if seconds <= epochDelta {
		return time.Time{}
	}
	value := time.Unix(int64(seconds-epochDelta), 0).UTC()
	if value.Year() < 1970 || value.Year() > 2200 {
		return time.Time{}
	}
	return value
}

func parseTrak(r io.ReadSeeker, trak mp4Box) (mp4Track, error) {
	var out mp4Track
	start := trak.Start + trak.Header
	end := trak.Start + trak.Size
	for position := start; position+8 <= end; {
		box, err := readBoxHeader(r, position, end)
		if err != nil {
			return out, err
		}
		switch box.Type {
		case "tkhd":
			out.Width, out.Height, out.Rotation = parseTKHD(r, box)
		case "mdia":
			parseMdia(r, box, &out)
		}
		position += box.Size
	}
	return out, nil
}

func parseTKHD(r io.ReadSeeker, box mp4Box) (int, int, int) {
	data, err := boxPayload(r, box, 512)
	if err != nil || len(data) < 84 {
		return 0, 0, 0
	}
	dimensionOffset := 76
	if data[0] == 1 {
		dimensionOffset = 88
	}
	if dimensionOffset+8 > len(data) {
		return 0, 0, 0
	}
	width := int(binary.BigEndian.Uint32(data[dimensionOffset:dimensionOffset+4]) >> 16)
	height := int(binary.BigEndian.Uint32(data[dimensionOffset+4:dimensionOffset+8]) >> 16)

	matrixOffset := dimensionOffset - 36
	rotation := 0
	if matrixOffset >= 0 && matrixOffset+20 <= len(data) {
		a := int32(binary.BigEndian.Uint32(data[matrixOffset : matrixOffset+4]))
		b := int32(binary.BigEndian.Uint32(data[matrixOffset+4 : matrixOffset+8]))
		c := int32(binary.BigEndian.Uint32(data[matrixOffset+12 : matrixOffset+16]))
		d := int32(binary.BigEndian.Uint32(data[matrixOffset+16 : matrixOffset+20]))
		one := int32(1 << 16)
		switch {
		case a == 0 && b == one && c == -one && d == 0:
			rotation = 90
		case a == -one && b == 0 && c == 0 && d == -one:
			rotation = 180
		case a == 0 && b == -one && c == one && d == 0:
			rotation = 270
		}
	}
	return width, height, rotation
}

func parseMdia(r io.ReadSeeker, mdia mp4Box, out *mp4Track) {
	start := mdia.Start + mdia.Header
	end := mdia.Start + mdia.Size
	for position := start; position+8 <= end; {
		box, err := readBoxHeader(r, position, end)
		if err != nil {
			return
		}
		switch box.Type {
		case "hdlr":
			if data, err := boxPayload(r, box, 128); err == nil && len(data) >= 12 {
				out.Handler = string(data[8:12])
			}
		case "mdhd":
			out.Duration = parseMDHD(r, box)
		case "minf":
			parseMinf(r, box, out)
		}
		position += box.Size
	}
}

func parseMDHD(r io.ReadSeeker, box mp4Box) float64 {
	data, err := boxPayload(r, box, 256)
	if err != nil || len(data) < 20 {
		return 0
	}
	var timescale uint32
	var duration uint64
	if data[0] == 1 {
		if len(data) < 32 {
			return 0
		}
		timescale = binary.BigEndian.Uint32(data[20:24])
		duration = binary.BigEndian.Uint64(data[24:32])
	} else {
		timescale = binary.BigEndian.Uint32(data[12:16])
		duration = uint64(binary.BigEndian.Uint32(data[16:20]))
	}
	if timescale == 0 {
		return 0
	}
	return float64(duration) / float64(timescale)
}

func parseMinf(r io.ReadSeeker, minf mp4Box, out *mp4Track) {
	start := minf.Start + minf.Header
	end := minf.Start + minf.Size
	for position := start; position+8 <= end; {
		box, err := readBoxHeader(r, position, end)
		if err != nil {
			return
		}
		if box.Type == "stbl" {
			parseStbl(r, box, out)
		}
		position += box.Size
	}
}

func parseStbl(r io.ReadSeeker, stbl mp4Box, out *mp4Track) {
	start := stbl.Start + stbl.Header
	end := stbl.Start + stbl.Size
	for position := start; position+8 <= end; {
		box, err := readBoxHeader(r, position, end)
		if err != nil {
			return
		}
		switch box.Type {
		case "stsd":
			if data, err := boxPayload(r, box, 1<<20); err == nil && len(data) >= 16 {
				out.Codec = string(data[12:16])
			}
		case "stts":
			if data, err := boxPayload(r, box, 4<<20); err == nil && len(data) >= 8 {
				entryCount := int(binary.BigEndian.Uint32(data[4:8]))
				offset := 8
				var samples uint64
				for index := 0; index < entryCount && offset+8 <= len(data); index++ {
					samples += uint64(binary.BigEndian.Uint32(data[offset : offset+4]))
					offset += 8
				}
				out.Samples = samples
			}
		}
		position += box.Size
	}
}
