package media

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"hash/crc32"
	"testing"
)

func TestIOSLiveOriginalsExactMembers(t *testing.T) {
	still := buildJPEGWithAppleIdentifier("PAIR-ONE")
	motion := buildMovieWithQuickTimeIdentifier("PAIR-ONE")
	manifest := iosLiveManifest{Format: "xdrive-live-originals", Version: 1}
	data := []struct {
		path, role string
		value      []byte
	}{
		{"media/still.jpg", "still", still}, {"media/motion.mov", "motion", motion},
	}
	var parts []map[string]any
	for _, entry := range data {
		parts = append(parts, map[string]any{"path": entry.path, "role": entry.role,
			"bytes": len(entry.value), "crc32": fmt.Sprintf("%08x", crc32.ChecksumIEEE(entry.value)), "originalFilename": "original"})
	}
	encoded, _ := json.Marshal(map[string]any{"format": manifest.Format, "version": manifest.Version, "resources": parts})
	entries := []livpTestEntry{{Name: data[0].path, Data: still}, {Name: data[1].path, Data: motion}, {Name: "manifest.json", Data: encoded}}
	archive := buildStoredLIVP(t, entries, "")
	name := "Live-xios-0123456789abcdef01234567-0123456789ab.zip"
	result, err := Extract(name, bytes.NewReader(archive), int64(len(archive)))
	if err != nil || result.ContainerKind != ContainerKindLIVP || result.Kind != KindImage {
		t.Fatalf("projection: %+v %v", result, err)
	}
	descriptor, err := ParseLIVPContainerDescriptor(result.ContainerJSON)
	if err != nil {
		t.Fatal(err)
	}
	for i, part := range []LIVPContainerResourceDescriptor{descriptor.Still, descriptor.Motion} {
		want := fmt.Sprintf("%x", sha256.Sum256(data[i].value))
		if part.SHA256 != want || !bytes.Equal(archive[part.Offset:part.Offset+part.Size], data[i].value) {
			t.Fatal("member identity/range differs from original bytes")
		}
		if LiveContainerMemberSHA256(result.ContainerJSON, data[i].role, part.Offset, part.Size) != want {
			t.Fatal("canonical projection lost exact hash")
		}
		if LiveContainerMemberSHA256(result.ContainerJSON, data[i].role, part.Offset+1, part.Size) != "" {
			t.Fatal("changed range reused member hash")
		}
	}
	if descriptor.Still.SHA256 == fmt.Sprintf("%x", sha256.Sum256(archive)) {
		t.Fatal("container hash confused with member")
	}
	for _, scenario := range []string{"manifest", "role", "path", "crc", "duplicate", "mismatch", "corrupt"} {
		t.Run(scenario, func(t *testing.T) {
			copyEntries := append([]livpTestEntry(nil), entries...)
			switch scenario {
			case "manifest":
				copyEntries[2].Data = []byte(`{"format":"other","version":1}`)
			case "role":
				copyEntries[2].Data = bytes.Replace(encoded, []byte(`"role":"motion"`), []byte(`"role":"still"`), 1)
			case "path":
				copyEntries[0].Name = "../still.jpg"
			case "crc":
				copyEntries[2].Data = bytes.Replace(encoded, []byte(fmt.Sprintf("%08x", crc32.ChecksumIEEE(still))), []byte("00000000"), 1)
			case "duplicate":
				copyEntries[1].Name = copyEntries[0].Name
			case "mismatch":
				copyEntries[1].Data = buildMovieWithQuickTimeIdentifier("PAIR-TWO")
			}
			bad := buildStoredLIVP(t, copyEntries, "")
			if scenario == "corrupt" {
				bad[bytes.Index(bad, still)+len(still)-1] ^= 1
			}
			if _, err := inspectIOSLiveOriginals(bytes.NewReader(bad), int64(len(bad))); err == nil {
				t.Fatal("invalid archive accepted")
			}
		})
	}
}
