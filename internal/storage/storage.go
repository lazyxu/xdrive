package storage

import (
	"context"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
)

const ContentBlobDir = ".xdrive-blobs"

func ContentAddressedKey(sha256 string) (string, error) {
	hash := strings.ToLower(strings.TrimSpace(sha256))
	if len(hash) != 64 {
		return "", fmt.Errorf("invalid sha256")
	}
	if _, err := hex.DecodeString(hash); err != nil {
		return "", fmt.Errorf("invalid sha256")
	}
	return ContentBlobDir + "/sha256/" + hash[:2] + "/" + hash, nil
}

func IsContentAddressedKey(key string) bool {
	_, ok := ContentHashFromKey(key)
	return ok
}

func ContentHashFromKey(key string) (string, bool) {
	key = strings.TrimSpace(key)
	prefix := ContentBlobDir + "/sha256/"
	if !strings.HasPrefix(key, prefix) {
		return "", false
	}
	parts := strings.Split(strings.TrimPrefix(key, prefix), "/")
	if len(parts) != 2 || len(parts[0]) != 2 || len(parts[1]) != 64 || parts[0] != parts[1][:2] {
		return "", false
	}
	hash := strings.ToLower(parts[1])
	if _, err := hex.DecodeString(hash); err != nil {
		return "", false
	}
	return hash, true
}

type Store interface {
	Put(ctx context.Context, key string, r io.Reader) (int64, error)
	Open(ctx context.Context, key string) (*os.File, error)
	Delete(ctx context.Context, key string) error
}

// PinnedCASFile holds an OS-level shared content lifecycle lock until Close.
// The handle remains stable during a bounded physical CAS hash; it is NOT a
// durable CAS reference, a backup checkpoint or an identity commit token.
type PinnedCASFile interface {
	io.ReadCloser
	Stat() (os.FileInfo, error)
}

// CASReadLeaseProvider is optional. The Local storage backend implements it
// alongside exclusive fencing of canonical CAS Put/Promote/Delete. Backends
// without this capability retain their existing EPHEMERAL read behavior;
// callers must not infer a durable content pin from a normal Store.Open.
type CASReadLeaseProvider interface {
	OpenPinnedCAS(context.Context, string) (PinnedCASFile, error)
}

type ObjectStat struct {
	Size       int64
	ModifiedAt time.Time
}

// ObjectStatProvider exposes metadata-only lookup for backends that can inspect
// a stored object without opening a readable payload handle.
type ObjectStatProvider interface {
	Stat(context.Context, string) (ObjectStat, error)
}

type Capacity struct {
	TotalBytes     int64
	AvailableBytes int64
}

type CapacityReporter interface {
	Capacity(context.Context) (Capacity, error)
}

// FilesystemRootProvider exposes a read-only local filesystem root to internal
// maintenance code that must validate xDrive-managed cache files by path.
// Backends without a filesystem root intentionally do not implement it.
type FilesystemRootProvider interface {
	FilesystemRoot() string
}

type ContentPromoter interface {
	Promote(context.Context, string, string, int64) error
}

type StagingFile struct {
	Key        string
	Size       int64
	ModifiedAt time.Time
}

type StagingInspector interface {
	ListStaging(context.Context) ([]StagingFile, error)
	DeleteStaging(context.Context, string) error
}

// StagingWalker streams staging files in ascending lexical key order.
// Implementations must stop promptly when the visitor returns an error.
type StagingWalker interface {
	WalkStaging(context.Context, func(StagingFile) error) error
}

type ManagedFile struct {
	Key        string
	Size       int64
	ModifiedAt time.Time
}

type ManagedFileWalker interface {
	WalkManagedFiles(context.Context, func(ManagedFile) error) error
}

// ManagedTempCleanupLocker fences aged atomic-temporary-file deletion against
// live Local.Put writers, including writers in another process using the same
// filesystem. A busy lease means skip those files without waiting.
type ManagedTempCleanupLocker interface {
	TryExclusiveTempCleanup(context.Context) (release func(), acquired bool, err error)
}
