package media

import (
	"bytes"
	"encoding/binary"
	"errors"
	"image"
	"io"
)

const (
	maxTIFFPreviewBytes = 64 << 20
	maxTIFFPreviewIFDs  = 64
)

type tiffPreviewCandidate struct {
	offset int64
	length int64
	width  uint64
	height uint64
}

type seekTIFF struct {
	r     io.ReadSeeker
	order binary.ByteOrder
	size  int64
}

func DNGEmbeddedJPEGPreview(r io.ReadSeeker) ([]byte, error) {
	return TIFFEmbeddedJPEGPreview(r)
}

// TIFFEmbeddedJPEGPreview extracts a bounded, explicitly reduced-resolution
// JPEG preview from a TIFF-based RAW container. It intentionally ignores
// vendor-private MakerNote offsets and never treats the full RAW strip as a
// display preview.
func TIFFEmbeddedJPEGPreview(r io.ReadSeeker) ([]byte, error) {
	if r == nil {
		return nil, errors.New("tiff preview reader is nil")
	}
	tiff, root, err := openSeekTIFF(r)
	if err != nil {
		return nil, err
	}

	queue := []uint32{root}
	seen := map[uint32]struct{}{}
	var best tiffPreviewCandidate
	for len(queue) != 0 && len(seen) < maxTIFFPreviewIFDs {
		offset := queue[0]
		queue = queue[1:]
		if offset == 0 {
			continue
		}
		if _, ok := seen[offset]; ok {
			continue
		}
		seen[offset] = struct{}{}

		candidate, subIFDs, next, err := tiff.previewIFD(offset)
		if err != nil {
			continue
		}
		if candidate.length > 0 &&
			(candidate.width*candidate.height > best.width*best.height ||
				best.length == 0 && candidate.length > best.length) {
			best = candidate
		}
		queue = append(queue, subIFDs...)
		if next != 0 {
			queue = append(queue, next)
		}
	}
	if best.length <= 0 {
		return nil, errors.New("tiff embedded jpeg preview not found")
	}
	if best.length > maxTIFFPreviewBytes {
		return nil, errors.New("tiff embedded jpeg preview exceeds safety limit")
	}
	if best.offset < 0 || best.offset+best.length > tiff.size {
		return nil, errors.New("tiff embedded jpeg preview is out of bounds")
	}

	if _, err := r.Seek(best.offset, io.SeekStart); err != nil {
		return nil, err
	}
	out := make([]byte, best.length)
	if _, err := io.ReadFull(r, out); err != nil {
		return nil, err
	}
	if len(out) < 4 || out[0] != 0xff || out[1] != 0xd8 {
		return nil, errors.New("tiff embedded preview is not jpeg")
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(out))
	if err != nil || format != "jpeg" {
		return nil, errors.New("tiff embedded preview is not decodable jpeg")
	}
	if cfg.Width <= 0 || cfg.Height <= 0 ||
		int64(cfg.Width)*int64(cfg.Height) > MaxThumbnailPixels {
		return nil, errors.New("tiff embedded preview dimensions exceed safety limit")
	}
	return out, nil
}

func openSeekTIFF(r io.ReadSeeker) (seekTIFF, uint32, error) {
	var out seekTIFF
	end, err := r.Seek(0, io.SeekEnd)
	if err != nil {
		return out, 0, err
	}
	if end < 8 {
		return out, 0, errors.New("short tiff")
	}
	if _, err := r.Seek(0, io.SeekStart); err != nil {
		return out, 0, err
	}
	var header [8]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return out, 0, err
	}
	switch string(header[:2]) {
	case "II":
		out.order = binary.LittleEndian
	case "MM":
		out.order = binary.BigEndian
	default:
		return out, 0, errors.New("invalid tiff byte order")
	}
	if out.order.Uint16(header[2:4]) != 42 {
		return out, 0, errors.New("unsupported tiff format")
	}
	out.r = r
	out.size = end
	root := out.order.Uint32(header[4:8])
	if root < 8 || int64(root) >= end {
		return out, 0, errors.New("invalid tiff root ifd")
	}
	return out, root, nil
}

