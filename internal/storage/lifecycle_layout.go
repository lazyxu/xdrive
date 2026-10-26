package storage

import (
	"context"
	"crypto/rand"
	"fmt"
	"os"
	"path/filepath"
)

// LifecycleLockFamily describes persistent zero-byte lock inodes. Register new
// families here so preparation and runtime readiness cover the same namespaces.
type LifecycleLockFamily struct {
	Directory string
	Names     []string
}

func LifecycleLockFamilies() []LifecycleLockFamily {
	shards := make([]string, 256)
	for i := range shards {
		shards[i] = fmt.Sprintf("%02x.lock", i)
	}
	return []LifecycleLockFamily{
		{Names: []string{TempLifecycleLockFile}},
		{Directory: CASLifecycleLockDir, Names: shards},
		{Directory: LocalPushStageLifecycleLockDir, Names: shards},
	}
}

// checkLifecycleLockAccess does not acquire a flock: a live writer is healthy.
// It never creates, repairs or replaces a persistent lock file.
func (l *Local) checkLifecycleLockAccess(ctx context.Context) error {
	root, err := os.OpenRoot(l.root)
	if err != nil {
		return err
	}
	defer root.Close()
	for _, family := range LifecycleLockFamilies() {
		if family.Directory != "" {
			info, err := root.Lstat(family.Directory)
			if os.IsNotExist(err) {
				continue
			}
			if err != nil {
				return fmt.Errorf("lifecycle directory %s: %w", family.Directory, err)
			}
			if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
				return fmt.Errorf("lifecycle directory %s must be a real directory", family.Directory)
			}
			if err := probeWritableRootDirectory(ctx, root, family.Directory); err != nil {
				return fmt.Errorf("lifecycle directory %s: %w", family.Directory, err)
			}
		}
		for _, name := range family.Names {
			if err := ctx.Err(); err != nil {
				return err
			}
			relative := filepath.Join(family.Directory, name)
			before, err := root.Lstat(relative)
			if os.IsNotExist(err) {
				continue
			}
			if err != nil {
				return fmt.Errorf("lifecycle lock %s: %w", relative, err)
			}
			if !before.Mode().IsRegular() || before.Size() != 0 {
				return fmt.Errorf("lifecycle lock %s must be an empty regular file", relative)
			}
			file, err := root.OpenFile(relative, os.O_RDWR, 0)
			if err != nil {
				return fmt.Errorf("lifecycle lock %s is not read/write accessible: %w", relative, err)
			}
			opened, statErr := file.Stat()
			after, pathErr := root.Lstat(relative)
			closeErr := file.Close()
			if statErr != nil || pathErr != nil || closeErr != nil ||
				!os.SameFile(before, opened) || !os.SameFile(opened, after) || opened.Size() != 0 || after.Size() != 0 {
				return fmt.Errorf("lifecycle lock %s changed during readiness check", relative)
			}
		}
	}
	return nil
}

func probeWritableRootDirectory(ctx context.Context, root *os.Root, directory string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	var suffix [16]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		return err
	}
	name := filepath.Join(directory, fmt.Sprintf(".xdrive-ready-%x", suffix))
	file, err := root.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer root.Remove(name)
	defer file.Close()
	if _, err := file.Write([]byte{0}); err != nil {
		return err
	}
	return file.Close()
}
