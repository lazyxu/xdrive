package api

import (
	"strings"

	"github.com/lazyxu/xdrive/internal/photointelligence"
)

// Only a manually requested LOCAL public-material observation. File and
// operator-key SHA-256 pins are both deployment-owned inputs and do NOT
// attest a fleet, a model process, request admission or safe host stop.
// Return only bounded status enums, never the paths, pins or key material.
func photoHostTrustMaterialObservation(filePath, pinnedSHA256, operatorKeySHA256 string) string {
	filePath = strings.TrimSpace(filePath)
	pinnedSHA256 = strings.TrimSpace(pinnedSHA256)
	operatorKeySHA256 = strings.TrimSpace(operatorKeySHA256)
	if filePath == "" && pinnedSHA256 == "" && operatorKeySHA256 == "" {
		return "unverified"
	}
	if filePath == "" || pinnedSHA256 == "" {
		return "blocked"
	}
	if operatorKeySHA256 != "" {
		if _, err := photointelligence.ReadOperatorPinnedPhotoHostTrustAnchorV1(filePath, pinnedSHA256, operatorKeySHA256); err != nil {
			return "blocked"
		}
		return "root-pin-match-local"
	}
	if _, err := photointelligence.ReadPinnedPhotoHostTrustAnchorV1(filePath, pinnedSHA256); err != nil {
		return "blocked"
	}
	return "material-only"
}
