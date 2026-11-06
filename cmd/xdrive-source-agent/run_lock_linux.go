//go:build linux

package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

// lockSourceAgentRun prevents overlapping DSM Task Scheduler invocations
// from concurrently mutating the same sharded identity state. The lock is
// advisory, process-scoped, and released by the kernel after a crash.
// Never unlink the lock file: that could create a second lock inode.
func lockSourceAgentRun(configDir string) (release func(), acquired bool, err error) {
	if configDir == "" {
		return nil, false, fmt.Errorf("source-agent config directory is empty")
	}
	if err := os.MkdirAll(configDir, 0o700); err != nil {
		return nil, false, err
	}
	file, err := os.OpenFile(filepath.Join(configDir, "run.lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, false, err
	}
	if err := file.Chmod(0o600); err != nil {
		_ = file.Close()
		return nil, false, err
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = file.Close()
		if errors.Is(err, syscall.EWOULDBLOCK) || errors.Is(err, syscall.EAGAIN) {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("lock source-agent run: %w", err)
	}
	return func() {
		_ = syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
		_ = file.Close()
	}, true, nil
}
