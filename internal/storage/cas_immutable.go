package storage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
)

// immutableCASPutReader computes the digest of bytes actually consumed by
// Local.Put. Legacy and temporary storage keys retain their old semantics.
func immutableCASPutReader(key string, input io.Reader) (io.Reader, func() error) {
	expected, canonical := canonicalCASDigest(key)
	if !canonical {
		return input, func() error { return nil }
	}
	digest := sha256.New()
	return io.TeeReader(input, digest), func() error {
		if hex.EncodeToString(digest.Sum(nil)) != expected {
			return fmt.Errorf("canonical CAS content does not match its digest")
		}
		return nil
	}
}

// verifyExistingCanonicalCAS checks actual bounded-memory bytes, not only
// filesize or database metadata. It is called under the per-shard exclusive
// lease. Never turn a corrupt existing object into a valid idempotent reuse.
func verifyExistingCanonicalCAS(
	ctx context.Context, path, expectedDigest string, expectedSize int64,
) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !info.Mode().IsRegular() || info.Size() != expectedSize {
		return false, fmt.Errorf("existing canonical CAS content is not a matching regular file")
	}
	file, err := os.Open(path)
	if err != nil {
		return false, err
	}
	defer file.Close()
	openedInfo, err := file.Stat()
	if err != nil {
		return false, err
	}
	if !openedInfo.Mode().IsRegular() || openedInfo.Size() != expectedSize {
		return false, fmt.Errorf("canonical CAS content changed during inspection")
	}
	hasher := sha256.New()
	checked, err := copyWithContext(ctx, hasher, file)
	if err != nil {
		return false, err
	}
	if checked != expectedSize || hex.EncodeToString(hasher.Sum(nil)) != expectedDigest {
		return false, fmt.Errorf("existing canonical CAS content does not match its digest")
	}
	return true, nil
}
