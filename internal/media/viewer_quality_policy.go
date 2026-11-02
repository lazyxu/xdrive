package media

import (
	"errors"
	"fmt"
	"strings"
)

// ViewerQualityPreset is an account/device display preference, not a token
// that may override a Server administrator's hard quality cap.
type ViewerQualityPreset string

const (
	ViewerQualityEconomy ViewerQualityPreset = "economy"
	ViewerQualityBalanced ViewerQualityPreset = "balanced"
	ViewerQualityHigh ViewerQualityPreset = "high"
	viewerQualityVariantVersion = 2
)

var ErrViewerQualityPreference = errors.New("invalid viewer quality preference")

// Empty means the legacy 4K high default, not an unrestricted quality.
func ParseViewerQualityPreset(raw string) (ViewerQualityPreset, error) {
	preset := ViewerQualityPreset(strings.TrimSpace(raw))
	switch preset {
	case "":
		return ViewerQualityHigh, nil
	case ViewerQualityEconomy, ViewerQualityBalanced, ViewerQualityHigh:
		return preset, nil
	default:
		return "", ErrViewerQualityPreference
	}
}

func viewerQualityRank(p ViewerQualityPreset) int {
	switch p {
	case ViewerQualityEconomy: return 1
	case ViewerQualityBalanced: return 2
	case ViewerQualityHigh: return 3
	default: return 0
	}
}

// Requested and Effective stay distinct so a UI can disclose a server cap.
type ViewerQualityResolution struct {
	Requested ViewerQualityPreset
	Effective ViewerQualityPreset
	AdminMaximum ViewerQualityPreset
	Capped bool
}

// Account default -> optional device override -> admin hard maximum.
func ResolveViewerQuality(accountPreference, deviceOverride, adminMaximum string) (ViewerQualityResolution, error) {
	var zero ViewerQualityResolution
	account, err := ParseViewerQualityPreset(accountPreference)
	if err != nil { return zero, err }
	maximum, err := ParseViewerQualityPreset(adminMaximum)
	if err != nil { return zero, err }
	requested := account
	if strings.TrimSpace(deviceOverride) != "" {
		requested, err = ParseViewerQualityPreset(deviceOverride)
		if err != nil { return zero, err }
	}
	effective := requested
	capped := viewerQualityRank(requested) > viewerQualityRank(maximum)
	if capped { effective = maximum }
	return ViewerQualityResolution{Requested:requested, Effective:effective, AdminMaximum:maximum, Capped:capped}, nil
}

// Finite, trusted encoding settings. Direct arbitrary maxEdge/Q are forbidden.
type ViewerQualityVariant struct {
	Preset ViewerQualityPreset
	Format string
	MaxEdge int
	Quality int
	EncoderVersion int
}

// Economy/balanced are reserved for the next gated rollout. Existing routes,
// 4K ETags, and the DSM v1 Range contract are not changed by this module.
func ViewerQualityVariantFor(preset ViewerQualityPreset, format string) (ViewerQualityVariant, error) {
	if format != "webp" && format != "jpeg" { return ViewerQualityVariant{}, ErrViewerQualityPreference }
	v := ViewerQualityVariant{Preset:preset, Format:format, EncoderVersion:viewerQualityVariantVersion}
	switch preset {
	case ViewerQualityEconomy:
		v.MaxEdge = 1280
		if format == "webp" { v.Quality = 82 } else { v.Quality = 84 }
	case ViewerQualityBalanced:
		v.MaxEdge = 2048
		if format == "webp" { v.Quality = 88 } else { v.Quality = 90 }
	case ViewerQualityHigh:
		v.MaxEdge = ViewerPreviewEdge
		if format == "webp" { v.Quality = ViewerPreviewWebPQuality } else { v.Quality = ViewerPreviewJPEGQuality }
	default:
		return ViewerQualityVariant{}, ErrViewerQualityPreference
	}
	return v, nil
}

func validViewerQualityVariant(v ViewerQualityVariant) bool {
	expected, err := ViewerQualityVariantFor(v.Preset, v.Format)
	return err == nil && v == expected
}

// New presets get their own edge/quality/pipeline version. High keeps the
// exact legacy key so existing cached 4K files are reused without migration.
func ViewerQualityStorageKey(nodeID, revision uint64, sha256 string, v ViewerQualityVariant) (string, error) {
	if !validViewerQualityVariant(v) || nodeID == 0 || revision == 0 {
		return "", ErrViewerQualityPreference
	}
	if v.Preset == ViewerQualityHigh {
		return ViewerPreviewStorageKey(nodeID, revision, sha256, v.Format), nil
	}
	base := strings.TrimSuffix(thumbnailStorageKey(
		nodeID, revision, sha256, 100+ViewerPreviewVersion, v.MaxEdge,
	), ".jpg")
	ext := "jpg"
	if v.Format == "webp" { ext = "webp" }
	return fmt.Sprintf("%s-q%d-encoder%d.%s", base, v.Quality, v.EncoderVersion, ext), nil
}

// New variants use v2 ETags; legacy high continues to use v1 so previously
// shipped DSM clients do not accept a misleading new ETag format.
func ViewerQualityETag(nodeID, revision uint64, sha256 string, v ViewerQualityVariant) (string, error) {
	if !validViewerQualityVariant(v) || nodeID == 0 || revision == 0 {
		return "", ErrViewerQualityPreference
	}
	if v.Preset == ViewerQualityHigh {
		return ViewerPreviewETag(nodeID, revision, sha256, v.Format), nil
	}
	return fmt.Sprintf("%q", fmt.Sprintf("media-viewer:%s:%d:%d:%s:e%d:q%d:encoder%d:v2",
		strings.ToLower(strings.TrimSpace(sha256)), nodeID, revision,
		v.Format, v.MaxEdge, v.Quality, v.EncoderVersion)), nil
}
