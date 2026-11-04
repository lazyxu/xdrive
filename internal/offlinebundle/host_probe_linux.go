//go:build linux

package offlinebundle

import "syscall"

// Read-only filesystem capacity, not a guarantee of enough space for Docker
// images or rollback backups (which may live on different mounts).
func hostFilesystemFreeBytes(path string) (uint64, error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return 0, err
	}
	return stat.Bavail * uint64(stat.Bsize), nil
}
