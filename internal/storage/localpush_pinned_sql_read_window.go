package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
)

// InspectMatchingLocalPushStageAndCASPinned is an internal, READ-ONLY
// lifetime gate. Unlike an ephemeral observation, it keeps the cooperating
// Local Store CAS-first / Stage-second shared OS pins across inspect, allowing
// a caller to finish a bounded, already-open SQL READ transaction before
// those physical files can be replaced by cooperating writers.
//
// The observer MUST NOT mutate SQL, CAS, Source or other durable state. This
// function does not authenticate an Agent, reserve quota or make a backup.
// Admission under SQL locks MUST be nonblocking on both OS locks; busy means
// (false,nil), and no callback runs. A complete physical SHA256 and original
// inode/path check is done before AND after the observer. A malicious writer
// bypassing OS locks is not fenced beyond these checks.
func (l *Local) InspectMatchingLocalPushStageAndCASPinned(
	ctx context.Context, stageKey, casKey string, expectedSize int64,
	inspect func(context.Context) error,
) (matched bool, resultErr error) {
	if l == nil || ctx == nil || inspect == nil ||
		expectedSize < 0 || expectedSize > localPushPhysicalObservationMaxBytes {
		return false, fmt.Errorf("invalid pinned private CAS inspection scope")
	}
	digest, valid := canonicalCASDigest(casKey)
	if !valid {
		return false, fmt.Errorf("canonical private CAS key required")
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
			resultErr = errors.Join(resultErr, fmt.Errorf("pinned CAS pair close: %w", closeErr))
		}
	}()
	firstStage, firstCAS, err := pair.Stat()
	if err != nil {
		return false, err
	}
	rewind := func(r PinnedCASFile) error {
		seeker, ok := r.(io.Seeker)
		if !ok {
			return fmt.Errorf("pinned physical file cannot be rewound")
		}
		_, err := seeker.Seek(0, io.SeekStart)
		return err
	}
	verify := func() error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := l.checkLocalPushPinnedPhysicalIdentity(stageKey, pair.stage, firstStage, expectedSize); err != nil {
			return err
		}
		if err := l.checkLocalPushPinnedPhysicalIdentity(casKey, pair.cas, firstCAS, expectedSize); err != nil {
			return err
		}
		if err := rewind(pair.stage); err != nil {
			return err
		}
		if err := hashLocalPushPinnedExact(ctx, pair.StageReader(), expectedSize, digest); err != nil {
			return err
		}
		if err := rewind(pair.cas); err != nil {
			return err
		}
		if err := hashLocalPushPinnedExact(ctx, pair.CASReader(), expectedSize, digest); err != nil {
			return err
		}
		if err := l.checkLocalPushPinnedPhysicalIdentity(stageKey, pair.stage, firstStage, expectedSize); err != nil {
			return err
		}
		if err := l.checkLocalPushPinnedPhysicalIdentity(casKey, pair.cas, firstCAS, expectedSize); err != nil {
			return err
		}
		return ctx.Err()
	}
	if err := verify(); err != nil {
		return false, err
	}
	if err := inspect(ctx); err != nil {
		return false, err
	}
	// A read-only SQL transaction may have finished inside inspect; the
	// second hash never elevates this into a durable content/commit witness.
	if err := verify(); err != nil {
		return false, err
	}
	return true, nil
}
