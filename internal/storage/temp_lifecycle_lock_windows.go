//go:build windows

package storage

import (
	"context"
	"errors"
	"os"
	"time"

	"golang.org/x/sys/windows"
)

func lockTempLifecycleFile(ctx context.Context, file *os.File, exclusive, try bool) (bool, error) {
	flags := uint32(windows.LOCKFILE_FAIL_IMMEDIATELY)
	if exclusive {
		flags |= windows.LOCKFILE_EXCLUSIVE_LOCK
	}
	var overlapped windows.Overlapped
	for {
		if err := ctx.Err(); err != nil {
			return false, err
		}
		err := windows.LockFileEx(windows.Handle(file.Fd()), flags, 0, 1, 0, &overlapped)
		if err == nil {
			return true, nil
		}
		if !errors.Is(err, windows.ERROR_LOCK_VIOLATION) && !errors.Is(err, windows.ERROR_IO_PENDING) {
			return false, err
		}
		if try {
			return false, nil
		}
		select {
		case <-ctx.Done():
			return false, ctx.Err()
		case <-time.After(25 * time.Millisecond):
		}
	}
}

func unlockTempLifecycleFile(file *os.File) error {
	var overlapped windows.Overlapped
	return windows.UnlockFileEx(windows.Handle(file.Fd()), 0, 1, 0, &overlapped)
}
