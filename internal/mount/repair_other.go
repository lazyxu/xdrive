//go:build !linux && !windows

package mount

func repairSyncRootPlatform(string) error { return nil }
