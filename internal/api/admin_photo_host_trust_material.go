package api

import (
	"strings"

	"github.com/lazyxu/xdrive/internal/photointelligence"
)

// This is a manual, LOCAL, negative-only observation of operator-provided
// PUBLIC trust material. Neither a matching file SHA-256 nor a parsed roster
// attests a signed deployment, online Server/model identity, all callers
// enforcing admission, or safe stop/restart. Never return the path or keys.
func photoHostTrustMaterialObservation(filePath, pinnedSHA256 string) string {
	filePath, pinnedSHA256 = strings.TrimSpace(filePath), strings.TrimSpace(pinnedSHA256)
	if filePath == "" && pinnedSHA256 == "" {
		return "unverified"
	}
	if filePath == "" || pinnedSHA256 == "" {
		return "blocked"
	}
	if _, err := photointelligence.ReadPinnedPhotoHostTrustAnchorV1(filePath, pinnedSHA256); err != nil {
		return "blocked"
	}
	return "material-only"
}
