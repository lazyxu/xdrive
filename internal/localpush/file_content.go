package localpush

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	sourcepkg "github.com/lazyxu/xdrive/internal/source"
)

const localFileHashBufferSize = 256 << 10

// VerifiedInventoryFileDigest is only a local pre-upload content observation.
// The digest is NOT a SourceRun commit, a SourceItem identity or permission
// to upload: the eventual upload must read/verify its own authenticated bytes.
type VerifiedInventoryFileDigest struct {
	Path              string `json:"path"`
	Size              int64  `json:"size"`
	SHA256            string `json:"sha256"`
	NativeIdentityKey string `json:"native_identity_key"`
}

// HashVerifiedInventoryFile streams at most 256 KiB per read of one previously
// journaled regular file. A stale inode, symlink, changed size/mtime, replaced
// Root, cancellation, or progress error returns NO trusted content digest.
//
// Only use on locally authorized files after verifying a completed journal.
// This operation neither uploads nor writes a local/remote Source checkpoint.
func HashVerifiedInventoryFile(
	ctx context.Context,
	grant RootGrant,
	item InventoryItem,
	onProgress func(done, total int64) error,
) (VerifiedInventoryFileDigest, error) {
	var empty VerifiedInventoryFileDigest
	if ctx == nil {
		return empty, errors.New("local file hashing context is required")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	if err := VerifyRootGrant(grant); err != nil {
		return empty, err
	}
	relative, err := sourcepkg.NormalizeRelativePath(item.Path)
	if err != nil || relative != item.Path || relative == "" ||
		item.Kind != "file" || item.Ignored || item.Size < 0 ||
		item.ModifiedAt == nil || item.NativeIdentity == nil ||
		len(item.NativeIdentity.Key) != 64 {
		return empty, errors.New("invalid or ignored inventory file for content verification")
	}
	if _, err := hex.DecodeString(item.NativeIdentity.Key); err != nil {
		return empty, errors.New("invalid native identity digest")
	}
	full := filepath.Join(grant.Path, filepath.FromSlash(relative))
	rel, err := filepath.Rel(grant.Path, full)
	if err != nil || rel == "." || rel == ".." ||
		strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return empty, ErrUnsafeRoot
	}
	expected := func(info os.FileInfo) bool {
		return info.Mode().IsRegular() && info.Size() == item.Size &&
			info.ModTime().UTC().Equal(item.ModifiedAt.UTC())
	}
	before, err := os.Lstat(full)
	if err != nil {
		return empty, fmt.Errorf("%w: file unavailable: %v", ErrRootChanged, err)
	}
	if !expected(before) || before.Mode()&os.ModeSymlink != 0 {
		return empty, ErrRootChanged
	}
	nativeBefore, err := readInventoryNativeIdentity(grant.RootID, full, before)
	if err != nil {
		return empty, err
	}
	matchesNative := func(identity *InventoryNativeIdentity) bool {
		return identity != nil && identity.Key == item.NativeIdentity.Key &&
			identity.Strong == item.NativeIdentity.Strong &&
			identity.LinkCount == item.NativeIdentity.LinkCount &&
			identity.RenameCandidate == item.NativeIdentity.RenameCandidate
	}
	if !matchesNative(nativeBefore) {
		return empty, ErrRootChanged
	}
	file, err := openRootScopedRegularFile(grant, relative)
	if err != nil {
		return empty, fmt.Errorf("%w: secure open: %v", ErrRootChanged, err)
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !expected(opened) || !os.SameFile(before, opened) {
		return empty, ErrRootChanged
	}
	digest := sha256.New()
	buf := make([]byte, localFileHashBufferSize)
	var processed int64
	for {
		if err := ctx.Err(); err != nil {
			return empty, err
		}
		n, readErr := file.Read(buf)
		if n > 0 {
			processed += int64(n)
			if processed > item.Size {
				return empty, ErrRootChanged
			}
			if _, err := digest.Write(buf[:n]); err != nil {
				return empty, err
			}
			if onProgress != nil {
				if err := onProgress(processed, item.Size); err != nil {
					return empty, err
				}
			}
		}
		if readErr != nil && !errors.Is(readErr, io.EOF) {
			return empty, fmt.Errorf("read authorized file: %w", readErr)
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if n == 0 {
			return empty, errors.New("authorized file reader made no progress")
		}
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	afterHandle, err := file.Stat()
	if err != nil || processed != item.Size || !expected(afterHandle) ||
		!os.SameFile(opened, afterHandle) {
		return empty, ErrRootChanged
	}
	afterPath, err := os.Lstat(full)
	if err != nil || !expected(afterPath) ||
		afterPath.Mode()&os.ModeSymlink != 0 || !os.SameFile(opened, afterPath) {
		return empty, ErrRootChanged
	}
	nativeAfter, err := readInventoryNativeIdentity(grant.RootID, full, afterPath)
	if err != nil || !matchesNative(nativeAfter) {
		return empty, ErrRootChanged
	}
	if err := VerifyRootGrant(grant); err != nil {
		return empty, err
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	return VerifiedInventoryFileDigest{
		Path: relative, Size: processed, SHA256: hex.EncodeToString(digest.Sum(nil)),
		NativeIdentityKey: item.NativeIdentity.Key,
	}, nil
}
