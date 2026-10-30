//go:build linux

package synologyui

import (
	"errors"
	"syscall"
)

// nasVolumeSpace describes the filesystem that holds the DSM package's
// private configuration, not all NAS volumes, Source roots or cache usage.
// The browser never supplies a path. This is an OS-local statfs read only.
type nasVolumeSpace struct {
	CapacityBytes  int64 `json:"capacity_bytes"`
	AvailableBytes int64 `json:"available_bytes"`
}

func readNASVolumeSpace(configDir string) (nasVolumeSpace, error) {
	if err := privateDir(configDir); err != nil {
		return nasVolumeSpace{}, err
	}
	var info syscall.Statfs_t
	if err := syscall.Statfs(configDir, &info); err != nil {
		return nasVolumeSpace{}, err
	}
	// JS Number can exactly represent only up to 2^53-1. Refuse to round
	// filesystem values or expose impossible available > capacity receipts.
	const maxExact = uint64(1<<53 - 1)
	if info.Bsize <= 0 || info.Blocks == 0 || info.Bavail > info.Blocks {
		return nasVolumeSpace{}, errors.New("invalid DSM package filesystem statistics")
	}
	size := uint64(info.Bsize)
	if size > maxExact || info.Blocks > maxExact/size ||
		info.Bavail > maxExact/size {
		return nasVolumeSpace{}, errors.New("DSM package filesystem capacity exceeds exact browser range")
	}
	total := uint64(info.Blocks) * size
	available := uint64(info.Bavail) * size
	if total == 0 || available > total {
		return nasVolumeSpace{}, errors.New("invalid DSM package filesystem size")
	}
	return nasVolumeSpace{CapacityBytes: int64(total), AvailableBytes: int64(available)}, nil
}
