//go:build !windows

package main

import "syscall"

// A headless xd invocation does not become the lifecycle owner of the
// already-authorized Agent's durable Runner.
func backupDetachedProcessAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setsid: true}
}
