//go:build linux

package api

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
)

// Shared with scripts/caddy-admission.py. Never follow a link planted in
// the Server-group-writable Host Control bridge.
func caddyHostAdmissionLock(dir string) (func(), error) {
	path := filepath.Join(dir, "caddy-env-admission.lock")
	fd, err := syscall.Open(path, syscall.O_RDWR|syscall.O_CREAT|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0660)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), path)
	if file == nil {
		syscall.Close(fd)
		return nil, errors.New("invalid caddy lock")
	}
	var st syscall.Stat_t
	if err := syscall.Fstat(fd, &st); err != nil || st.Mode&syscall.S_IFMT != syscall.S_IFREG || st.Nlink != 1 {
		_ = file.Close()
		return nil, errors.New("untrusted caddy admission lock")
	}
	// The Host may own an already-correct 0660 lock. A Server running only
	// in the trusted shared group cannot fchmod someone else's inode.
	// Only change mode if it actually needs repair (and then re-verify).
	if st.Mode&0777 != 0660 {
		if err := syscall.Fchmod(fd, 0660); err != nil {
			_ = file.Close()
			return nil, err
		}
		if err := syscall.Fstat(fd, &st); err != nil || st.Mode&0777 != 0660 {
			_ = file.Close()
			return nil, errors.New("untrusted caddy admission lock mode")
		}
	}
	if err := syscall.Flock(fd, syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = file.Close()
		return nil, err
	}
	return func() {
		_ = syscall.Flock(fd, syscall.LOCK_UN)
		_ = file.Close()
	}, nil
}
