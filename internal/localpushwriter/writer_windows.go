//go:build windows

package localpushwriter

import (
	"golang.org/x/sys/windows"
	"os"
)

const nativeWriterLockRange = ^uint32(0)

func lockNativeWriter(f *os.File) error {
	return windows.LockFileEx(windows.Handle(f.Fd()),
		windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY,
		0, nativeWriterLockRange, nativeWriterLockRange, new(windows.Overlapped))
}

func unlockNativeWriter(f *os.File) error {
	return windows.UnlockFileEx(windows.Handle(f.Fd()),
		0, nativeWriterLockRange, nativeWriterLockRange, new(windows.Overlapped))
}
