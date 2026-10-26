package main

import (
	"fmt"
	"os"
	"path/filepath"
)

type storageFileIdentity struct{ device, inode uint64 }

// Bind every metadata mutation to the checked inode beneath the storage root.
// Path replacement can cause an error, but cannot redirect chown/chmod.
func withPinnedStorageEntry(storageRoot, path string, expected os.FileInfo, change func(*os.File, os.FileInfo) error) error {
	relative, err := filepath.Rel(storageRoot, path)
	if err != nil {
		return err
	}
	root, err := os.OpenRoot(storageRoot)
	if err != nil {
		return err
	}
	defer root.Close()
	rootInfo, err := root.Stat(".")
	if err != nil {
		return err
	}
	file, err := openStorageMetadataFile(root, relative)
	if err != nil {
		return fmt.Errorf("pin storage entry %s: %w", path, err)
	}
	defer file.Close()
	actual, err := file.Stat()
	if err != nil {
		return err
	}
	if err := validateStorageMetadataIdentity(expected, actual); err != nil {
		return err
	}
	if !actual.IsDir() && !actual.Mode().IsRegular() {
		return fmt.Errorf("storage entry must be a real directory or regular file")
	}
	if err := validateStorageSameDevice(rootInfo, actual); err != nil {
		return err
	}
	current, err := root.Lstat(relative)
	if err != nil || !os.SameFile(actual, current) {
		return fmt.Errorf("storage entry changed before metadata repair")
	}
	if err := change(file, actual); err != nil {
		return err
	}
	after, err := file.Stat()
	if err != nil {
		return err
	}
	if err := validateStorageMetadataIdentity(actual, after); err != nil {
		return err
	}
	current, err = root.Lstat(relative)
	if err != nil || !os.SameFile(after, current) {
		return fmt.Errorf("storage entry changed during metadata repair")
	}
	return nil
}

func validateStorageMetadataIdentity(before, after os.FileInfo) error {
	if !os.SameFile(before, after) || before.Mode().Type() != after.Mode().Type() {
		return fmt.Errorf("storage inode changed during metadata repair")
	}
	if before.Mode().IsRegular() {
		_, oldLinks, err := storageFileLinks(before)
		if err != nil {
			return err
		}
		_, newLinks, err := storageFileLinks(after)
		if err != nil {
			return err
		}
		if oldLinks != newLinks || before.Size() != after.Size() {
			return fmt.Errorf("storage file changed during metadata repair")
		}
	}
	return nil
}
