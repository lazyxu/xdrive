//go:build unix

package main

import (
	"fmt"
	"os"
	"syscall"
)

func validateStorageSingleLink(info os.FileInfo) error {
	_, links, err := storageFileLinks(info)
	if err != nil || links != 1 {
		return fmt.Errorf("permission repair requires a single-link regular file")
	}
	return nil
}

func storageFileLinks(info os.FileInfo) (storageFileIdentity, uint64, error) {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return storageFileIdentity{}, 0, fmt.Errorf("native file identity unavailable")
	}
	return storageFileIdentity{uint64(stat.Dev), uint64(stat.Ino)}, uint64(stat.Nlink), nil
}

func validateStorageSameDevice(root, entry os.FileInfo) error {
	parent, ok := root.Sys().(*syscall.Stat_t)
	child, childOK := entry.Sys().(*syscall.Stat_t)
	if !ok || !childOK || parent.Dev != child.Dev {
		return fmt.Errorf("permission repair refuses a nested filesystem")
	}
	return nil
}
