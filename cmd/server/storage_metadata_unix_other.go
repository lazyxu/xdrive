//go:build unix && !linux

package main

import (
	"os"
	"syscall"
)

func openStorageMetadataFile(root *os.Root, path string) (*os.File, error) {
	return root.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
}

func setStorageFileOwner(file *os.File, uid, gid int) error    { return file.Chown(uid, gid) }
func setStorageFileMode(file *os.File, mode os.FileMode) error { return file.Chmod(mode) }
