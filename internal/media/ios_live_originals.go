package media

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"regexp"
	"strings"
)

var iosLiveOriginalName = regexp.MustCompile(`(?i)^Live-xios-[a-f0-9]{24}-[a-f0-9]{12}\.zip$`)

func IsLivePhotoContainerName(name string) bool {
	return strings.EqualFold(filepath.Ext(name), ".livp") || iosLiveOriginalName.MatchString(name)
}

type iosLiveManifest struct {
	Format    string `json:"format"`
	Version   int    `json:"version"`
	Resources []struct {
		Role             string `json:"role"`
		Path             string `json:"path"`
		OriginalFilename string `json:"originalFilename"`
		Bytes            int64  `json:"bytes"`
		CRC32            string `json:"crc32"`
	} `json:"resources"`
}

// The existing atomic iOS backup format contains exactly two stored originals
// and its explicit format manifest. No extraction, new Node or second uploader.
func inspectIOSLiveOriginals(r io.ReaderAt, size int64) (LIVPInfo, error) {
	var empty LIVPInfo
	if r == nil || size <= 0 || size > maxLIVPArchiveBytes {
		return empty, errors.New("invalid iOS Live archive size")
	}
	zr, err := zip.NewReader(r, size)
	if err != nil {
		return empty, err
	}
	if len(zr.File) != 3 {
		return empty, errors.New("iOS Live archive requires exactly three entries")
	}
	files := make(map[string]*zip.File, 3)
	for _, file := range zr.File {
		if files[file.Name] != nil {
			return empty, errors.New("duplicate iOS Live archive entry")
		}
		files[file.Name] = file
		// Only exact manifest-declared media/<role> names may contain a slash.
		flat := *file
		flat.Name = filepath.Base(file.Name)
		if err := validateLIVPEntry(&flat); err != nil {
			return empty, err
		}
	}
	manifest := files["manifest.json"]
	if manifest == nil || manifest.UncompressedSize64 > 65_535 {
		return empty, errors.New("invalid iOS Live manifest")
	}
	stream, err := manifest.Open()
	if err != nil {
		return empty, err
	}
	bytes, err := io.ReadAll(io.LimitReader(stream, 65_536))
	closeErr := stream.Close()
	if err != nil {
		return empty, err
	}
	if closeErr != nil {
		return empty, closeErr
	}
	var decoded iosLiveManifest
	if json.Unmarshal(bytes, &decoded) != nil || decoded.Format != "xdrive-live-originals" || decoded.Version != 1 || len(decoded.Resources) != 2 {
		return empty, errors.New("unsupported iOS Live manifest")
	}
	parts := make([]*zip.File, 2)
	for i, role := range []string{"still", "motion"} {
		part := decoded.Resources[i]
		file := files[part.Path]
		ext := strings.ToLower(filepath.Ext(part.Path))
		if part.Role != role || part.Path != "media/"+role+ext || file == nil || part.Bytes <= 0 ||
			uint64(part.Bytes) != file.UncompressedSize64 || part.CRC32 != fmt.Sprintf("%08x", file.CRC32) ||
			(i == 0 && classifyLIVPEntry(part.Path) != livpEntryStill) ||
			(i == 1 && classifyLIVPEntry(part.Path) != livpEntryMotion) {
			return empty, errors.New("iOS Live manifest does not bind both exact members")
		}
		flat := *file
		flat.Name = filepath.Base(part.Path)
		parts[i] = &flat
	}
	return inspectLivePair(r, size, parts[0], parts[1])
}
