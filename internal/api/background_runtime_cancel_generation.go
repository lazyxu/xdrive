package api

import (
	"context"
	"errors"

	"github.com/lazyxu/xdrive/internal/background"
)

func (s *Server) prepareBackgroundRuntimeGeneration(
	ctx context.Context,
	ownerID uint64,
	kind string,
	submittedCancelEpoch uint64,
) error {
	requested, applied, err := s.backgroundRuntimeCancelEpoch(
		ctx,
		ownerID,
		kind,
	)
	if err != nil {
		return err
	}
	if requested > submittedCancelEpoch {
		if requested > applied {
			if err := s.finalizeBackgroundRuntimeCancellation(
				ctx,
				ownerID,
				kind,
			); err != nil {
				return err
			}
		}
		return background.ErrCancelRequested
	}
	if requested > applied {
		return s.finalizeBackgroundRuntimeCancellation(
			ctx,
			ownerID,
			kind,
		)
	}
	return nil
}

func backgroundRuntimeRunError(
	ctx context.Context,
	runErr error,
) error {
	if ctx != nil {
		if cause := context.Cause(ctx); cause != nil &&
			errors.Is(cause, background.ErrCancelRequested) {
			return background.ErrCancelRequested
		}
	}
	return runErr
}

func (s *Server) finalizeBackgroundRuntimeCancellationAfterRun(
	ownerID uint64,
	kind string,
) error {
	ctx, cancel := context.WithTimeout(
		context.Background(),
		backgroundRuntimeCancelFinalizeTimeout,
	)
	defer cancel()
	return s.finalizeBackgroundRuntimeCancellation(
		ctx,
		ownerID,
		kind,
	)
}

func (s *Server) cancelLocalRuntimeTaskGroup(
	ref backgroundTaskRef,
	cause error,
) bool {
	if s == nil || s.BackgroundScheduler == nil {
		return false
	}
	ownerID := ref.ownerID
	snapshots := s.BackgroundScheduler.TaskSnapshots(&ownerID)
	keys := make(map[string]struct{})
	identities := make([]background.Identity, 0)
	for _, snapshot := range snapshots {
		if snapshot.Identity.Scope != ref.scope ||
			snapshot.Identity.OwnerID != ref.ownerID ||
			snapshot.Kind != ref.kind {
			continue
		}
		keys[snapshot.Identity.Key] = struct{}{}
		identities = append(identities, snapshot.Identity)
	}
	if len(identities) == 0 {
		return false
	}
	s.invalidateRuntimeOwnerStateForCancel(ref, keys)
	cancelled := false
	for _, identity := range identities {
		if s.BackgroundScheduler.CancelWithCause(identity, cause) {
			cancelled = true
		}
	}
	return cancelled
}
