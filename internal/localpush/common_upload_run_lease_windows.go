//go:build windows

package localpush

import (
	"os"

	"golang.org/x/sys/windows"
)

const commonBatchWindowsLockRange = ^uint32(0)

func lockCommonBatchRun(file *os.File) error {
	return windows.LockFileEx(windows.Handle(file.Fd()),
		windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY,
		0, commonBatchWindowsLockRange, commonBatchWindowsLockRange,
		new(windows.Overlapped))
}

func unlockCommonBatchRun(file *os.File) error {
	return windows.UnlockFileEx(windows.Handle(file.Fd()), 0,
		commonBatchWindowsLockRange, commonBatchWindowsLockRange,
		new(windows.Overlapped))
}
