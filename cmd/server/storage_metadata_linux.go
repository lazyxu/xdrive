//go:build linux

package main

import (
	"errors"
	"fmt"
	"os"
	"strconv"

	"golang.org/x/sys/unix"
)

func openStorageMetadataFile(root *os.Root, path string) (*os.File, error) {
	// O_PATH can pin an unreadable inode without opening a device/FIFO, and
	// O_NOFOLLOW pins a final symlink itself so validation rejects it.
	return root.OpenFile(path, unix.O_PATH|unix.O_NOFOLLOW, 0)
}

func setStorageFileOwner(file *os.File, uid, gid int) error {
	return unix.Fchownat(int(file.Fd()), "", uid, gid, unix.AT_EMPTY_PATH|unix.AT_SYMLINK_NOFOLLOW)
}

func setStorageFileMode(file *os.File, mode os.FileMode) error {
	bits := uint32(mode.Perm())
	if mode&os.ModeSetuid != 0 {
		bits |= unix.S_ISUID
	}
	if mode&os.ModeSetgid != 0 {
		bits |= unix.S_ISGID
	}
	if mode&os.ModeSticky != 0 {
		bits |= unix.S_ISVTX
	}
	err := unix.Fchmodat(int(file.Fd()), "", bits, unix.AT_EMPTY_PATH)
	if err == nil {
		return nil
	}
	if !errors.Is(err, unix.ENOSYS) && !errors.Is(err, unix.EOPNOTSUPP) && !errors.Is(err, unix.EINVAL) {
		return err
	}
	// Linux before fchmodat2/AT_EMPTY_PATH still exposes the SAME pinned
	// inode through procfs. Never fall back to the original mutable pathname.
	if err := os.Chmod("/proc/self/fd/"+strconv.FormatUint(uint64(file.Fd()), 10), mode); err != nil {
		return fmt.Errorf("chmod pinned storage descriptor: %w", err)
	}
	return nil
}
