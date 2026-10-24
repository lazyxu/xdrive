//go:build windows

package main

import "syscall"

func backupDetachedProcessAttr() *syscall.SysProcAttr {
	// DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP. The Agent owns its
	// own private IPC token and persistent original Operation state.
	return &syscall.SysProcAttr{CreationFlags: 0x00000008 | 0x00000200}
}
