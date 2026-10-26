package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/lazyxu/xdrive/internal/storage"
)

// A process can die after link(temp, CAS) but before unlink(temp). Account
// for every alias within this tree; never chmod/chown an unaccounted external
// alias and never unlink legitimate publication/recovery state.
func validateStorageTreeLinks(root, tree string, rootInfo os.FileInfo) (map[storageFileIdentity]uint64, error) {
	type observed struct{ links, names uint64 }
	seen := make(map[storageFileIdentity]observed)
	locks := make(map[string]bool)
	for _, family := range storage.LifecycleLockFamilies() {
		for _, name := range family.Names {
			locks[filepath.Join(root, family.Directory, name)] = true
		}
	}
	err := filepath.Walk(tree, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := validateStorageSameDevice(rootInfo, info); err != nil {
			return err
		}
		if !info.IsDir() && !info.Mode().IsRegular() {
			return fmt.Errorf("storage entry %s must be a real directory or regular file", path)
		}
		if locks[path] && (!info.Mode().IsRegular() || info.Size() != 0) {
			return fmt.Errorf("persistent lifecycle lock must be an empty regular file")
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		identity, count, err := storageFileLinks(info)
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		inStaging := relative == storage.UploadStagingDir || strings.HasPrefix(relative, storage.UploadStagingDir+string(filepath.Separator))
		if (inStaging || locks[path]) && count != 1 {
			return fmt.Errorf("staging and lifecycle locks require a single-link file")
		}
		entry := seen[identity]
		if entry.names != 0 && entry.links != count {
			return fmt.Errorf("storage link count changed during preflight")
		}
		entry.links, entry.names = count, entry.names+1
		seen[identity] = entry
		return nil
	})
	if err != nil {
		return nil, err
	}
	result := make(map[storageFileIdentity]uint64, len(seen))
	for identity, entry := range seen {
		if entry.names != entry.links {
			return nil, fmt.Errorf("storage file has unaccounted hardlinks outside the prepared tree")
		}
		result[identity] = entry.links
	}
	return result, nil
}
