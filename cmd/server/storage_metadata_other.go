//go:build !unix

package main

import (
	"fmt"
	"os"
)

func validateStorageSingleLink(info os.FileInfo) error {
	return fmt.Errorf("POSIX storage ownership repair is unavailable on this platform")
}

func validateStorageSameDevice(root, entry os.FileInfo) error {
	return fmt.Errorf("POSIX storage ownership repair is unavailable on this platform")
}

func storageFileLinks(info os.FileInfo) (storageFileIdentity, uint64, error) {
	return storageFileIdentity{}, 0, fmt.Errorf("POSIX file identity is unavailable on this platform")
}

func openStorageMetadataFile(root *os.Root, path string) (*os.File, error) {
	return nil, fmt.Errorf("POSIX storage ownership repair is unavailable on this platform")
}

func setStorageFileOwner(file *os.File, uid, gid int) error    { return file.Chown(uid, gid) }
func setStorageFileMode(file *os.File, mode os.FileMode) error { return file.Chmod(mode) }
