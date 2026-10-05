package media

import (
	"bytes"
	"encoding/binary"
	"errors"
	"image"
	"io"
	"strings"
)

const (
	maxCR3ScanBytes    = 32 << 20
	maxCR3PreviewBytes = 64 << 20
)

type cr3Atom struct {
	start        int
	payloadStart int
	end          int
}

func isCR3(header []byte) bool {
	return len(header) >= 12 &&
		string(header[4:8]) == "ftyp" &&
		string(header[8:12]) == "crx "
}

func cr3Dimensions(r io.ReadSeeker) (int, int, bool) {
	data, err := readCR3Prefix(r)
	if err != nil || !isCR3(data) {
		return 0, 0, false
	}
	bestWidth, bestHeight := 0, 0
	for _, atom := range findCR3Atoms(data, "CRAW") {
		payload := data[atom.payloadStart:atom.end]
		if len(payload) < 28 {
			continue
		}
		width := int(binary.BigEndian.Uint16(payload[24:26]))
		height := int(binary.BigEndian.Uint16(payload[26:28]))
		if width <= 0 || height <= 0 || width > 100000 || height > 100000 {
			continue
		}
		if int64(width)*int64(height) > int64(bestWidth)*int64(bestHeight) {
			bestWidth, bestHeight = width, height
		}
	}
	if bestWidth == 0 || bestHeight == 0 {
		return 0, 0, false
	}
	return bestWidth, bestHeight, true
}

func CR3EmbeddedJPEGPreview(r io.ReadSeeker) ([]byte, error) {
	data, err := readCR3Prefix(r)
	if err != nil {
		return nil, err
	}
	if !isCR3(data) {
		return nil, errors.New("not a Canon CR3 file")
	}
	for _, atom := range findCR3Atoms(data, "PRVW") {
		payload := data[atom.payloadStart:atom.end]
		if len(payload) < 16 {
			continue
		}
		width := int(binary.BigEndian.Uint16(payload[6:8]))
		height := int(binary.BigEndian.Uint16(payload[8:10]))
		jpegSize := int64(binary.BigEndian.Uint32(payload[12:16]))
		if width <= 0 || height <= 0 || jpegSize <= 0 || jpegSize > maxCR3PreviewBytes {
			continue
		}
		if jpegSize > int64(len(payload)-16) {
			continue
		}
		preview := append([]byte(nil), payload[16:16+int(jpegSize)]...)
		if len(preview) < 4 || preview[0] != 0xff || preview[1] != 0xd8 {
			continue
		}
		cfg, format, decodeErr := image.DecodeConfig(bytes.NewReader(preview))
		if decodeErr != nil || format != "jpeg" || cfg.Width <= 0 || cfg.Height <= 0 {
			continue
		}
		if int64(cfg.Width)*int64(cfg.Height) > MaxThumbnailPixels {
			continue
		}
		if cfg.Width != width || cfg.Height != height {
			continue
		}
		return preview, nil
	}
	return nil, errors.New("CR3 embedded JPEG preview not found")
}

func readCR3EXIF(r io.ReadSeeker) (*exifData, error) {
	data, err := readCR3Prefix(r)
	if err != nil {
		return nil, err
	}
	if !isCR3(data) {
		return nil, errors.New("not a Canon CR3 file")
	}
	out := &exifData{
		Orientation: 1,
		Fields:      map[string]any{},
	}
	for _, atom := range findCR3Atoms(data, "CMT1") {
		parseCR3RootIFD(data[atom.payloadStart:atom.end], out)
		break
	}
	for _, atom := range findCR3Atoms(data, "CMT2") {
		parseCR3ExifIFD(data[atom.payloadStart:atom.end], out)
		break
	}
	for _, atom := range findCR3Atoms(data, "CMT4") {
		parseCR3GPSIFD(data[atom.payloadStart:atom.end], out)
		break
	}
	if len(out.Fields) == 0 &&
		out.CameraMake == "" &&
		out.CameraModel == "" &&
		out.CapturedAt == nil &&
		out.Latitude == nil &&
		out.Longitude == nil {
		return nil, nil
	}
	return out, nil
}

func readCR3Prefix(r io.ReadSeeker) ([]byte, error) {
	if r == nil {
		return nil, errors.New("CR3 reader is nil")
	}
	end, err := r.Seek(0, io.SeekEnd)
	if err != nil {
		return nil, err
	}
	limit := end
	if limit > maxCR3ScanBytes {
		limit = maxCR3ScanBytes
	}
	if limit < 12 {
		return nil, errors.New("short CR3 file")
	}
	if _, err := r.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	data := make([]byte, int(limit))
	if _, err := io.ReadFull(r, data); err != nil {
		return nil, err
	}
	return data, nil
}

func findCR3Atoms(data []byte, atomType string) []cr3Atom {
	if len(atomType) != 4 || len(data) < 8 {
		return nil
	}
	var out []cr3Atom
	target := []byte(atomType)
	for typeStart := 4; typeStart+4 <= len(data); typeStart++ {
		if !bytes.Equal(data[typeStart:typeStart+4], target) {
			continue
		}
		start := typeStart - 4
		size32 := binary.BigEndian.Uint32(data[start:typeStart])
		headerSize := 8
		var size uint64
		switch size32 {
		case 0:
			size = uint64(len(data) - start)
		case 1:
			if start+16 > len(data) {
				continue
			}
			size = binary.BigEndian.Uint64(data[start+8 : start+16])
			headerSize = 16
		default:
			size = uint64(size32)
		}
		if size < uint64(headerSize) || size > uint64(len(data)-start) {
			continue
		}
		end := start + int(size)
		payloadStart := start + headerSize
		if payloadStart > end {
			continue
		}
		out = append(out, cr3Atom{start: start, payloadStart: payloadStart, end: end})
		typeStart = end - 1
	}
	return out
}

func parseCR3RootIFD(payload []byte, out *exifData) {
	reader := tiffReader{data: payload, order: binary.LittleEndian}
	_, _, _ = reader.parseIFD(0, func(tag, typ uint16, count uint32, value []byte) {
		switch tag {
		case 0x0100:
			if width := int(reader.firstUint(typ, count, value)); width > 0 {
				out.PixelWidth = width
			}
		case 0x0101:
			if height := int(reader.firstUint(typ, count, value)); height > 0 {
				out.PixelHeight = height
			}
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
		case 0x02bc:
			out.Relation.merge(parseXMPRelationEvidence(value))
		}
	})
}

func parseCR3ExifIFD(payload []byte, out *exifData) {
	reader := tiffReader{data: payload, order: binary.LittleEndian}
	var capturedRaw string
	_, _, _ = reader.parseIFD(0, func(tag, typ uint16, count uint32, value []byte) {
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
		case 0xa420:
			if imageID := normalizeRelationIdentifier(cleanASCII(value)); imageID != "" {
				out.Relation.ImageUniqueID = imageID
				out.Fields["image_unique_id"] = imageID
			}
		case 0xa434:
			out.LensModel = cleanASCII(value)
			if out.LensModel != "" {
				out.Fields["lens_model"] = out.LensModel
			}
		}
	})
	if capturedRaw != "" {
		if captured, ok := parseExifTime(capturedRaw); ok {
			out.CapturedAt = &captured
		}
	}
}

func parseCR3GPSIFD(payload []byte, out *exifData) {
	reader := tiffReader{data: payload, order: binary.LittleEndian}
	var latitudeRef, longitudeRef string
	var latitude, longitude []float64
	var altitude *float64
	var altitudeRef uint64
	_, _, _ = reader.parseIFD(0, func(tag, typ uint16, count uint32, value []byte) {
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
	})
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
