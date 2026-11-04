//go:build linux

package api

import "golang.org/x/sys/unix"

// Reserve enough host disk for the live xDrive database and rollback state.
// This check is only an admission bound; the transactional installer performs
// its own full release capacity checks before any service is stopped.
func offlineUpdateImportFreeBytes(path string) (uint64, error) {
	var stat unix.Statfs_t
	if err := unix.Statfs(path, &stat); err != nil {
		return 0, err
	}
	return stat.Bavail * uint64(stat.Bsize), nil
}
