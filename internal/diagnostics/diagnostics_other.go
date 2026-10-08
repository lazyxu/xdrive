//go:build !linux && !windows

package diagnostics

import "fmt"

func platformDiskSpace(string) (uint64, uint64, error) {
	return 0, 0, fmt.Errorf("local disk telemetry is unavailable on this platform")
}

func PlatformChecks(string) []Check {
	return []Check{{Name: "platform checks", Status: Warn, Detail: "no platform-specific diagnostics for this OS"}}
}
