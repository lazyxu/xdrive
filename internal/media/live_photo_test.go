package media

import (
	"bytes"
	"encoding/binary"
	"testing"
)

func TestAppleMakerNoteContentIdentifier(t *testing.T) {
	const identifier = "D4122CE4-5DA9-4EBA-9475-01579D01ADCE"
	note := buildAppleMakerNote(identifier)
	if got := appleMakerNoteContentIdentifier(note); got != identifier {
		t.Fatalf("identifier=%q want=%q", got, identifier)
	}
	if got := appleMakerNoteContentIdentifier([]byte("not an Apple maker note")); got != "" {
		t.Fatalf("unexpected identifier=%q", got)
	}
}

func TestParseTIFFReadsAppleLivePhotoIdentifier(t *testing.T) {
	const identifier = "A7D2C6A0-94BE-4A65-8502-D11259D7DB83"
	exif, err := parseTIFF(buildTIFFWithAppleMakerNote(buildAppleMakerNote(identifier)))
	if err != nil {
		t.Fatal(err)
	}
	if exif.LivePhotoAssetIdentifier != identifier {
		t.Fatalf("identifier=%q want=%q", exif.LivePhotoAssetIdentifier, identifier)
	}
}

func TestExtractReadsQuickTimeLivePhotoIdentifier(t *testing.T) {
	const identifier = "13B2EE4A-F9A0-4093-A24C-DC1B533FFFE0"
	movie := buildMovieWithQuickTimeIdentifier(identifier)
	result, err := Extract("IMG_0001.MOV", bytes.NewReader(movie), int64(len(movie)))
	if err != nil {
		t.Fatal(err)
	}
	if result.Kind != KindVideo {
		t.Fatalf("kind=%q want=%q", result.Kind, KindVideo)
	}
	if result.LivePhotoAssetIdentifier != identifier {
		t.Fatalf("identifier=%q want=%q", result.LivePhotoAssetIdentifier, identifier)
	}
}

func TestQuickTimeContentIdentifierRejectsNonUTF8ValueType(t *testing.T) {
	meta := buildQuickTimeMeta("identifier", 13)
	reader := bytes.NewReader(meta)
	box, err := readBoxHeader(reader, 0, int64(len(meta)))
	if err != nil {
		t.Fatal(err)
	}
	if got := quickTimeContentIdentifier(reader, box); got != "" {
		t.Fatalf("unexpected identifier=%q", got)
	}
}

func buildAppleMakerNote(identifier string) []byte {
	note := append([]byte{}, []byte("Apple iOS\x00")...)
	note = append(note, 0x00, 0x01, 'M', 'M')
	dirOffset := len(note)
	note = append(note, 0x00, 0x01)

	entry := make([]byte, 12)
	binary.BigEndian.PutUint16(entry[0:2], 0x0011)
	binary.BigEndian.PutUint16(entry[2:4], 2)
	binary.BigEndian.PutUint32(entry[4:8], uint32(len(identifier)+1))
	valueOffset := dirOffset + 2 + 12 + 4
	binary.BigEndian.PutUint32(entry[8:12], uint32(valueOffset))
	note = append(note, entry...)
	note = append(note, 0, 0, 0, 0)
	note = append(note, []byte(identifier)...)
	note = append(note, 0)
	return note
}

func buildTIFFWithAppleMakerNote(note []byte) []byte {
	data := []byte{'M', 'M', 0, 42, 0, 0, 0, 8}
	root := make([]byte, 2+12+4)
	binary.BigEndian.PutUint16(root[0:2], 1)
	binary.BigEndian.PutUint16(root[2:4], 0x8769)
	binary.BigEndian.PutUint16(root[4:6], 4)
	binary.BigEndian.PutUint32(root[6:10], 1)
	exifOffset := len(data) + len(root)
	binary.BigEndian.PutUint32(root[10:14], uint32(exifOffset))
	data = append(data, root...)

	exif := make([]byte, 2+12+4)
	binary.BigEndian.PutUint16(exif[0:2], 1)
	binary.BigEndian.PutUint16(exif[2:4], 0x927c)
	binary.BigEndian.PutUint16(exif[4:6], 7)
	binary.BigEndian.PutUint32(exif[6:10], uint32(len(note)))
	noteOffset := len(data) + len(exif)
	binary.BigEndian.PutUint32(exif[10:14], uint32(noteOffset))
	data = append(data, exif...)
	data = append(data, note...)
	return data
}

func buildMovieWithQuickTimeIdentifier(identifier string) []byte {
	ftypPayload := append([]byte("qt  "), make([]byte, 8)...)
	ftyp := qtBox([]byte("ftyp"), ftypPayload)
	meta := buildQuickTimeMeta(identifier, 1)
	moov := qtBox([]byte("moov"), meta)
	return append(ftyp, moov...)
}

func buildQuickTimeMeta(identifier string, valueType uint32) []byte {
	key := []byte(quickTimeContentIdentifierKey)
	entry := make([]byte, 8+len(key))
	binary.BigEndian.PutUint32(entry[0:4], uint32(len(entry)))
	copy(entry[4:8], []byte("mdta"))
	copy(entry[8:], key)

	keysPayload := make([]byte, 8)
	binary.BigEndian.PutUint32(keysPayload[4:8], 1)
	keysPayload = append(keysPayload, entry...)
	keys := qtBox([]byte("keys"), keysPayload)

	dataPayload := make([]byte, 8)
	binary.BigEndian.PutUint32(dataPayload[0:4], valueType)
	dataPayload = append(dataPayload, []byte(identifier)...)
	data := qtBox([]byte("data"), dataPayload)
	item := qtBox([]byte{0, 0, 0, 1}, data)
	ilst := qtBox([]byte("ilst"), item)

	metaPayload := make([]byte, 4)
	metaPayload = append(metaPayload, keys...)
	metaPayload = append(metaPayload, ilst...)
	return qtBox([]byte("meta"), metaPayload)
}

func qtBox(boxType []byte, payload []byte) []byte {
	if len(boxType) != 4 {
		panic("box type must be four bytes")
	}
	out := make([]byte, 8+len(payload))
	binary.BigEndian.PutUint32(out[0:4], uint32(len(out)))
	copy(out[4:8], boxType)
	copy(out[8:], payload)
	return out
}
