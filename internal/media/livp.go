package media

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

const (
	ContainerKindLIVP   = "livp"
	LIVPMIMEType        = "application/x-livp"
	maxLIVPArchiveBytes = int64(6 << 30) // 6 GiB including ZIP overhead
	maxLIVPImageBytes   = int64(1 << 30) // 1 GiB
	maxLIVPVideoBytes   = int64(4 << 30) // 4 GiB
)

// LIVPInfo describes a validated local Live Photo container. The ZIP entries
// remain derived resources inside the original .livp Node; this function does
// not create SourceItems or synthetic filesystem Nodes.
type LIVPInfo struct {
	AssetIdentifier string
	StillName       string
	StillOffset     int64
	StillSize       int64
	Still           Result
	MotionName      string
	MotionOffset    int64
	MotionSize      int64
	Motion          Result
}

type livpEntryKind int

const (
	livpEntryUnknown livpEntryKind = iota
	livpEntryStill
	livpEntryMotion
)

// InspectLIVP validates a store-only ZIP-based .livp archive and proves its
// still/motion relation from matching embedded Apple content identifiers.
// Provider metadata, archive comment, filenames, and timestamps never establish
// the relation by themselves.
func InspectLIVP(r io.ReaderAt, size int64) (LIVPInfo, error) {
	var out LIVPInfo
	if r == nil {
		return out, errors.New("livp reader is nil")
	}
	if size <= 0 {
		return out, errors.New("livp archive is empty")
	}
	if size > maxLIVPArchiveBytes {
		return out, fmt.Errorf("livp archive exceeds %d bytes", maxLIVPArchiveBytes)
	}

	zr, err := zip.NewReader(r, size)
	if err != nil {
		return out, fmt.Errorf("open livp zip: %w", err)
	}

	if len(zr.File) != 2 {
		return out, errors.New("livp must contain exactly one still image and one motion video")
	}

	var stillFile, motionFile *zip.File
	for _, file := range zr.File {
		if err := validateLIVPEntry(file); err != nil {
			return out, err
		}
		switch classifyLIVPEntry(file.Name) {
		case livpEntryStill:
			if stillFile != nil {
				return out, errors.New("livp contains more than one still image")
			}
			stillFile = file
		case livpEntryMotion:
			if motionFile != nil {
				return out, errors.New("livp contains more than one motion video")
			}
			motionFile = file
		default:
			return out, fmt.Errorf("livp contains unsupported entry %q", file.Name)
		}
	}
	if stillFile == nil || motionFile == nil {
		return out, errors.New("livp must contain exactly one still image and one motion video")
	}

	still, stillOffset, err := inspectStoredLIVPEntry(r, size, stillFile, maxLIVPImageBytes)
	if err != nil {
		return out, fmt.Errorf("inspect livp still %q: %w", stillFile.Name, err)
	}
	if still.Kind != KindImage {
		return out, fmt.Errorf("livp still %q is not an image", stillFile.Name)
	}

	motion, motionOffset, err := inspectStoredLIVPEntry(r, size, motionFile, maxLIVPVideoBytes)
	if err != nil {
		return out, fmt.Errorf("inspect livp motion %q: %w", motionFile.Name, err)
	}
	if motion.Kind != KindVideo {
		return out, fmt.Errorf("livp motion %q is not a video", motionFile.Name)
	}

	stillID := normalizeLivePhotoIdentifier(still.LivePhotoAssetIdentifier)
	motionID := normalizeLivePhotoIdentifier(motion.LivePhotoAssetIdentifier)
	if stillID == "" || motionID == "" {
		return out, errors.New("livp members do not contain complete Apple Live Photo identifiers")
	}
	if stillID != motionID {
		return out, errors.New("livp still and motion identifiers do not match")
	}

	out = LIVPInfo{
		AssetIdentifier: stillID,
		StillName:       stillFile.Name,
		StillOffset:     stillOffset,
		StillSize:       int64(stillFile.UncompressedSize64),
		Still:           still,
		MotionName:      motionFile.Name,
		MotionOffset:    motionOffset,
		MotionSize:      int64(motionFile.UncompressedSize64),
		Motion:          motion,
	}
	return out, nil
}

func validateLIVPEntry(file *zip.File) error {
	if file == nil {
		return errors.New("livp contains a nil zip entry")
	}
	name := strings.TrimSpace(file.Name)
	if name == "" || !utf8.ValidString(name) {
		return errors.New("livp contains an invalid entry name")
	}
	if file.FileInfo().IsDir() || strings.HasSuffix(name, "/") || strings.HasSuffix(name, "\\") {
		return fmt.Errorf("livp entry %q must be a regular file", file.Name)
	}
	if strings.Contains(name, "/") || strings.Contains(name, "\\") ||
		name == "." || name == ".." || filepath.Base(name) != name {
		return fmt.Errorf("livp entry %q must be a flat safe filename", file.Name)
	}
	for _, ch := range name {
		if ch < 32 || ch == 127 {
			return fmt.Errorf("livp entry %q contains control characters", file.Name)
		}
	}
	if file.Flags&0x1 != 0 {
		return fmt.Errorf("livp entry %q is encrypted", file.Name)
	}
	if file.Method != zip.Store {
		return fmt.Errorf("livp entry %q uses unsupported compression method %d", file.Name, file.Method)
	}
	if file.UncompressedSize64 == 0 {
		return fmt.Errorf("livp entry %q is empty", file.Name)
	}
	if file.CompressedSize64 != file.UncompressedSize64 {
		return fmt.Errorf("livp stored entry %q has inconsistent sizes", file.Name)
	}
	return nil
}