func (t seekTIFF) previewIFD(offset uint32) (tiffPreviewCandidate, []uint32, uint32, error) {
	var out tiffPreviewCandidate
	if int64(offset)+2 > t.size {
		return out, nil, 0, errors.New("tiff ifd out of bounds")
	}
	if _, err := t.r.Seek(int64(offset), io.SeekStart); err != nil {
		return out, nil, 0, err
	}
	var countBytes [2]byte
	if _, err := io.ReadFull(t.r, countBytes[:]); err != nil {
		return out, nil, 0, err
	}
	count := int(t.order.Uint16(countBytes[:]))
	if count < 0 || count > 4096 {
		return out, nil, 0, errors.New("invalid tiff ifd entry count")
	}
	if int64(offset)+2+int64(count)*12+4 > t.size {
		return out, nil, 0, errors.New("tiff ifd exceeds file")
	}

	var (
		newSubfileType uint64
		compression    uint64
		jpegOffset     uint64
		jpegLength     uint64
		stripOffsets   []uint64
		stripCounts    []uint64
		subIFDs        []uint32
	)
	for index := 0; index < count; index++ {
		var entry [12]byte
		if _, err := io.ReadFull(t.r, entry[:]); err != nil {
			return out, nil, 0, err
		}
		tag := t.order.Uint16(entry[0:2])
		typ := t.order.Uint16(entry[2:4])
		n := t.order.Uint32(entry[4:8])
		values, ok := t.entryUnsignedValues(typ, n, entry[8:12])
		if !ok {
			continue
		}
		switch tag {
		case 0x00fe:
			if len(values) != 0 {
				newSubfileType = values[0]
			}
		case 0x0100:
			if len(values) != 0 {
				out.width = values[0]
			}
		case 0x0101:
			if len(values) != 0 {
				out.height = values[0]
			}
		case 0x0103:
			if len(values) != 0 {
				compression = values[0]
			}
		case 0x0111:
			stripOffsets = values
		case 0x0117:
			stripCounts = values
		case 0x014a:
			for _, value := range values {
				if value > 0 && value <= uint64(^uint32(0)) {
					subIFDs = append(subIFDs, uint32(value))
				}
			}
		case 0x0201:
			if len(values) != 0 {
				jpegOffset = values[0]
			}
		case 0x0202:
			if len(values) != 0 {
				jpegLength = values[0]
			}
		}
	}

	var nextBytes [4]byte
	if _, err := io.ReadFull(t.r, nextBytes[:]); err != nil {
		return out, nil, 0, err
	}
	next := t.order.Uint32(nextBytes[:])

	// TIFF-based RAW previews must be explicitly marked reduced-resolution. This avoids
	// mistaking compressed RAW image data for a display preview.
	if newSubfileType&1 == 0 {
		return tiffPreviewCandidate{}, subIFDs, next, nil
	}
	if jpegOffset > 0 && jpegLength > 0 {
		out.offset = int64(jpegOffset)
		out.length = int64(jpegLength)
		return out, subIFDs, next, nil
	}
	if (compression == 6 || compression == 7) &&
		len(stripOffsets) == 1 && len(stripCounts) == 1 &&
		stripOffsets[0] > 0 && stripCounts[0] > 0 {
		out.offset = int64(stripOffsets[0])
		out.length = int64(stripCounts[0])
		return out, subIFDs, next, nil
	}
	return tiffPreviewCandidate{}, subIFDs, next, nil
}

func (t seekTIFF) entryUnsignedValues(
	typ uint16,
	count uint32,
	inline []byte,
) ([]uint64, bool) {
	if count == 0 || count > 4096 {
		return nil, false
	}
	unit := 0
	switch typ {
	case 1:
		unit = 1
	case 3:
		unit = 2
	case 4:
		unit = 4
	default:
		return nil, false
	}
	total64 := uint64(unit) * uint64(count)
	if total64 > maxTIFFPreviewBytes {
		return nil, false
	}
	total := int(total64)
	var data []byte
	if total <= 4 {
		data = inline[:total]
	} else {
		offset := int64(t.order.Uint32(inline))
		if offset < 0 || offset+int64(total) > t.size {
			return nil, false
		}
		current, err := t.r.Seek(0, io.SeekCurrent)
		if err != nil {
			return nil, false
		}
		if _, err := t.r.Seek(offset, io.SeekStart); err != nil {
			return nil, false
		}
		data = make([]byte, total)
		if _, err := io.ReadFull(t.r, data); err != nil {
			return nil, false
		}
		if _, err := t.r.Seek(current, io.SeekStart); err != nil {
			return nil, false
		}
	}

	out := make([]uint64, 0, count)
	for index := 0; index < int(count); index++ {
		base := index * unit
		switch typ {
		case 1:
			out = append(out, uint64(data[base]))
		case 3:
			out = append(out, uint64(t.order.Uint16(data[base:base+2])))
		case 4:
			out = append(out, uint64(t.order.Uint32(data[base:base+4])))
		}
	}
	return out, true
}
