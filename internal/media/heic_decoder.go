package media

import heic "github.com/gen2brain/heic"

// Keep HEIC decoding deterministic across xDrive deployments. The server image
// is CGO-free and distroless, so canonical thumbnail behavior must not depend
// on whether a host happens to provide a system libheif installation.
func init() {
	heic.ForceWasmMode = true
}
