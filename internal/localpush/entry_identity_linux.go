//go:build linux

package localpush

import (
	"fmt"
	"os"
	"syscall"

	"golang.org/x/sys/unix"
)

// Linux birth time is required before treating an inode as a trustworthy
// rename identity. If statx is unavailable, the fingerprint is only a weak
// hint, since an inode can be reused after a file is deleted.
func platformEntryIdentity(path string, info os.FileInfo) (string, bool, uint64, error) {
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok || st == nil {
		return "", false, 0, ErrEntryIdentityChanged
	}
	key := fmt.Sprintf("linux:%d:%d", uint64(st.Dev), uint64(st.Ino))
	links := uint64(st.Nlink)
	var stat unix.Statx_t
	if err := unix.Statx(unix.AT_FDCWD, path, unix.AT_SYMLINK_NOFOLLOW,
		unix.STATX_INO|unix.STATX_BTIME|unix.STATX_NLINK, &stat); err != nil {
		return key, false, links, nil
	}
	if stat.Mask&unix.STATX_INO == 0 || stat.Ino != st.Ino ||
		stat.Dev_major != unix.Major(uint64(st.Dev)) ||
		stat.Dev_minor != unix.Minor(uint64(st.Dev)) {
		return "", false, 0, ErrEntryIdentityChanged
	}
	if stat.Mask&unix.STATX_NLINK != 0 && uint64(stat.Nlink) != links {
		return "", false, 0, ErrEntryIdentityChanged
	}
	if stat.Mask&unix.STATX_BTIME == 0 {
		return key, false, links, nil
	}
	birth := stat.Btime
	if birth.Sec == 0 && birth.Nsec == 0 {
		return key, false, links, nil
	}
	return fmt.Sprintf("%s:%d:%d", key, birth.Sec, birth.Nsec), true, links, nil
}
