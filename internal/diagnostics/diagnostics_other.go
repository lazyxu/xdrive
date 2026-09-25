//go:build !linux && !windows

package diagnostics

func PlatformChecks(string) []Check {
	return []Check{{Name: "platform checks", Status: Warn, Detail: "no platform-specific diagnostics for this OS"}}
}
