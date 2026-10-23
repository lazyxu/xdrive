//go:build linux || windows

package localpush

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sync"
)

// CommonBatchRunLease is a re-acquirable *local* OS kernel mutex for one
// Source/Device/Root. It is NOT a remote CANCEL, UploadSession retirement,
// committed SQL proof or authorization to delete a backup file.
type CommonBatchRunLease struct {
	mu   sync.Mutex
	file *os.File
}

func (l *CommonBatchRunLease) Close() error {
	if l == nil {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.file == nil {
		return nil
	}
	f := l.file
	l.file = nil
	unlockErr := unlockCommonBatchRun(f)
	closeErr := f.Close()
	if unlockErr != nil || closeErr != nil {
		return ErrCommonUploadPlanQuarantined
	}
	return nil
}

// AcquireVerifiedCommonBatchRunLease provides a single OS-level executor
// across Agent processes, while original per-file Operation journals remain
// durable after a process crash. The lock marker stays on disk permanently;
// only the kernel lock is released. No lock acquisition touches Server CAS.
func AcquireVerifiedCommonBatchRunLease(ctx context.Context,
	configDir string, grant RootGrant,
) (*CommonBatchRunLease, error) {
	deny := ErrCommonUploadPlanQuarantined
	if ctx == nil || ctx.Err() != nil || !grant.StrongIdentity {
		return nil, deny
	}
	persisted, err := LoadRootGrant(configDir, grant.Server, grant.Account, grant.RootID)
	if err != nil || !sameLocalIdentityRoot(persisted, grant) {
		return nil, deny
	}
	dir, err := commonUploadPlanJournalDir(configDir, grant)
	if err != nil {
		return nil, deny
	}
	name := filepath.Join(dir, "source-batch.lock")
	before, statErr := os.Lstat(name)
	if statErr == nil {
		if !before.Mode().IsRegular() || before.Mode()&os.ModeSymlink != 0 ||
			(runtime.GOOS != "windows" && before.Mode().Perm()&0o077 != 0) {
			return nil, deny
		}
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return nil, deny
	}
	f, err := os.OpenFile(name, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return nil, deny
	}
	lease := &CommonBatchRunLease{file: f}
	fail := func() (*CommonBatchRunLease, error) {
		_ = lease.Close()
		return nil, deny
	}
	after, err := os.Lstat(name)
	opened, openErr := f.Stat()
	if err != nil || openErr != nil || !after.Mode().IsRegular() ||
		after.Mode()&os.ModeSymlink != 0 || !os.SameFile(after, opened) ||
		(runtime.GOOS != "windows" && after.Mode().Perm()&0o077 != 0) ||
		(before != nil && !os.SameFile(before, opened)) {
		return fail()
	}
	if err := lockCommonBatchRun(f); err != nil {
		return fail()
	}
	if ctx.Err() != nil {
		return fail()
	}
	current, err := LoadRootGrant(configDir, grant.Server, grant.Account, grant.RootID)
	if err != nil || !sameLocalIdentityRoot(current, grant) {
		return fail()
	}
	return lease, nil
}
