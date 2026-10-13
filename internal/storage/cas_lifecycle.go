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
	release, acquired, err := l.casLifecycleLeaseMode(ctx, hash, exclusive, false)
	if err != nil {
		return nil, err
	}
	if !acquired {
		return nil, fmt.Errorf("CAS lifecycle lease not acquired")
	}
	return release, nil
}

// casLifecycleLeaseMode adds a nonblocking attempt without changing ordinary
// Put/Promote/Delete or OpenPinnedCAS behavior. A busy try is (nil,false,nil),
// never a positive read or content proof. This is useful only when a future
// caller must NOT wait on an OS lease while holding a SQL CAS hash lock.
func (l *Local) casLifecycleLeaseMode(
	ctx context.Context, hash string, exclusive, try bool,
) (func(), bool, error) {
	if l == nil || l.root == "" || ctx == nil || len(hash) != 64 {
		return nil, false, fmt.Errorf("CAS lifecycle scope is unavailable")
	}
	if err := ctx.Err(); err != nil {
		return nil, false, err
	}
	dir := filepath.Join(l.root, CASLifecycleLockDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, false, err
	}
	file, err := os.OpenFile(filepath.Join(dir, hash[:2]+".lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, false, err
	}
	acquired, err := lockTempLifecycleFile(ctx, file, exclusive, try)
	if err != nil || !acquired {
		_ = file.Close()
		return nil, false, err
	}
	return func() { _ = unlockTempLifecycleFile(file); _ = file.Close() }, true, nil
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
// openPinnedCASWithLease always releases a successfully acquired shared
// lifecycle lease on EVERY open or context error. On success, Close owns it.
func (l *Local) openPinnedCASWithLease(
	ctx context.Context, key string, release func(),
) (PinnedCASFile, error) {
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

func (l *Local) OpenPinnedCAS(ctx context.Context, key string) (PinnedCASFile, error) {
	hash, ok := canonicalCASDigest(key)
	if !ok {
		return nil, fmt.Errorf("canonical CAS key required")
	}
	release, err := l.casLifecycleLease(ctx, hash, false)
	if err != nil {
		return nil, err
	}
	return l.openPinnedCASWithLease(ctx, key, release)
}

// TryOpenPinnedCAS takes the SAME canonical shared CAS-shard lease without
// waiting for a conflicting writer. A busy lease returns (nil,false,nil);
// invalid, missing or cancelled inputs return an error, never success.
//
// This is a Local-Store-only primitive for a future database-first protocol:
// a caller already holding CAS SQL locks must fail/rollback immediately on
// OS contention instead of waiting while another writer could need SQL.
// It does NOT authorize a SourceItem write, CAS reuse, identity promotion or
// durable backup, and is not registered as a Server/API/Agent operation.
func (l *Local) TryOpenPinnedCAS(
	ctx context.Context, key string,
) (PinnedCASFile, bool, error) {
	hash, ok := canonicalCASDigest(key)
	if !ok {
		return nil, false, fmt.Errorf("canonical CAS key required")
	}
	release, acquired, err := l.casLifecycleLeaseMode(ctx, hash, false, true)
	if err != nil || !acquired {
		return nil, false, err
	}
	file, err := l.openPinnedCASWithLease(ctx, key, release)
	if err != nil {
		return nil, false, err
	}
	return file, true, nil
}
