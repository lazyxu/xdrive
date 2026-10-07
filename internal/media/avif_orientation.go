package media

import (
	"encoding/binary"
	"io"
)

const maxAVIFMetadataBoxBytes = int64(16 << 20)

type avifItemProperty struct {
	kind string
	data []byte
}

func avifContainerOrientation(r io.ReadSeeker) int {
	if r == nil {
		return 1
	}
	end, err := r.Seek(0, io.SeekEnd)
	if err != nil || end < 8 {
		return 1
	}
	for position := int64(0); position+8 <= end; {
		box, err := readBoxHeader(r, position, end)
		if err != nil {
			return 1
		}
		if box.Type == "meta" {
			payloadSize := box.Size - box.Header
			if payloadSize < 4 || payloadSize > maxAVIFMetadataBoxBytes {
				return 1
			}
			if _, err := r.Seek(box.Start+box.Header, io.SeekStart); err != nil {
				return 1
			}
			payload := make([]byte, int(payloadSize))
			if _, err := io.ReadFull(r, payload); err != nil {
				return 1
			}
			return avifMetaOrientation(payload[4:])
		}
		if box.Size <= 0 {
			return 1
		}
		position += box.Size
	}
	return 1
}

func avifMetaOrientation(meta []byte) int {
	primary := avifPrimaryItem(meta)
	ipco, ipma := avifPropertyBoxes(meta)
	if len(ipco) == 0 {
		return 1
	}
	properties := avifProperties(ipco)
	indices := avifPropertyIndices(ipma, primary)
	if len(indices) == 0 {
		indices = make([]int, len(properties))
		for index := range properties {
			indices[index] = index + 1
		}
	}

	var (
		haveRotation bool
		haveMirror   bool
		angle        int
		axis         int
	)
	for _, index := range indices {
		if index < 1 || index > len(properties) {
			continue
		}
		property := properties[index-1]
		switch property.kind {
		case "irot":
			if len(property.data) > 0 {
				angle = int(property.data[0] & 0x3)
				haveRotation = true
			}
		case "imir":
			if len(property.data) > 0 {
				axis = int(property.data[0] & 0x1)
				haveMirror = true
			}
		}
	}
	return avifTransformOrientation(haveRotation, angle, haveMirror, axis)
}

func avifTransformOrientation(
	haveRotation bool,
	angle int,
	haveMirror bool,
	axis int,
) int {
	switch {
	case haveRotation && angle == 1 && haveMirror && axis != 0:
		return 7
	case haveRotation && angle == 1 && haveMirror:
		return 5
	case haveRotation && angle == 1:
		return 8
	case haveRotation && angle == 2 && haveMirror && axis != 0:
		return 4
	case haveRotation && angle == 2 && haveMirror:
		return 2
	case haveRotation && angle == 2:
		return 3
	case haveRotation && angle == 3 && haveMirror && axis != 0:
		return 5
	case haveRotation && angle == 3 && haveMirror:
		return 7
	case haveRotation && angle == 3:
		return 6
	case haveMirror && axis != 0:
		return 2
	case haveMirror:
		return 4
	default:
		return 1
	}
}

func avifEachBox(data []byte, visit func(kind string, payload []byte) bool) {
	for offset := 0; offset+8 <= len(data); {
		size64 := uint64(binary.BigEndian.Uint32(data[offset : offset+4]))
		kind := string(data[offset+4 : offset+8])
		headerSize := 8
		if size64 == 1 {
			if offset+16 > len(data) {
				return
			}
			size64 = binary.BigEndian.Uint64(data[offset+8 : offset+16])
			headerSize = 16
		} else if size64 == 0 {
			size64 = uint64(len(data) - offset)
		}
		if size64 < uint64(headerSize) ||
			size64 > uint64(len(data)-offset) {
			return
		}
		size := int(size64)
		if !visit(kind, data[offset+headerSize:offset+size]) {
			return
		}
		offset += size
	}
}

func avifPrimaryItem(meta []byte) int {
	primary := -1
	avifEachBox(meta, func(kind string, payload []byte) bool {
		if kind != "pitm" {
			return true
		}
		if len(payload) < 6 {
			return false
		}
		if payload[0] == 0 {
			primary = int(binary.BigEndian.Uint16(payload[4:6]))
		} else if len(payload) >= 8 {
			primary = int(binary.BigEndian.Uint32(payload[4:8]))
		}
		return false
	})
	return primary
}

func avifPropertyBoxes(meta []byte) (ipco, ipma []byte) {
	avifEachBox(meta, func(kind string, payload []byte) bool {
		if kind != "iprp" {
			return true
		}
		avifEachBox(payload, func(childKind string, childPayload []byte) bool {
			switch childKind {
			case "ipco":
				ipco = childPayload
			case "ipma":
				ipma = childPayload
			}
			return true
		})
		return false
	})
	return ipco, ipma
}

func avifProperties(ipco []byte) []avifItemProperty {
	properties := []avifItemProperty{}
	avifEachBox(ipco, func(kind string, payload []byte) bool {
		properties = append(properties, avifItemProperty{
			kind: kind,
			data: payload,
		})
		return true
	})
	return properties
}

func avifPropertyIndices(ipma []byte, itemID int) []int {
	if len(ipma) < 8 || itemID < 0 {
		return nil
	}
	version := ipma[0]
	wide := ipma[3]&1 != 0
	offset := 4
	entryCount := int(binary.BigEndian.Uint32(ipma[offset : offset+4]))
	offset += 4

	for entry := 0; entry < entryCount; entry++ {
		var id int
		if version < 1 {
			if offset+2 > len(ipma) {
				return nil
			}
			id = int(binary.BigEndian.Uint16(ipma[offset : offset+2]))
			offset += 2
		} else {
			if offset+4 > len(ipma) {
				return nil
			}
			id = int(binary.BigEndian.Uint32(ipma[offset : offset+4]))
			offset += 4
		}
		if offset >= len(ipma) {
			return nil
		}
		associationCount := int(ipma[offset])
		offset++

		indices := make([]int, 0, associationCount)
		for association := 0; association < associationCount; association++ {
			var index int
			if wide {
				if offset+2 > len(ipma) {
					return nil
				}
				index = int(binary.BigEndian.Uint16(ipma[offset:offset+2]) & 0x7fff)
				offset += 2
			} else {
				if offset >= len(ipma) {
					return nil
				}
				index = int(ipma[offset] & 0x7f)
				offset++
			}
			if index != 0 {
				indices = append(indices, index)
			}
		}
		if id == itemID {
			return indices
		}
	}
	return nil
}