func classifyLIVPEntry(name string) livpEntryKind {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".heic", ".heif", ".jpg", ".jpeg":
		return livpEntryStill
	case ".mov", ".mp4", ".m4v":
		return livpEntryMotion
	default:
		return livpEntryUnknown
	}
}

func inspectStoredLIVPEntry(
	r io.ReaderAt,
	archiveSize int64,
	file *zip.File,
	maxBytes int64,
) (Result, int64, error) {
	var out Result
	if file.UncompressedSize64 > uint64(maxBytes) {
		return out, 0, fmt.Errorf("entry exceeds %d bytes", maxBytes)
	}
	offset, err := file.DataOffset()
	if err != nil {
		return out, 0, err
	}
	size := int64(file.UncompressedSize64)
	if offset < 0 || size <= 0 || archiveSize <= 0 ||
		offset > archiveSize || size > archiveSize-offset {
		return out, 0, errors.New("invalid stored entry range")
	}
	section := io.NewSectionReader(r, offset, size)
	out, err = Extract(file.Name, section, size)
	if err != nil {
		return out, 0, err
	}
	return out, offset, nil
}

type LIVPContainerDescriptor struct {
	AssetIdentifier string                          `json:"asset_identifier"`
	Still           LIVPContainerResourceDescriptor `json:"still"`
	Motion          LIVPContainerResourceDescriptor `json:"motion"`
}

type LIVPContainerResourceDescriptor struct {
	Name     string `json:"name"`
	Offset   int64  `json:"offset"`
	Size     int64  `json:"size"`
	MIMEType string `json:"mime_type,omitempty"`
}

// ParseLIVPContainerDescriptor validates the persisted connector-neutral
// descriptor produced by extractLIVP. The descriptor references byte ranges
// inside the original .livp Node; it never owns or duplicates those bytes.
func ParseLIVPContainerDescriptor(raw string) (LIVPContainerDescriptor, error) {
	var out LIVPContainerDescriptor
	if strings.TrimSpace(raw) == "" {
		return out, errors.New("livp container metadata is empty")
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return out, err
	}
	out.AssetIdentifier = strings.TrimSpace(out.AssetIdentifier)
	if out.AssetIdentifier == "" {
		return LIVPContainerDescriptor{}, errors.New("livp asset identifier is missing")
	}
	if !validLIVPContainerResourceDescriptor(out.Still, "image/") ||
		!validLIVPContainerResourceDescriptor(out.Motion, "video/") {
		return LIVPContainerDescriptor{}, errors.New("livp resource descriptor is invalid")
	}
	return out, nil
}

func validLIVPContainerResourceDescriptor(
	resource LIVPContainerResourceDescriptor,
	mimePrefix string,
) bool {
	name := strings.TrimSpace(resource.Name)
	if name == "" ||
		strings.Contains(name, "/") ||
		strings.Contains(name, "\\") ||
		name == "." ||
		name == ".." ||
		filepath.Base(name) != name {
		return false
	}
	for _, ch := range name {
		if ch < 32 || ch == 127 {
			return false
		}
	}
	mimeType := strings.ToLower(strings.TrimSpace(resource.MIMEType))
	return strings.HasPrefix(mimeType, mimePrefix) &&
		resource.Offset >= 0 &&
		resource.Size > 0
}

// extractLIVP projects a validated .livp container as one logical image media
// item while preserving the original container as the only filesystem Node.
// Embedded still/motion resources remain derived local resources, not Nodes or
// SourceItems.
func extractLIVP(r io.ReaderAt, size int64) (Result, error) {
	out := Result{
		Kind:          KindOther,
		MIMEType:      LIVPMIMEType,
		ContainerKind: ContainerKindLIVP,
		Orientation:   1,
	}
	info, err := InspectLIVP(r, size)
	if err != nil {
		return out, err
	}

	out.Kind = KindImage
	out.LivePhotoAssetIdentifier = info.AssetIdentifier

	out.Width = info.Still.Width
	out.Height = info.Still.Height
	out.Orientation = info.Still.Orientation
	out.CapturedAt = info.Still.CapturedAt
	out.Latitude = info.Still.Latitude
	out.Longitude = info.Still.Longitude
	out.AltitudeM = info.Still.AltitudeM
	out.CameraMake = info.Still.CameraMake
	out.CameraModel = info.Still.CameraModel
	out.LensModel = info.Still.LensModel
	out.EXIFJSON = info.Still.EXIFJSON

	out.RotationDegrees = info.Motion.RotationDegrees
	out.DurationMS = info.Motion.DurationMS
	out.FrameRate = info.Motion.FrameRate
	out.BitRate = info.Motion.BitRate
	out.VideoCodec = info.Motion.VideoCodec
	out.AudioCodec = info.Motion.AudioCodec
	out.VideoJSON = info.Motion.VideoJSON

	container := LIVPContainerDescriptor{
		AssetIdentifier: info.AssetIdentifier,
		Still: LIVPContainerResourceDescriptor{
			Name: info.StillName, Offset: info.StillOffset, Size: info.StillSize,
			MIMEType: info.Still.MIMEType,
		},
		Motion: LIVPContainerResourceDescriptor{
			Name: info.MotionName, Offset: info.MotionOffset, Size: info.MotionSize,
			MIMEType: info.Motion.MIMEType,
		},
	}
	if encoded, encodeErr := json.Marshal(container); encodeErr == nil {
		out.ContainerJSON = string(encoded)
	}
	return out, nil
}
