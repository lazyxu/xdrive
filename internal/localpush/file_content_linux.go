//go:build linux

package localpush

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"golang.org/x/sys/unix"
)

// openRootScopedRegularFile normally uses atomic openat2 RESOLVE_BENEATH
// + NO_SYMLINKS. DSM 7 armada38x runs Linux 3.10 where openat2 returns
// ENOSYS; only then use the stricter descriptor-walk fallback. No fallback
// is allowed for EPERM, EINVAL or an unrelated openat2 error.
func openRootScopedRegularFile(grant RootGrant, relative string) (*os.File, error) {
	return openRootScopedRegularFileWithOpener(grant, relative, unix.Openat2)
}

func openRootScopedRegularFileWithOpener(
	grant RootGrant, relative string,
	openat2 func(int, string, *unix.OpenHow) (int, error),
) (*os.File, error) {
	if openat2 == nil || !validLegacyRootScopedPath(relative) {
		return nil, ErrRootChanged
	}
	rootInfo, err := os.Lstat(grant.Path)
	if err != nil || rootInfo == nil || !rootInfo.IsDir() ||
		rootInfo.Mode()&os.ModeSymlink != 0 {
		return nil, ErrRootChanged
	}
	rootFD, err := unix.Open(grant.Path,
		unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	defer unix.Close(rootFD)
	var rootStat unix.Stat_t
	if err := unix.Fstat(rootFD, &rootStat); err != nil {
		return nil, err
	}
	expected, ok := rootInfo.Sys().(*syscall.Stat_t)
	if !ok || expected == nil || rootStat.Nlink == 0 ||
		uint64(rootStat.Dev) != uint64(expected.Dev) ||
		rootStat.Ino != expected.Ino {
		return nil, ErrRootChanged
	}
	fd, err := openat2(rootFD, filepath.FromSlash(relative), &unix.OpenHow{
		Flags:   uint64(unix.O_RDONLY | unix.O_CLOEXEC | unix.O_NOFOLLOW),
		Resolve: uint64(unix.RESOLVE_BENEATH | unix.RESOLVE_NO_SYMLINKS | unix.RESOLVE_NO_MAGICLINKS),
	})
	if errors.Is(err, unix.ENOSYS) {
		fd, err = openLegacyRootScopedRegularFile(rootFD, rootStat, relative)
	}
	if err != nil {
		return nil, err
	}
	var opened unix.Stat_t
	if err := unix.Fstat(fd, &opened); err != nil ||
		opened.Mode&unix.S_IFMT != unix.S_IFREG || opened.Nlink == 0 {
		_ = unix.Close(fd)
		return nil, ErrRootChanged
	}
	return os.NewFile(uintptr(fd), filepath.Join(grant.Path, filepath.FromSlash(relative))), nil
}

func validLegacyRootScopedPath(relative string) bool {
	if relative == "" || relative == "." || filepath.IsAbs(relative) ||
		filepath.Clean(relative) != relative || strings.ContainsRune(relative, 0) {
		return false
	}
	for _, segment := range strings.Split(relative, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return false
		}
	}
	return true
}

// Old-kernel fallback: pin EVERY ancestor from the authorized Root fd,
// forbid symlink traversal at each openat, refuse nested mount boundaries,
// and recheck each child's actual ".." parent before using the last file.
// A renamed/replaced ancestor or final leaf fails before bytes are returned.
// Caller additionally rechecks the original Root grant, inode, path and
// content digest after reading; the fallback is NOT an independent grant.
func openLegacyRootScopedRegularFile(
	rootFD int, rootStat unix.Stat_t, relative string,
) (int, error) {
	if !validLegacyRootScopedPath(relative) || rootStat.Mode&unix.S_IFMT != unix.S_IFDIR ||
		rootStat.Nlink == 0 {
		return -1, ErrRootChanged
	}
	segments := strings.Split(relative, "/")
	parents := []int{rootFD}
	defer func() {
		for _, fd := range parents[1:] {
			_ = unix.Close(fd)
		}
	}()
	parent := rootFD
	for i, component := range segments {
		last := i == len(segments)-1
		flags := unix.O_RDONLY | unix.O_CLOEXEC | unix.O_NOFOLLOW
		if !last {
			flags |= unix.O_DIRECTORY
		}
		fd, err := unix.Openat(parent, component, flags, 0)
		if err != nil {
			return -1, err
		}
		var st unix.Stat_t
		if err := unix.Fstat(fd, &st); err != nil ||
			st.Nlink == 0 || st.Dev != rootStat.Dev ||
			(!last && st.Mode&unix.S_IFMT != unix.S_IFDIR) ||
			(last && st.Mode&unix.S_IFMT != unix.S_IFREG) {
			_ = unix.Close(fd)
			return -1, ErrRootChanged
		}
		if !last {
			parents = append(parents, fd)
			parent = fd
			continue
		}
		var named unix.Stat_t
		if err := unix.Fstatat(parent, component, &named, unix.AT_SYMLINK_NOFOLLOW); err != nil ||
			named.Dev != st.Dev || named.Ino != st.Ino ||
			named.Mode&unix.S_IFMT != unix.S_IFREG {
			_ = unix.Close(fd)
			return -1, ErrRootChanged
		}
		for j := len(parents)-1; j > 0; j-- {
			var actualParent, fromChild unix.Stat_t
			if err := unix.Fstat(parents[j-1], &actualParent); err != nil {
				_ = unix.Close(fd)
				return -1, ErrRootChanged
			}
			if err := unix.Fstatat(parents[j], "..", &fromChild, unix.AT_SYMLINK_NOFOLLOW); err != nil ||
				fromChild.Dev != actualParent.Dev || fromChild.Ino != actualParent.Ino {
				_ = unix.Close(fd)
				return -1, ErrRootChanged
			}
		}
		return fd, nil
	}
	return -1, fmt.Errorf("%w: missing authorized leaf", ErrRootChanged)
}
