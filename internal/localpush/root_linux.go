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
	// inode can be reused without birth time. Future Mirror must reject weak
	// roots rather than infer deletion from a matching weak fingerprint.
	return base, false, nil
}
