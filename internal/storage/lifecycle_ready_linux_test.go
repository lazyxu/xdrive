//go:build linux

package storage

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestReadyRejectsUnreadablePersistentLifecycleLocks(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("requires native non-root permission enforcement")
	}
	for _, relative := range []string{TempLifecycleLockFile, filepath.Join(CASLifecycleLockDir, "ab.lock"), filepath.Join(LocalPushStageLifecycleLockDir, "ab.lock")} {
		t.Run(relative, func(t *testing.T) {
			root := t.TempDir()
			local, err := NewLocal(root)
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(root, relative)
			if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, nil, 0o600); err != nil {
				t.Fatal(err)
			}
			if err := os.Chmod(path, 0); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = os.Chmod(path, 0o600) })
			if err := local.Ready(context.Background()); err == nil {
				t.Fatal("storage claimed ready with an unusable persistent lock")
			}
			info, _ := os.Stat(path)
			if info.Mode().Perm() != 0 || info.Size() != 0 {
				t.Fatal("readiness must not repair or rewrite a persistent lock")
			}
		})
	}
}

func TestReadyDoesNotWaitForHeldLifecycleLock(t *testing.T) {
	root := t.TempDir()
	local, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	held, err := os.OpenFile(filepath.Join(root, TempLifecycleLockFile), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	defer held.Close()
	if err := unix.Flock(int(held.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		t.Fatal(err)
	}
	defer unix.Flock(int(held.Fd()), unix.LOCK_UN)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := local.Ready(ctx); err != nil {
		t.Fatalf("an active writer is not a permission failure: %v", err)
	}
}
