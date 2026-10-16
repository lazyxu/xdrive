package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
)

// InspectPinnedLocalPushHistoricalCAS verifies a canonical, already-committed
// CAS file without assuming that the replaceable private Stage still exists.
// It takes one nonblocking shared CAS-shard OS lease, verifies canonical
// pathname/inode/mtime/size and hashes the actual bytes BEFORE and AFTER
// a read-only callback. The cooperating CAS file cannot be deleted/replaced
// until that callback and its second verification finish.
//
// The caller MUST first hold its owning-device and SQL CAS-hash locks.
// Never acquire a blocking PostgreSQL lock inside a callback that was
// entered without the preexisting lock order. Busy returns (false,nil).
// This is an ephemeral physical observation, NOT native-source provenance,
// durability through crash/GC, an upload receipt or backup completion.
func (l *Local) InspectPinnedLocalPushHistoricalCAS(
	ctx context.Context, casKey string, expectedSize int64,
	inspect func(context.Context) error,
) (matched bool, resultErr error) {
	if l == nil || ctx == nil || inspect == nil ||
		expectedSize < 0 || expectedSize > localPushPhysicalObservationMaxBytes {
		return false, fmt.Errorf("invalid historical local Push CAS inspection")
	}
	digest, canonical := canonicalCASDigest(casKey)
	if !canonical {
		return false, fmt.Errorf("canonical CAS key required")
	}
	if err := ctx.Err(); err != nil {
		return false, err
	}
	pin, acquired, err := l.TryOpenPinnedCAS(ctx, casKey)
	if err != nil || !acquired {
		return false, err
	}
	defer func() {
		if closeErr := pin.Close(); closeErr != nil {
			matched = false
			resultErr = errors.Join(resultErr, fmt.Errorf("close historical CAS pin: %w", closeErr))
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
	if err := verify(); err != nil {
		return false, err
	}
	if err := inspect(ctx); err != nil {
		return false, err
	}
	if err := verify(); err != nil {
		return false, err
	}
	return true, nil
}
