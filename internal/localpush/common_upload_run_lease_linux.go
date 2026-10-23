//go:build linux

package localpush

import (
	"os"
	"syscall"
)

func lockCommonBatchRun(file *os.File) error {
	return syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
}

func unlockCommonBatchRun(file *os.File) error {
	return syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
}
