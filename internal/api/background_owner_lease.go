package api

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/sourceaccount"
)

const backgroundOwnerLeaseHeartbeatInterval = 5 * time.Second

func backgroundOwnerLeaseKey(kind string, ownerID uint64) string {
	return fmt.Sprintf(
		"background-owner:v1:%s:%d",
		strings.TrimSpace(kind),
		ownerID,
	)
}

func (s *Server) backgroundOwnerLeaseProvider(
	kind string,
	expectedCancelEpoch ...uint64,
) background.LeaseProvider {
	baseline := uint64(0)
	if len(expectedCancelEpoch) != 0 {
		baseline = expectedCancelEpoch[0]
	}
	kind = strings.TrimSpace(kind)
	return func(
		ctx context.Context,
		descriptor background.Descriptor,
	) (background.Lease, bool, error) {
		if s == nil ||
			descriptor.Scope != background.ScopeUser ||
			descriptor.OwnerID == 0 ||
			kind == "" {
			return background.Lease{}, false, fmt.Errorf(
				"background owner lease is not configured",
			)
		}
		// Production MediaIndexer and Photo Intelligence startup both require
		// a database. DB-less Server fixtures call the internal request methods
		// directly in unit tests, so preserve that lightweight execution path
		// without pretending that it provides distributed ownership.
		if s.DB == nil {
			return background.Lease{}, true, nil
		}
		cancelled, _, err := s.backgroundOwnerCancelledSince(
			ctx,
			kind,
			descriptor.OwnerID,
			baseline,
		)
		if err != nil {
			return background.Lease{}, false, err
		}
		if cancelled {
			return background.Lease{}, false, context.Canceled
		}
		lease, acquired, err := sourceaccount.TryAcquire(
			ctx,
			s.DB,
			backgroundOwnerLeaseKey(kind, descriptor.OwnerID),
		)
		if err != nil {
			return background.Lease{}, false, err
		}
		if !acquired {
			return background.Lease{}, false, nil
		}
		cancelled, _, err = s.backgroundOwnerCancelledSince(
			ctx,
			kind,
			descriptor.OwnerID,
			baseline,
		)
		if err != nil {
			lease.Close()
			return background.Lease{}, false, err
		}
		if cancelled {
			lease.Close()
			return background.Lease{}, false, context.Canceled
		}
		return background.Lease{
			Heartbeat: func(heartbeatCtx context.Context) error {
				if err := lease.Heartbeat(heartbeatCtx); err != nil {
					return err
				}
				cancelled, _, err := s.backgroundOwnerCancelledSince(
					heartbeatCtx,
					kind,
					descriptor.OwnerID,
					baseline,
				)
				if err != nil {
					return err
				}
				if cancelled {
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
