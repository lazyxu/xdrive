//go:build !windows

package main

import (
	"errors"
	"os"
	"path/filepath"

	"github.com/lazyxu/xdrive/internal/userconfig"
	"golang.org/x/sys/unix"
)

func acquireSingleInstance() (func(), error) {
	dir, err := userconfig.Dir()
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return acquireSingleInstanceAt(filepath.Join(dir, "agent.lock"))
}

func acquireSingleInstanceAt(path string) (func(), error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		_ = f.Close()
		if errors.Is(err, unix.EWOULDBLOCK) || errors.Is(err, unix.EAGAIN) {
			return nil, errAlreadyRunning
		}
		return nil, err
	}
	return func() {
		_ = unix.Flock(int(f.Fd()), unix.LOCK_UN)
		_ = f.Close()
	}, nil
}
