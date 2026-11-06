//go:build linux

package localpush

import (
	"fmt"
	"os"
	"syscall"

	"golang.org/x/sys/unix"
)

func platformRootIdentity(path string, info os.FileInfo) (string, bool, error) {
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok || st == nil {
		return "", false, ErrUnsafeRoot
	}
	base := fmt.Sprintf("linux:%d:%d", uint64(st.Dev), uint64(st.Ino))
	var statx unix.Statx_t
	if err := unix.Statx(unix.AT_FDCWD, path, unix.AT_SYMLINK_NOFOLLOW,
		unix.STATX_INO|unix.STATX_BTIME, &statx); err == nil &&
		statx.Mask&unix.STATX_BTIME != 0 {
		return fmt.Sprintf("%s:%d:%d", base, statx.Btime.Sec, statx.Btime.Nsec), true, nil
	}
	// DSM 7 armada38x uses Linux 3.10 without statx. ext4's read-only
	// inode-generation ioctl is an older strong object witness. Unsupported
	// filesystems remain weak and are NEVER admitted by automatic Push.
	legacy, strong, err := linuxLegacyObjectIdentity(path, info, linuxExt4Generation)
	if err != nil {
		return "", false, err
	}
	if strong {
		return legacy.Token, true, nil
	}
	return base, false, nil
}
