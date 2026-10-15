package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"sync"
)

// LocalPushStageCASPins holds two independent, cooperative Local Store read
// leases. Neither handle is a verified content witness, a CAS reference or a
// ticket to commit a SourceItem. The caller MUST close the pair on every path.
type LocalPushStageCASPins struct {
	stage    PinnedCASFile
	cas      PinnedCASFile
	once     sync.Once
	closeErr error
}

// StageReader and CASReader deliberately expose no Close method; releasing
// one lease while retaining the other would invalidate the paired observation.
func (p *LocalPushStageCASPins) StageReader() io.Reader { return p.stage }
func (p *LocalPushStageCASPins) CASReader() io.Reader   { return p.cas }

func (p *LocalPushStageCASPins) Stat() (stage, cas os.FileInfo, err error) {
	if p == nil {
		return nil, nil, fmt.Errorf("private paired pins unavailable")
	}
	stage, err = p.stage.Stat()
	if err != nil {
		return nil, nil, err
	}
	cas, err = p.cas.Stat()
	return stage, cas, err
}

func (p *LocalPushStageCASPins) Close() error {
	if p == nil {
		return nil
	}
	p.once.Do(func() {
		// Reverse acquisition order: stage OS shard before canonical CAS shard.
		p.closeErr = errors.Join(p.stage.Close(), p.cas.Close())
	})
	return p.closeErr
}

// TryOpenPinnedLocalPushStageAndCAS admits an exact private staging UUID and
// an exact canonical SHA256 CAS key as ONE nonblocking read pair. It takes the
// CAS shared shard FIRST (matching Local.Promote) and stage shard SECOND.
// Both acquisitions are try-only: a conflicting Local writer must never cause
// a wait while a future caller holds SQL hash/Source locks. If either attempt
// fails, the first acquired handle is closed before returning no pair.
//
// This storage-only primitive does NOT verify physical content hashes, device
// credentials, Root/revision, quotas or SQL consistency; a caller MUST never
// treat it as authorization to publish files, start a run or infer deletions.
func (l *Local) TryOpenPinnedLocalPushStageAndCAS(
	ctx context.Context, stageKey, casKey string,
) (*LocalPushStageCASPins, bool, error) {
	if ctx == nil {
		return nil, false, fmt.Errorf("private paired pin requires context")
	}
	if _, managed, err := localPushStageShard(stageKey); err != nil || !managed {
		return nil, false, fmt.Errorf("canonical private stage key required")
	}
	if _, valid := canonicalCASDigest(casKey); !valid {
		return nil, false, fmt.Errorf("canonical CAS key required")
	}
	if err := ctx.Err(); err != nil {
		return nil, false, err
	}

	casPin, acquired, err := l.TryOpenPinnedCAS(ctx, casKey)
	if err != nil || !acquired {
		return nil, false, err
	}
	// The ordinary CAS try-pin promises a stable open handle, not necessarily
	// a regular, non-symlink canonical path. Tighten that admission for this
	// staged/canonical pair without changing the existing CAS interface.
	full, err := l.resolve(casKey)
	if err != nil {
		return nil, false, errors.Join(err, casPin.Close())
	}
	before, err := os.Lstat(full)
	if err != nil {
		return nil, false, errors.Join(err, casPin.Close())
	}
	opened, statErr := casPin.Stat()
	if statErr != nil || !before.Mode().IsRegular() || opened == nil ||
		!opened.Mode().IsRegular() || !os.SameFile(before, opened) {
		return nil, false, errors.Join(fmt.Errorf("nonregular or changed canonical CAS pin"), statErr, casPin.Close())
	}

	stagePin, acquired, err := l.TryOpenPinnedLocalPushStage(ctx, stageKey)
	if err != nil || !acquired {
		return nil, false, errors.Join(err, casPin.Close())
	}
	if err := ctx.Err(); err != nil {
		return nil, false, errors.Join(err, stagePin.Close(), casPin.Close())
	}
	return &LocalPushStageCASPins{stage: stagePin, cas: casPin}, true, nil
}
