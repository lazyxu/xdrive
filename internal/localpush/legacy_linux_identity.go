//go:build linux

package localpush

import (
	"fmt"
	"os"
	"syscall"
	"unsafe"

	"golang.org/x/sys/unix"
)

// On DSM armada38x (Linux 3.10), statx birth time does not exist. ext4
// supports a read-only inode generation ioctl on older kernels. Its
// (device, inode, generation) tuple is a strong replacement witness: an
// unlinked/reallocated inode normally changes generation. No generation,
// non-ext4 filesystem or mismatch remains weak and cannot authorize a Push.
// The ioctl does not mutate inode generation or require elevated privilege.
const linuxExt4Magic = 0xEF53

// FS_IOC_GETVERSION is _IOR('v', 1, long). The request must contain the
// NATIVE long width: 4 on DSM linux/arm, 8 on linux/amd64. Never pass a
// 4-byte destination to a kernel ioctl whose request writes an 8-byte long.
func linuxExt4Generation(fd int) (uint32, error) {
	if fd < 0 {
		return 0, ErrRootChanged
	}
	var fs unix.Statfs_t
	if err := unix.Fstatfs(fd, &fs); err != nil || int64(fs.Type) != linuxExt4Magic {
		return 0, ErrRootChanged
	}
	request := uint(0x80000000) | uint(unsafe.Sizeof(uintptr(0)))<<16 | uint('v')<<8 | 1
	var version uintptr
	_, _, errno := unix.Syscall(unix.SYS_IOCTL, uintptr(fd), uintptr(request),
		uintptr(unsafe.Pointer(&version)))
	if errno != 0 || uint32(version) == 0 {
		return 0, ErrRootChanged
	}
	return uint32(version), nil
}

func linuxLegacyToken(info os.FileInfo, generation uint32) (nativeItemObject, error) {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat == nil || stat.Nlink == 0 || generation == 0 {
		return nativeItemObject{}, ErrRootChanged
	}
	return nativeItemObject{
		Token: fmt.Sprintf("linux:%d:%d:ext4-generation:%d",
			uint64(stat.Dev), uint64(stat.Ino), generation),
		Strong: true, LinkCount: uint64(stat.Nlink),
	}, nil
}

// The descriptor must refer to the SAME regular file/directory that Lstat
// found. Opening the final component with O_NOFOLLOW prevents an attacker
// from turning a metadata-only identity lookup into a symlink traversal.
func linuxLegacyObjectIdentity(
	path string, info os.FileInfo, generation func(int) (uint32, error),
) (nativeItemObject, bool, error) {
	if info == nil || generation == nil ||
		(!info.IsDir() && !info.Mode().IsRegular()) ||
		info.Mode()&os.ModeSymlink != 0 {
		return nativeItemObject{}, false, ErrRootChanged
	}
	initial, ok := info.Sys().(*syscall.Stat_t)
	if !ok || initial == nil || initial.Nlink == 0 {
		return nativeItemObject{}, false, ErrRootChanged
	}
	flags := unix.O_RDONLY | unix.O_CLOEXEC | unix.O_NOFOLLOW | unix.O_NONBLOCK
	if info.IsDir() {
		flags |= unix.O_DIRECTORY
	}
	fd, err := unix.Open(path, flags, 0)
	if err != nil {
		return nativeItemObject{}, false, ErrRootChanged
	}
	defer unix.Close(fd)
	var current unix.Stat_t
	if err := unix.Fstat(fd, &current); err != nil ||
		uint64(current.Dev) != uint64(initial.Dev) ||
		current.Ino != initial.Ino || current.Nlink != initial.Nlink ||
		(info.IsDir() && current.Mode&unix.S_IFMT != unix.S_IFDIR) ||
		(info.Mode().IsRegular() && current.Mode&unix.S_IFMT != unix.S_IFREG) {
		return nativeItemObject{}, false, ErrRootChanged
	}
	version, err := generation(fd)
	if err != nil || version == 0 {
		return nativeItemObject{}, false, nil
	}
	result, err := linuxLegacyToken(info, version)
	return result, err == nil, err
}

// Called on the ALREADY PINNED directory descriptor; unlike reopening a
// pathname, this remains attached to the original directory after rename.
func linuxLegacyPinnedIdentity(
	pinned *os.File, info os.FileInfo, generation func(int) (uint32, error),
) (nativeItemObject, error) {
	if pinned == nil || info == nil || !info.IsDir() || generation == nil {
		return nativeItemObject{}, ErrRootChanged
	}
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok || st == nil || st.Nlink == 0 {
		return nativeItemObject{}, ErrRootChanged
	}
	var current unix.Stat_t
	fd := int(pinned.Fd())
	if err := unix.Fstat(fd, &current); err != nil ||
		uint64(current.Dev) != uint64(st.Dev) || current.Ino != st.Ino ||
		current.Nlink != st.Nlink || current.Mode&unix.S_IFMT != unix.S_IFDIR {
		return nativeItemObject{}, ErrRootChanged
	}
	version, err := generation(fd)
	if err != nil || version == 0 {
		return nativeItemObject{}, ErrRootChanged
	}
	return linuxLegacyToken(info, version)
}
