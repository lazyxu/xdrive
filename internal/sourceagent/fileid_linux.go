//go:build linux

package sourceagent

import (
	"fmt"
	"os"
	"strings"
	"syscall"

	"golang.org/x/sys/unix"
)

func fileExternalID(rootKey string, info os.FileInfo) (string, error) {
	id, err := filesystemIdentity(rootKey, "", info)
	if err != nil {
		return "", err
	}
	return id.LegacyExternalID, nil
}

func filesystemIdentity(rootKey, path string, info os.FileInfo, legacyDevice ...uint64) (FilesystemIdentity, error) {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat == nil {
		return FilesystemIdentity{}, fmt.Errorf("filesystem identity is unavailable")
	}
	device := uint64(stat.Dev)
	if len(legacyDevice) != 0 {
		device = legacyDevice[0]
	}
	legacy := fmt.Sprintf("fs:%s:%d:%d", rootKey, device, uint64(stat.Ino))
	weak := fmt.Sprintf("ino:%s:%d", rootKey, uint64(stat.Ino))
	strong := ""
	if path != "" {
		var stx unix.Statx_t
		err := unix.Statx(unix.AT_FDCWD, path, unix.AT_SYMLINK_NOFOLLOW, unix.STATX_INO|unix.STATX_BTIME, &stx)
		if err == nil && stx.Mask&unix.STATX_BTIME != 0 {
			strong = fmt.Sprintf("btime:%s:%d:%d:%d", rootKey, stx.Ino, stx.Btime.Sec, stx.Btime.Nsec)
			weak = fmt.Sprintf("ino:%s:%d", rootKey, stx.Ino)
		}
	}
	return FilesystemIdentity{
		LegacyExternalID: legacy,
		StrongKey:        strong,
		WeakKey:          weak,
	}, nil
}

func RootFingerprint(rootKey, rootPath string) (string, error) {
	rootKey = strings.TrimSpace(rootKey)
	rootPath = strings.TrimSpace(rootPath)
	if rootKey == "" || rootPath == "" {
		return "", fmt.Errorf("root key and path are required")
	}
	info, err := os.Lstat(rootPath)
	if err != nil {
		return "", err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("root path must not be a symbolic link")
	}
	if !info.IsDir() {
		return "", fmt.Errorf("root path is not a directory")
	}
	id, err := filesystemIdentity(rootKey, rootPath, info)
	if err != nil {
		return "", err
	}
	if id.StrongKey != "" {
		return "root:" + id.StrongKey, nil
	}
	return "root:legacy:" + id.LegacyExternalID, nil
}
