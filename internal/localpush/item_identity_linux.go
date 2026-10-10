//go:build linux

package localpush

import (
	"fmt"
	"os"
	"syscall"

	"golang.org/x/sys/unix"
)

func platformNativeItemIdentity(path string, info os.FileInfo) (nativeItemObject, error) {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat == nil {
		return nativeItemObject{}, ErrRootChanged
	}
	base := fmt.Sprintf("linux:%d:%d", uint64(stat.Dev), uint64(stat.Ino))
	identity := nativeItemObject{
		Token:     base,
		LinkCount: uint64(stat.Nlink),
	}
	var stx unix.Statx_t
	err := unix.Statx(unix.AT_FDCWD, path, unix.AT_SYMLINK_NOFOLLOW,
		unix.STATX_TYPE|unix.STATX_INO|unix.STATX_BTIME, &stx)
	if err != nil {
		// Older kernels/filesystems do not reliably expose birth time.
		// This remains a weak, non-rename-safe key.
		return identity, nil
	}
	if stx.Mask&unix.STATX_INO != 0 && stx.Ino != uint64(stat.Ino) {
		return nativeItemObject{}, ErrRootChanged
	}
	if stx.Mask&unix.STATX_TYPE != 0 {
		kind := stx.Mode & unix.S_IFMT
		if (info.IsDir() && kind != unix.S_IFDIR) ||
			(info.Mode().IsRegular() && kind != unix.S_IFREG) {
			return nativeItemObject{}, ErrRootChanged
		}
	}
	if stx.Mask&unix.STATX_BTIME != 0 {
		identity.Token = fmt.Sprintf("%s:birth:%d:%d", base, stx.Btime.Sec, stx.Btime.Nsec)
		identity.Strong = true
	}
	return identity, nil
}
