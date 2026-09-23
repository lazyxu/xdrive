//go:build !linux && !windows

package mount

func cleanupPlatform(string) error { return nil }
