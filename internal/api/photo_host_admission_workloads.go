package api

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/lazyxu/xdrive/internal/background"
)

// These leases cover the five existing Photo Intelligence owner tasks and the
// four queued Creative generation kinds. Other model entry points (including
// manual admin canaries and foreground query embedding) are NOT fenced yet;
// no global maintenance stop may be authorized from these partial guards.
func (s *Server) photoHostAdmitTask(ctx context.Context, taskKey string) (*photoHostAdmissionLease, bool, error) {
	lease, allowed, err := tryAcquirePhotoHostAdmission(ctx, s.DB)
	if err != nil || !allowed {
		return nil, false, err
	}
	acquired, err := lease.TryAcquireTask(ctx, taskKey)
	if err != nil || !acquired {
		lease.Close()
		return nil, false, err
	}
	return lease, true, nil
}

func (s *Server) photoHostOwnerAdmissionLeaseProvider(kind string, expectedCancelEpoch uint64) background.LeaseProvider {
	kind = strings.TrimSpace(kind)
	return func(ctx context.Context, descriptor background.Descriptor) (background.Lease, bool, error) {
		if s == nil || descriptor.Scope != background.ScopeUser ||
			descriptor.OwnerID == 0 || kind == "" || !backgroundOwnerCancellableKind(kind) ||
			kind == "media.index" {
			return background.Lease{}, false, errors.New("photo host owner admission unavailable")
		}
		// DB-less mocked runners are only constructed directly in scheduler
		// unit tests; both production StartPhotoIntelligence and its workers
		// require a migrated database. Do not claim a fence for those fixtures.
		if s.DB == nil {
			return s.backgroundOwnerLeaseProvider(kind, expectedCancelEpoch)(ctx, descriptor)
		}
		cancelled, _, err := s.backgroundOwnerCancelledSince(ctx, kind, descriptor.OwnerID, expectedCancelEpoch)
		if err != nil {
			return background.Lease{}, false, err
		}
		if cancelled {
			return background.Lease{}, false, context.Canceled
		}
		lease, accepted, err := s.photoHostAdmitTask(ctx, backgroundOwnerLeaseKey(kind, descriptor.OwnerID))
		if err != nil || !accepted {
			return background.Lease{}, false, err
		}
		epoch, err := lease.OwnerCancelEpoch(ctx, kind, descriptor.OwnerID)
		if err != nil || epoch > expectedCancelEpoch {
			lease.Close()
			if err != nil {
				return background.Lease{}, false, err
			}
			return background.Lease{}, false, context.Canceled
		}
		return background.Lease{
			Heartbeat: func(pulseCtx context.Context) error {
				if err := lease.Heartbeat(pulseCtx); err != nil {
					return err
				}
				epoch, err := lease.OwnerCancelEpoch(pulseCtx, kind, descriptor.OwnerID)
				if err != nil {
					return err
				}
				if epoch > expectedCancelEpoch {
					return context.Canceled
				}
				return nil
			},
			Release: func(context.Context, error) error {
				lease.Close()
				return nil
			},
		}, true, nil
	}
}

func (s *Server) photoHostCreativeAdmissionLeaseProvider(taskKey string) background.LeaseProvider {
	taskKey = strings.TrimSpace(taskKey)
	return func(ctx context.Context, descriptor background.Descriptor) (background.Lease, bool, error) {
		if s == nil || descriptor.Scope != background.ScopeUser ||
			descriptor.OwnerID == 0 || taskKey == "" {
			return background.Lease{}, false, fmt.Errorf("photo creative admission unavailable")
		}
		// Same DB-less unit fixture compatibility as the previous derivative
		// lease. Production queued Creative is PostgreSQL-persisted.
		if s.DB == nil {
			return s.mediaDerivativeLeaseProvider(taskKey)(ctx, descriptor)
		}
		lease, accepted, err := s.photoHostAdmitTask(ctx, mediaDerivativeLeaseKey(taskKey))
		if err != nil || !accepted {
			return background.Lease{}, false, err
		}
		return background.Lease{
			Heartbeat: lease.Heartbeat,
			Release: func(context.Context, error) error {
				lease.Close()
				return nil
			},
		}, true, nil
	}
}
