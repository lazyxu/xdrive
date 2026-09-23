package version

import "strings"

// Version is replaced at build time for release installers.
// Development builds intentionally keep "dev" and do not auto-update.
var Version = "dev"

func String() string {
	v := strings.TrimSpace(Version)
	if v == "" {
		return "dev"
	}
	return v
}
