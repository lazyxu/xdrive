package media

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"strings"
	"testing"
)

func TestInspectLIVPValidatesEmbeddedIdentifiers(t *testing.T) {
	const identifier = "F187F3A1-0625-4908-AE8C-A83B037E06B0"
	still := buildJPEGWithAppleIdentifier(identifier)
	motion := buildMovieWithQuickTimeIdentifier(identifier)
	archive := buildStoredLIVP(t, []livpTestEntry{
		{Name: "IMG_0001.HEIC.jpeg", Data: still},
		{Name: "IMG_0001.HEIC.mov", Data: motion},
	}, "0005000000000000000000030000000000000000313030304C495650")

	info, err := InspectLIVP(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		t.Fatal(err)
	}
	if info.AssetIdentifier != identifier {
		t.Fatalf("identifier=%q want=%q", info.AssetIdentifier, identifier)
	}
	if info.Still.Kind != KindImage || info.Motion.Kind != KindVideo {
		t.Fatalf("unexpected member kinds: still=%q motion=%q", info.Still.Kind, info.Motion.Kind)
	}
	if info.StillOffset <= 0 || info.MotionOffset <= info.StillOffset {
		t.Fatalf("unexpected offsets: still=%d motion=%d", info.StillOffset, info.MotionOffset)
	}
}

func TestInspectLIVPIgnoresProviderZipComment(t *testing.T) {
	const identifier = "62C56C15-5AB9-431A-B33E-B864F75A51C7"
	archive := buildStoredLIVP(t, []livpTestEntry{
		{Name: "still.jpg", Data: buildJPEGWithAppleIdentifier(identifier)},
		{Name: "motion.mov", Data: buildMovieWithQuickTimeIdentifier(identifier)},
	}, "not-a-provider-comment")

	if _, err := InspectLIVP(bytes.NewReader(archive), int64(len(archive))); err != nil {
		t.Fatalf("non-canonical zip comment affected local parsing: %v", err)
	}
}

func TestInspectLIVPRejectsIdentifierMismatch(t *testing.T) {
	archive := buildStoredLIVP(t, []livpTestEntry{
		{Name: "still.jpg", Data: buildJPEGWithAppleIdentifier("STILL-ID")},
		{Name: "motion.mov", Data: buildMovieWithQuickTimeIdentifier("MOTION-ID")},
	}, "")
	if _, err := InspectLIVP(bytes.NewReader(archive), int64(len(archive))); err == nil ||
		!strings.Contains(err.Error(), "do not match") {
		t.Fatalf("mismatched identifiers error=%v", err)
	}
}

func TestInspectLIVPRejectsExtraTraversalAndCompressedEntries(t *testing.T) {
	const identifier = "VALID-ID"
	tests := []struct {
		name    string
		entries []livpTestEntry
	}{
		{
			name: "extra",
			entries: []livpTestEntry{
				{Name: "still.jpg", Data: buildJPEGWithAppleIdentifier(identifier)},
				{Name: "motion.mov", Data: buildMovieWithQuickTimeIdentifier(identifier)},
				{Name: "extra.txt", Data: []byte("extra")},
			},
		},
		{
			name: "traversal",
			entries: []livpTestEntry{
				{Name: "../still.jpg", Data: buildJPEGWithAppleIdentifier(identifier)},
				{Name: "motion.mov", Data: buildMovieWithQuickTimeIdentifier(identifier)},
			},
		},
		{
			name: "deflate",
			entries: []livpTestEntry{
				{Name: "still.jpg", Data: buildJPEGWithAppleIdentifier(identifier), Method: zip.Deflate},
				{Name: "motion.mov", Data: buildMovieWithQuickTimeIdentifier(identifier)},
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			archive := buildStoredLIVP(t, test.entries, "")
			if _, err := InspectLIVP(bytes.NewReader(archive), int64(len(archive))); err == nil {
				t.Fatal("invalid livp archive was accepted")
			}
		})
	}
}

type livpTestEntry struct {
	Name   string
	Data   []byte
	Method uint16
}

func buildStoredLIVP(t *testing.T, entries []livpTestEntry, comment string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, entry := range entries {
		method := entry.Method
		if method == 0 {
			method = zip.Store
		}
		header := &zip.FileHeader{Name: entry.Name, Method: method}
		writer, err := zw.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := writer.Write(entry.Data); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.SetComment(comment); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func buildJPEGWithAppleIdentifier(identifier string) []byte {
	tiff := buildTIFFWithAppleMakerNote(buildAppleMakerNote(identifier))
	payload := append([]byte("Exif\x00\x00"), tiff...)
	out := []byte{0xff, 0xd8, 0xff, 0xe1}
	length := make([]byte, 2)
	binary.BigEndian.PutUint16(length, uint16(len(payload)+2))
	out = append(out, length...)
	out = append(out, payload...)
	out = append(out, 0xff, 0xd9)
	return out
}

func TestInspectLIVPRejectsOversizedArchive(t *testing.T) {
	if _, err := InspectLIVP(bytes.NewReader([]byte("PK")), maxLIVPArchiveBytes+1); err == nil ||
		!strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("oversized livp error=%v", err)
	}
}
