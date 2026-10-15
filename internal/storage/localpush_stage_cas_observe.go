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

// localPushPhysicalObservationMaxBytes is the temporary staging protocol's
// 64-MiB one-object limit, not an upload/chunking or cloud quota limit.
const localPushPhysicalObservationMaxBytes int64 = 64 << 20

// ObserveMatchingLocalPushStageAndCAS independently hashes BOTH physical
// handles while holding the two cooperative OS read leases established by
// F2d3. CAS is pinned first, then private staging, using nonblocking tries.
// Busy admission is (false,nil), and any mismatch/error/cancellation is
// (false,error). Every path closes BOTH handles before returning.
//
// A true result means only that these two local handles matched the claimed
// SHA256/size at the instant of this bounded observation. It is NEVER a
// durable witness, Source/Root/device authorization, SQL/CAS refcount,
// backup commit, run success, deletion evidence or permission to activate
// local_folder. The eventual owning-Agent writer must independently repeat
// physical and authenticated transaction checks at the real commit boundary.
func (l *Local) ObserveMatchingLocalPushStageAndCAS(
	ctx context.Context, stageKey, casKey string, expectedSize int64,
) (matched bool, err error) {
	if ctx == nil {
		return false, fmt.Errorf("private paired observation requires context")
	}
	if expectedSize < 0 || expectedSize > localPushPhysicalObservationMaxBytes {
		return false, fmt.Errorf("private paired observation size outside staging bound")
	}
	digest, valid := canonicalCASDigest(casKey)
	if !valid {
		return false, fmt.Errorf("canonical CAS key required")
	}
	if err := ctx.Err(); err != nil {
		return false, err
	}
	pair, acquired, err := l.TryOpenPinnedLocalPushStageAndCAS(ctx, stageKey, casKey)
	if err != nil || !acquired {
		return false, err
	}
	defer func() {
		if closeErr := pair.Close(); closeErr != nil {
			matched = false
			err = errors.Join(err, fmt.Errorf("private paired observation close: %w", closeErr))
		}
	}()

	firstStage, firstCAS, err := pair.Stat()
	if err != nil {
		return false, err
	}
	if err = l.checkLocalPushPinnedPhysicalIdentity(stageKey, pair.stage, firstStage, expectedSize); err != nil {
		return false, err
	}
	if err = l.checkLocalPushPinnedPhysicalIdentity(casKey, pair.cas, firstCAS, expectedSize); err != nil {
		return false, err
	}
	if err = hashLocalPushPinnedExact(ctx, pair.StageReader(), expectedSize, digest); err != nil {
		return false, err
	}
	if err = hashLocalPushPinnedExact(ctx, pair.CASReader(), expectedSize, digest); err != nil {
		return false, err
	}
	if err = l.checkLocalPushPinnedPhysicalIdentity(stageKey, pair.stage, firstStage, expectedSize); err != nil {
		return false, err
	}
	if err = l.checkLocalPushPinnedPhysicalIdentity(casKey, pair.cas, firstCAS, expectedSize); err != nil {
		return false, err
	}
	if err = ctx.Err(); err != nil {
		return false, err
	}
	return true, nil
}

// Recheck BOTH the opened inode and its canonical pathname. The cooperative
// shard locks prevent xDrive Store writes, not out-of-band filesystem writes;
// those require independent hashing and size/mtime/identity revalidation.
func (l *Local) checkLocalPushPinnedPhysicalIdentity(
	key string, opened PinnedCASFile, first os.FileInfo, expectedSize int64,
) error {
	if first == nil || !first.Mode().IsRegular() || first.Size() != expectedSize {
		return fmt.Errorf("private paired observation invalid original inode")
	}
	full, err := l.resolve(key)
	if err != nil {
		return err
	}
	pathInfo, err := os.Lstat(full)
	if err != nil {
		return err
	}
	openedNow, err := opened.Stat()
	if err != nil {
		return err
	}
	if !pathInfo.Mode().IsRegular() || !openedNow.Mode().IsRegular() ||
		openedNow.Size() != expectedSize || pathInfo.Size() != expectedSize ||
		!os.SameFile(first, openedNow) || !os.SameFile(first, pathInfo) ||
		!first.ModTime().Equal(openedNow.ModTime()) ||
		!first.ModTime().Equal(pathInfo.ModTime()) {
		return fmt.Errorf("private paired observation inode or metadata changed")
	}
	return nil
}

// Limit reads to at most expectedSize+1, so an unexpected extra byte fails
// without unlimited reads or whole-file buffering. copyWithContext uses a
// bounded 128-KiB buffer, and the caller enforces the <=64-MiB stage limit.
func hashLocalPushPinnedExact(ctx context.Context, r io.Reader, expectedSize int64, digest string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	h := sha256.New()
	n, err := copyWithContext(ctx, h, io.LimitReader(r, expectedSize+1))
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if n != expectedSize || hex.EncodeToString(h.Sum(nil)) != digest {
		return fmt.Errorf("private paired observation physical SHA256 or size mismatch")
	}
	return nil
}
