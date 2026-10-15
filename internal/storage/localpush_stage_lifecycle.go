package storage

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"github.com/google/uuid"
)

// LocalPushStageLifecycleLockDir holds 256 persistent per-prefix lock files.
// The fixed lock inode must never be deleted: all cooperating Server replicas
// must see the same OS lock. It is not a staging payload or a backup receipt.
const LocalPushStageLifecycleLockDir = ".xdrive-localpush-stage-locks"

// localPushStageShard admits ONLY the canonical private temporary stage key.
// Noncanonical spellings that resolve to the managed stage namespace must
// never bypass the cross-process writer/reader lock on Windows or Linux.
func localPushStageShard(key string) (string, bool, error) {
	canonical := filepath.ToSlash(filepath.Clean(filepath.FromSlash(key)))
	prefix := UploadStagingDir + "/localpush/"
	if !strings.HasPrefix(canonical, prefix) {
		// Windows case-insensitive path aliases must not address the SAME
		// physical stage without the exclusive lifecycle lease. Reject a
		// differently cased managed prefix rather than treating it as a
		// completely unrelated non-stage object.
		if runtime.GOOS == "windows" && len(canonical) >= len(prefix) &&
			strings.EqualFold(canonical[:len(prefix)], prefix) {
			return "", true, fmt.Errorf("noncanonical private local Push stage path case")
		}
		return "", false, nil
	}
	if canonical != key || !strings.HasSuffix(key, ".part") {
		return "", true, fmt.Errorf("noncanonical private local Push stage")
	}
	id := strings.TrimSuffix(strings.TrimPrefix(key, prefix), ".part")
	parsed, err := uuid.Parse(id)
	if err != nil || parsed.String() != id {
		return "", true, fmt.Errorf("invalid private local Push stage ID")
	}
	// Domain-separate these fixed shards from the canonical CAS lock files.
	hash := sha256.Sum256([]byte("xdrive-localpush-stage:" + id))
	return fmt.Sprintf("%02x.lock", hash[0]), true, nil
}

func (l *Local) localPushStageShardLease(ctx context.Context, shard string, exclusive bool) (func(), error) {
	if l == nil || l.root == "" || ctx == nil || len(shard) != len("00.lock") {
		return nil, fmt.Errorf("private stage lifecycle scope unavailable")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	dir := filepath.Join(l.root, LocalPushStageLifecycleLockDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(filepath.Join(dir, shard), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	acquired, err := lockTempLifecycleFile(ctx, file, exclusive, false)
	if err != nil || !acquired {
		_ = file.Close()
		if err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("private stage lifecycle lease not acquired")
	}
	return func() { _ = unlockTempLifecycleFile(file); _ = file.Close() }, nil
}

// localPushStageWriteLeases always locks distinct stage shards in sorted order.
// It is used by the actual Local.Put/Delete/Promote/DeleteStaging paths, not
// solely by the preflight reader. Local.Put acquires its global shared temp
// lifecycle lease FIRST, so janitor holding the exclusive temp lease cannot
// deadlock with a stage writer; Promote acquires target CAS before stage.
func (l *Local) localPushStageWriteLeases(ctx context.Context, keys ...string) (func(), error) {
	shards := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		shard, managed, err := localPushStageShard(key)
		if err != nil {
			return nil, err
		}
		if managed {
			shards[shard] = struct{}{}
		}
	}
	ordered := make([]string, 0, len(shards))
	for shard := range shards {
		ordered = append(ordered, shard)
	}
	sort.Strings(ordered)
	releases := make([]func(), 0, len(ordered))
	releaseAll := func() {
		for i := len(releases) - 1; i >= 0; i-- {
			releases[i]()
		}
	}
	for _, shard := range ordered {
		release, err := l.localPushStageShardLease(ctx, shard, true)
		if err != nil {
			releaseAll()
			return nil, err
		}
		releases = append(releases, release)
	}
	return releaseAll, nil
}

// OpenPinnedLocalPushStage holds a shared OS stage-shard lease until Close.
// Cooperating Local.Put/Delete/Promote/DeleteStaging cannot replace/delete
// these TEMPORARY bytes while pinned. Out-of-band filesystem mutation is NOT
// fenced; callers must hash/revalidate the physical handle independently.
// This is not an immutable canonical CAS lease, a Server writer ticket,
// or a token authorizing File/Node/SourceItem/SourceRun mutation.
func (l *Local) OpenPinnedLocalPushStage(ctx context.Context, key string) (PinnedCASFile, error) {
	shard, managed, err := localPushStageShard(key)
	if err != nil || !managed {
		return nil, fmt.Errorf("canonical private stage key required")
	}
	release, err := l.localPushStageShardLease(ctx, shard, false)
	if err != nil {
		return nil, err
	}
	full, err := l.resolve(key)
	if err != nil {
		release()
		return nil, err
	}
	before, err := os.Lstat(full)
	if err != nil {
		release()
		return nil, err
	}
	if !before.Mode().IsRegular() {
		release()
		return nil, fmt.Errorf("nonregular private temporary stage")
	}
	pinned, err := l.openPinnedCASWithLease(ctx, key, release)
	if err != nil {
		return nil, err
	}
	opened, err := pinned.Stat()
	if err != nil || !opened.Mode().IsRegular() || !os.SameFile(before, opened) {
		_ = pinned.Close()
		return nil, fmt.Errorf("temporary stage changed during pin admission")
	}
	return pinned, nil
}
