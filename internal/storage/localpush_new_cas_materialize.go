package storage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

const localPushNewCASMaxBytes int64 = 64 << 20

// MaterializeLocalPushStageCAS prepares ONE physical canonical CAS object from
// an already existing private UUID stage. CAS exclusive, global temporary
// shared, then stage shared locks are acquired with nonblocking attempts, in
// the same order as cooperating Put/Promote/cleanup actors. Contention returns
// (false,false,nil); (false,true,nil) means an existing CAS matched its bytes;
// (true,true,nil) means this call linked a newly verified physical CAS inode.
//
// This is deliberately storage-only. The stage is NEVER moved or deleted.
// Physical CAS presence can be orphaned on a crash and is NOT a durable SQL
// reference, SourceItem, quota charge, native Root attestation or backup. Do
// not use this as a commit receipt, or call under an SQL CAS advisory lock.
func (l *Local) MaterializeLocalPushStageCAS(
	ctx context.Context, stageKey, casKey string, expectedSize int64,
) (created, admitted bool, resultErr error) {
	if l == nil || ctx == nil || expectedSize < 0 || expectedSize > localPushNewCASMaxBytes {
		return false, false, fmt.Errorf("invalid private CAS materialization scope")
	}
	hash, canonical := canonicalCASDigest(casKey)
	_, managed, stageErr := localPushStageShard(stageKey)
	if !canonical || stageErr != nil || !managed {
		return false, false, fmt.Errorf("canonical CAS and private stage keys required")
	}
	readCtx, stop := context.WithTimeout(ctx, 90*time.Second)
	defer stop()
	if err := readCtx.Err(); err != nil {
		return false, false, err
	}

	releaseCAS, locked, err := l.casLifecycleLeaseMode(readCtx, hash, true, true)
	if err != nil || !locked {
		return false, false, err
	}
	defer releaseCAS()
	// The global temp lock prevents administrative cleanup from removing
	// this still-in-progress atomic temporary file. Never wait under CAS.
	releaseTemp, locked, err := l.tempLifecycleLease(readCtx, false, true)
	if err != nil || !locked {
		return false, false, err
	}
	defer releaseTemp()
	stage, locked, err := l.TryOpenPinnedLocalPushStage(readCtx, stageKey)
	if err != nil || !locked {
		return false, false, err
	}
	defer func() {
		if closeErr := stage.Close(); closeErr != nil {
			created, admitted = false, false
			resultErr = errors.Join(resultErr, closeErr)
		}
	}()

	stagePath, err := l.resolve(stageKey)
	if err != nil {
		return false, false, err
	}
	before, err := os.Lstat(stagePath)
	if err != nil {
		return false, false, err
	}
	if err := checkLocalPushStagedOriginal(stagePath, stage, before, expectedSize); err != nil {
		return false, false, err
	}
	casDir, err := l.ensurePrivateCanonicalCASDir(hash)
	if err != nil {
		return false, false, err
	}
	casPath := filepath.Join(casDir, hash)
	tmp, err := os.CreateTemp(casDir, ".xdrive-upload-*")
	if err != nil {
		return false, false, err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	tempOpen := true
	defer func() {
		if tempOpen {
			_ = tmp.Close()
		}
	}()

	// A private stage cannot select an arbitrary CAS digest: the complete
	// streamed original MUST independently match the canonical digest key.
	digest := sha256.New()
	written, err := copyWithContext(readCtx, io.MultiWriter(tmp, digest),
		io.LimitReader(stage, expectedSize+1))
	if err != nil {
		return false, false, err
	}
	if written != expectedSize || hex.EncodeToString(digest.Sum(nil)) != hash {
		return false, false, fmt.Errorf("private staged original SHA256 or size mismatch")
	}
	if err := checkLocalPushStagedOriginal(stagePath, stage, before, expectedSize); err != nil {
		return false, false, err
	}
	if err := readCtx.Err(); err != nil {
		return false, false, err
	}
	if err := tmp.Sync(); err != nil {
		return false, false, err
	}
	if err := tmp.Close(); err != nil {
		tempOpen = false
		return false, false, err
	}
	tempOpen = false

	// Never replace an existing canonical inode. Validate its real bytes
	// under the exclusive CAS shard before treating it as reusable.
	exists, err := verifyExistingCanonicalCAS(readCtx, casPath, hash, expectedSize)
	if err != nil {
		return false, false, err
	}
	if exists {
		return false, true, nil
	}
	if err := readCtx.Err(); err != nil {
		return false, false, err
	}
	// Hard-linking a fully fsynced same-directory temp is create-only and
	// atomic. An ordinary Rename here could overwrite a concurrently created
	// canonical object; on filesystems without hard links, fail closed.
	if err := os.Link(tmpPath, casPath); err != nil {
		if errors.Is(err, os.ErrExist) {
			exists, checkErr := verifyExistingCanonicalCAS(readCtx, casPath, hash, expectedSize)
			if checkErr == nil && exists {
				return false, true, nil
			}
			if checkErr != nil {
				return false, false, checkErr
			}
		}
		return false, false, err
	}
	// If this request was canceled after publication, best-effort remove
	// ONLY our new link while still holding the exclusive CAS shard.
	if err := readCtx.Err(); err != nil {
		return false, false, errors.Join(err, os.Remove(casPath))
	}
	tmpInfo, err := os.Lstat(tmpPath)
	if err != nil {
		return false, false, err
	}
	targetInfo, err := os.Lstat(casPath)
	if err != nil || !targetInfo.Mode().IsRegular() || !os.SameFile(tmpInfo, targetInfo) ||
		targetInfo.Size() != expectedSize {
		return false, false, errors.Join(err, fmt.Errorf("canonical CAS publication inode changed"))
	}
	return true, true, nil
}

// Exact, non-symlink directories only. All derived names are fixed or come
// from an already validated lowercase SHA256; no caller path is walked here.
func (l *Local) ensurePrivateCanonicalCASDir(hash string) (string, error) {
	dir := l.root
	for _, name := range []string{ContentBlobDir, "sha256", hash[:2]} {
		dir = filepath.Join(dir, name)
		if err := os.Mkdir(dir, 0o750); err != nil && !errors.Is(err, os.ErrExist) {
			return "", err
		}
		info, err := os.Lstat(dir)
		if err != nil {
			return "", err
		}
		if !info.IsDir() {
			return "", fmt.Errorf("non-directory canonical CAS storage ancestor")
		}
	}
	return dir, nil
}

func checkLocalPushStagedOriginal(
	path string, stage PinnedCASFile, first os.FileInfo, expectedSize int64,
) error {
	if first == nil || !first.Mode().IsRegular() || first.Size() != expectedSize {
		return fmt.Errorf("invalid private stage inode or size")
	}
	named, err := os.Lstat(path)
	if err != nil {
		return err
	}
	opened, err := stage.Stat()
	if err != nil {
		return err
	}
	if !named.Mode().IsRegular() || !opened.Mode().IsRegular() ||
		named.Size() != expectedSize || opened.Size() != expectedSize ||
		!os.SameFile(first, named) || !os.SameFile(first, opened) ||
		!first.ModTime().Equal(named.ModTime()) ||
		!first.ModTime().Equal(opened.ModTime()) {
		return fmt.Errorf("private stage identity changed during CAS materialization")
	}
	return nil
}
