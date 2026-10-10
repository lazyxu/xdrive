//go:build linux

package localpush

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"

	"golang.org/x/sys/unix"
)

// The kernel resolves every relative component beneath an open Root handle.
// Refuse old kernels without openat2 instead of silently following symlinks.
func openRootScopedRegularFile(grant RootGrant, relative string) (*os.File, error) {
	rootInfo, err := os.Lstat(grant.Path)
	if err != nil {
		return nil, fmt.Errorf("%w: inspect root: %v", ErrRootChanged, err)
	}
	rootFD, err := unix.Open(grant.Path,
		unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	defer unix.Close(rootFD)
	var stat unix.Stat_t
	if err := unix.Fstat(rootFD, &stat); err != nil {
		return nil, err
	}
	expected, ok := rootInfo.Sys().(*syscall.Stat_t)
	if !ok || expected == nil || uint64(stat.Dev) != uint64(expected.Dev) ||
		stat.Ino != expected.Ino {
		return nil, ErrRootChanged
	}
	fd, err := unix.Openat2(rootFD, filepath.FromSlash(relative), &unix.OpenHow{
		Flags:   uint64(unix.O_RDONLY | unix.O_CLOEXEC | unix.O_NOFOLLOW),
		Resolve: uint64(unix.RESOLVE_BENEATH | unix.RESOLVE_NO_SYMLINKS | unix.RESOLVE_NO_MAGICLINKS),
	})
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(fd), filepath.Join(grant.Path, filepath.FromSlash(relative))), nil
}
