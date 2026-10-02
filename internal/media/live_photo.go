package media

import (
	"bytes"
	"encoding/binary"
	"io"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	appleMakerNoteHeader          = "Apple iOS\x00"
	quickTimeContentIdentifierKey = "com.apple.quicktime.content.identifier"
	maxLivePhotoIdentifierBytes   = 128
	maxQuickTimeMetadataBytes     = 4 << 20
)

func appleMakerNoteContentIdentifier(note []byte) string {
	if len(note) < 16 || !bytes.Equal(note[:10], []byte(appleMakerNoteHeader)) {
		return ""
	}
	var order binary.ByteOrder
	switch string(note[12:14]) {
	case "MM":
		order = binary.BigEndian
	case "II":
		order = binary.LittleEndian
	default:
		return ""
	}

	const dirOffset = 14
	count := int(order.Uint16(note[dirOffset : dirOffset+2]))
	if count > 4096 || dirOffset+2+count*12 > len(note) {
		return ""
	}
	for index := 0; index < count; index++ {
		base := dirOffset + 2 + index*12
		if order.Uint16(note[base:base+2]) != 0x0011 {
			continue
		}
		typ := order.Uint16(note[base+2 : base+4])
		valueCount := order.Uint32(note[base+4 : base+8])
		value, ok := appleMakerNoteValue(note, order, typ, valueCount, note[base+8:base+12])
		if !ok {
			return ""
		}
		switch typ {
		case 1, 2, 7:
			return normalizeLivePhotoIdentifier(string(value))
		default:
			return ""
		}
	}
	return ""
}

func appleMakerNoteValue(
	note []byte,
	order binary.ByteOrder,
	typ uint16,
	count uint32,
	inline []byte,
) ([]byte, bool) {
	unit := 0
	switch typ {
	case 1, 2, 6, 7:
		unit = 1
	case 3, 8:
		unit = 2
	case 4, 9, 11:
		unit = 4
	case 5, 10, 12:
		unit = 8
	default:
		return nil, false
	}
	if count == 0 || count > 1<<20 {
		return nil, false
	}
	total64 := uint64(unit) * uint64(count)
	if total64 > uint64(len(note)) {
		return nil, false
	}
	total := int(total64)
	if total <= 4 {
		return inline[:total], true
	}
	offset := int(order.Uint32(inline))
	if offset < 0 || offset+total > len(note) {
		return nil, false
	}
	return note[offset : offset+total], true
}

func quickTimeContentIdentifier(r io.ReadSeeker, meta mp4Box) string {
	if r == nil || meta.Size < meta.Header+4 {
		return ""
	}
	start := meta.Start + meta.Header + 4
	end := meta.Start + meta.Size
	var keys map[uint32]string
	var ilst *mp4Box
	for position := start; position+8 <= end; {
		box, err := readBoxHeader(r, position, end)
		if err != nil {
			return ""
		}
		switch box.Type {
		case "keys":
			keys = quickTimeMetadataKeys(r, box)
		case "ilst":
			copy := box
			ilst = &copy
		}
		position += box.Size
	}
	if len(keys) == 0 || ilst == nil {
		return ""
	}
	return quickTimeMetadataValue(r, *ilst, keys, quickTimeContentIdentifierKey)
}

func quickTimeContentIdentifierInContainer(r io.ReadSeeker, container mp4Box) string {
	if r == nil {
		return ""
	}
	start := container.Start + container.Header
	end := container.Start + container.Size
	for position := start; position+8 <= end; {
		box, err := readBoxHeader(r, position, end)
		if err != nil {
			return ""
		}
		if box.Type == "meta" {
			if value := quickTimeContentIdentifier(r, box); value != "" {
				return value
			}
		}
		position += box.Size
	}
	return ""
}

func quickTimeMetadataKeys(r io.ReadSeeker, box mp4Box) map[uint32]string {
	data, err := boxPayload(r, box, maxQuickTimeMetadataBytes)
	if err != nil || len(data) < 8 {
		return nil
	}
	count := int(binary.BigEndian.Uint32(data[4:8]))
	if count > 65536 {
		return nil
	}
	out := make(map[uint32]string, count)
	offset := 8
	for index := 1; index <= count; index++ {
		if offset+8 > len(data) {
			return nil
		}
		size := int(binary.BigEndian.Uint32(data[offset : offset+4]))
		if size < 8 || offset+size > len(data) {
			return nil
		}
		if string(data[offset+4:offset+8]) == "mdta" {
			key := normalizeMetadataKey(string(data[offset+8 : offset+size]))
			if key != "" {
				out[uint32(index)] = key
			}
		}
		offset += size
	}
	return out
}

func quickTimeMetadataValue(
	r io.ReadSeeker,
	ilst mp4Box,
	keys map[uint32]string,
	wanted string,
) string {
	start := ilst.Start + ilst.Header
	end := ilst.Start + ilst.Size
	for position := start; position+8 <= end; {
		item, err := readBoxHeader(r, position, end)
		if err != nil {
			return ""
		}
		if len(item.Type) == 4 {
			index := binary.BigEndian.Uint32([]byte(item.Type))
			if keys[index] == wanted {
				itemStart := item.Start + item.Header
				itemEnd := item.Start + item.Size
				for childPos := itemStart; childPos+8 <= itemEnd; {
					child, err := readBoxHeader(r, childPos, itemEnd)
					if err != nil {
						return ""
					}
					if child.Type == "data" {
						payload, err := boxPayload(r, child, maxQuickTimeMetadataBytes)
						if err != nil || len(payload) < 8 {
							return ""
						}
						if binary.BigEndian.Uint32(payload[:4]) != 1 {
							return ""
						}
						return normalizeLivePhotoIdentifier(string(payload[8:]))
					}
					childPos += child.Size
				}
			}
		}
		position += item.Size
	}
	return ""
}

func normalizeMetadataKey(value string) string {
	value = strings.TrimFunc(value, func(r rune) bool {
		return r == 0 || unicode.IsSpace(r)
	})
	if value == "" || len([]byte(value)) > 512 || !utf8.ValidString(value) {
		return ""
	}
	for _, r := range value {
		if r < 32 || r == 127 {
			return ""
		}
	}
	return value
}

func normalizeLivePhotoIdentifier(value string) string {
	value = strings.TrimFunc(value, func(r rune) bool {
		return r == 0 || unicode.IsSpace(r)
	})
	if value == "" || len([]byte(value)) > maxLivePhotoIdentifierBytes || !utf8.ValidString(value) {
		return ""
	}
	for _, r := range value {
		if r < 32 || r == 127 {
			return ""
		}
	}
	return value
}
