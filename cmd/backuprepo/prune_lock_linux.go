//go:build linux

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

func acquirePruneLock(repo string) (func(), error) {
	if err := checkRepositoryLayout(repo); err != nil {
		return nil, err
	}
	lockPath := filepath.Join(repo, ".backup.lock")
	if _, err := regularFile(lockPath); err != nil {
		return nil, fmt.Errorf("manual prune requires existing safe v2 repository lock: %w", err)
	}
	// O_NOFOLLOW prevents a symlink swap between Lstat and open; O_NONBLOCK
	// also prevents an attacker-supplied FIFO from hanging before flock.
	fd, err := syscall.Open(lockPath, syscall.O_RDONLY|syscall.O_CLOEXEC|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	lockFile := os.NewFile(uintptr(fd), lockPath)
	opened, err := lockFile.Stat()
	if err != nil || !opened.Mode().IsRegular() {
		lockFile.Close()
		return nil, fmt.Errorf("unsafe repository lock inode after open: %s", lockPath)
	}
	if err := syscall.Flock(int(lockFile.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		lockFile.Close()
		return nil, fmt.Errorf("v2 repository is busy; manual prune aborted: %w", err)
	}
	return func() {
		_ = syscall.Flock(int(lockFile.Fd()), syscall.LOCK_UN)
		_ = lockFile.Close()
	}, nil
}
