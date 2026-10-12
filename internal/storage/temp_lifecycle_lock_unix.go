//go:build !windows

package storage

import (
	"context"
	"errors"
	"os"
	"time"

	"golang.org/x/sys/unix"
)

func lockTempLifecycleFile(ctx context.Context, file *os.File, exclusive, try bool) (bool, error) {
	mode := unix.LOCK_SH
	if exclusive {
		mode = unix.LOCK_EX
	}
	for {
		if err := ctx.Err(); err != nil {
			return false, err
		}
		err := unix.Flock(int(file.Fd()), mode|unix.LOCK_NB)
		if err == nil {
			return true, nil
		}
		if !errors.Is(err, unix.EWOULDBLOCK) && !errors.Is(err, unix.EAGAIN) {
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
	return unix.Flock(int(file.Fd()), unix.LOCK_UN)
}
