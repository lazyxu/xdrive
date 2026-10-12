package storage

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// CASLifecycleLockDir contains fixed per-prefix OS-level locks. Keep these
// files across restarts: unlinking an in-use lock permits two independent
// inodes and defeats cross-process coordination. This is NOT cache storage.
const CASLifecycleLockDir = ".xdrive-cas-lifecycle-locks"

// canonicalCASDigest identifies exact managed content-addressed paths only.
// A legacy or temporary storage key is never accidentally treated as a CAS.
func canonicalCASDigest(key string) (string, bool) {
	hash, ok := ContentHashFromKey(key)
	if !ok {
		return "", false
	}
	canonical, err := ContentAddressedKey(hash)
	return hash, err == nil && canonical == key
}

// casLifecycleLease fences cooperating Local Store instances, including
// processes on the same shared filesystem. The 256 fixed shard files keep
// the lock cardinality bounded without serializing all CAS objects.
func (l *Local) casLifecycleLease(ctx context.Context, hash string, exclusive bool) (func(), error) {
	if l == nil || l.root == "" || ctx == nil || len(hash) != 64 {
		return nil, fmt.Errorf("CAS lifecycle scope is unavailable")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	dir := filepath.Join(l.root, CASLifecycleLockDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(filepath.Join(dir, hash[:2]+".lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	acquired, err := lockTempLifecycleFile(ctx, file, exclusive, false)
	if err != nil || !acquired {
		_ = file.Close()
		if err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("CAS lifecycle lease not acquired")
	}
	return func() { _ = unlockTempLifecycleFile(file); _ = file.Close() }, nil
}

func (l *Local) optionalCASWriteLease(ctx context.Context, key string) (func(), error) {
	hash, ok := canonicalCASDigest(key)
	if !ok {
		return func() {}, nil
	}
	return l.casLifecycleLease(ctx, hash, true)
}

type pinnedLocalCASFile struct {
	*os.File
	release  func()
	once     sync.Once
	closeErr error
}

func (f *pinnedLocalCASFile) Close() error {
	f.once.Do(func() {
		f.closeErr = f.File.Close()
		f.release()
	})
	return f.closeErr
}

// OpenPinnedCAS acquires a shared per-shard lease before opening a canonical
// CAS file and releases it ONLY after the caller closes the returned reader.
// Local.Put, Local.Promote and Local.Delete take the exclusive counterpart.
// This protects a bounded read from cooperating Local Store writes/deletes.
// It does not prove storage durability, file integrity or commit authority.
func (l *Local) OpenPinnedCAS(ctx context.Context, key string) (PinnedCASFile, error) {
	hash, ok := canonicalCASDigest(key)
	if !ok {
		return nil, fmt.Errorf("canonical CAS key required")
	}
	release, err := l.casLifecycleLease(ctx, hash, false)
	if err != nil {
		return nil, err
	}
	full, err := l.resolve(key)
	if err != nil {
		release()
		return nil, err
	}
	file, err := os.Open(full)
	if err != nil {
		release()
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		_ = file.Close()
		release()
		return nil, err
	}
	return &pinnedLocalCASFile{File: file, release: release}, nil
}
