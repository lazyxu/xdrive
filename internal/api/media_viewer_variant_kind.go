package api

import mediapkg "github.com/lazyxu/xdrive/internal/media"

// Server-side allowlist: quality strings are never converted into arbitrary
// encoder parameters, paths or workload identities.
func mediaViewerKindForVariant(variant mediapkg.ViewerQualityVariant) (mediaDerivativeKind, bool) {
	expected, err := mediapkg.ViewerQualityVariantFor(variant.Preset, variant.Format)
	if err != nil || variant != expected {
		return "", false
	}
	switch variant.Preset {
	case mediapkg.ViewerQualityEconomy:
		if variant.Format == "webp" {
			return mediaDerivativeViewerEconomyWebP, true
		}
		return mediaDerivativeViewerEconomyJPEG, true
	case mediapkg.ViewerQualityBalanced:
		if variant.Format == "webp" {
			return mediaDerivativeViewerBalancedWebP, true
		}
		return mediaDerivativeViewerBalancedJPEG, true
	case mediapkg.ViewerQualityHigh:
		if variant.Format == "webp" {
			return mediaDerivativeViewerWebP, true
		}
		return mediaDerivativeViewerJPEG, true
	default:
		return "", false
	}
}

func mediaViewerVariantForDerivative(kind mediaDerivativeKind) (mediapkg.ViewerQualityVariant, bool) {
	var preset mediapkg.ViewerQualityPreset
	var format string
	switch kind {
	case mediaDerivativeViewerEconomyWebP:
		preset, format = mediapkg.ViewerQualityEconomy, "webp"
	case mediaDerivativeViewerEconomyJPEG:
		preset, format = mediapkg.ViewerQualityEconomy, "jpeg"
	case mediaDerivativeViewerBalancedWebP:
		preset, format = mediapkg.ViewerQualityBalanced, "webp"
	case mediaDerivativeViewerBalancedJPEG:
		preset, format = mediapkg.ViewerQualityBalanced, "jpeg"
	case mediaDerivativeViewerWebP:
		preset, format = mediapkg.ViewerQualityHigh, "webp"
	case mediaDerivativeViewerJPEG:
		preset, format = mediapkg.ViewerQualityHigh, "jpeg"
	default:
		return mediapkg.ViewerQualityVariant{}, false
	}
	variant, err := mediapkg.ViewerQualityVariantFor(preset, format)
	return variant, err == nil
}
