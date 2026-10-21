package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
)

// ErrLocalPushCASPrecommitOutcomeUncertain means the commit callback has been
// entered and may have durably committed. A caller MUST inspect the original
// immutable operation before any retry, cancel, key/Stage retirement or new
// generation. The sentinel never implies a physical CANCEL or failed COMMIT.
var ErrLocalPushCASPrecommitOutcomeUncertain = errors.New("local Push CAS precommit outcome uncertain")

// ErrLocalPushCASPrecommitBusy means the cooperating physical CAS shard
// could not be acquired WITHOUT waiting under an already-held SQL CAS lock.
// No callback was entered, so this is never a terminal COMMIT observation.
var ErrLocalPushCASPrecommitBusy = errors.New("local Push CAS precommit shard busy")

// InspectPinnedLocalPushHistoricalCASBeforeCommit provides a private physical
// CAS window for a FUTURE original-operation terminal transaction. Unlike the
// read-only historical inspector, it independently hashes the pinned CAS twice
// BEFORE invoking the supplied callback, then again before returning, with
// the same nonblocking shared CAS-shard lock and original descriptor held.
//
// The caller must already hold Owner/Device/Source/Root/Operation and CAS SQL
// locks, and independently verify the original native file. The callback MAY
// have durably committed when it returns an error or a post-check fails: the
// outcome is then UNCERTAIN, never evidence of physical cancellation or a
// license to retry or retire a key/Stage. This helper performs NO SQL writes,
// Agent admission, native-file attestation, routing, or backup completion.
func (l *Local) InspectPinnedLocalPushHistoricalCASBeforeCommit(
	ctx context.Context, casKey string, expectedSize int64,
	commit func(context.Context) error,
) (matched bool, resultErr error) {
	if l == nil || ctx == nil || commit == nil ||
		expectedSize < 0 || expectedSize > localPushPhysicalObservationMaxBytes {
		return false, fmt.Errorf("invalid local Push physical precommit scope")
	}
	digest, canonical := canonicalCASDigest(casKey)
	if !canonical {
		return false, fmt.Errorf("canonical CAS key required")
	}
	if err := ctx.Err(); err != nil {
		return false, err
	}
	pin, acquired, err := l.TryOpenPinnedCAS(ctx, casKey)
	if err != nil {
		return false, err
	}
	if !acquired {
		return false, ErrLocalPushCASPrecommitBusy
	}
	callbackEntered := false
	defer func() {
		if closeErr := pin.Close(); closeErr != nil {
			matched = false
			resultErr = errors.Join(resultErr, fmt.Errorf("close historical precommit CAS pin: %w", closeErr))
		}
		// After callback entry an error might hide a durable SQL COMMIT.
		// Preserve the original cause, but make the uncertainty machine-checkable.
		// Before callback entry failure never carries this sentinel.
		if callbackEntered && resultErr != nil {
			matched = false
			resultErr = errors.Join(ErrLocalPushCASPrecommitOutcomeUncertain, resultErr)
		}
	}()
	first, err := pin.Stat()
	if err != nil {
		return false, err
	}
	verify := func() error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := l.checkLocalPushPinnedPhysicalIdentity(casKey, pin, first, expectedSize); err != nil {
			return err
		}
		seeker, ok := pin.(io.Seeker)
		if !ok {
			return fmt.Errorf("pinned canonical CAS cannot be rewound")
		}
		if _, err := seeker.Seek(0, io.SeekStart); err != nil {
			return err
		}
		if err := hashLocalPushPinnedExact(ctx, pin, expectedSize, digest); err != nil {
			return err
		}
		if err := l.checkLocalPushPinnedPhysicalIdentity(casKey, pin, first, expectedSize); err != nil {
			return err
		}
		return ctx.Err()
	}
	// Both complete physical checks precede any callback that could COMMIT.
	// Do not rely on an HTTP ACK, an expired lease or an idle local writer.
	if err := verify(); err != nil {
		return false, err
	}
	if err := verify(); err != nil {
		return false, err
	}
	callbackEntered = true
	if err := commit(ctx); err != nil {
		return false, err
	}
	// Post-check failures do not roll back an already committed callback.
	// A future caller must reconcile the ORIGINAL operation before retrying.
	if err := verify(); err != nil {
		return false, err
	}
	return true, nil
}
