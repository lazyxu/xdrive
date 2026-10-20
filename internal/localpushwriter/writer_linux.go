//go:build linux

package localpushwriter

import (
	"os"
	"syscall"
)

func lockNativeWriter(f *os.File) error {
	return syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
}

func unlockNativeWriter(f *os.File) error {
	return syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
}
