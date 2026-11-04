//go:build !linux

package api

import "errors"

// Server offline imports are Linux-only. Keep Windows build coverage without
// pretending that a Windows host has a verified Docker update mount.
func offlineUpdateImportFreeBytes(string) (uint64, error) {
	return 0, errors.New("Linux host offline import is required")
}
