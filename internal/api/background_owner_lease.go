package api

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/sourceaccount"
)

const backgroundOwnerLeaseHeartbeatInterval = 2 * time.Second

func backgroundOwnerLeaseKey(kind string, ownerID uint64) string {
	return fmt.Sprintf(
		"background-owner:v1:%s:%d",
		strings.TrimSpace(kind),
		ownerID,
	)
}

func (s *Server) backgroundOwnerLeaseProvider(
	kind string,
	submittedCancelEpoch uint64,
) background.LeaseProvider {
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
		return background.Lease{
			Heartbeat: func(heartbeatCtx context.Context) error {
				if err := lease.Heartbeat(heartbeatCtx); err != nil {
					return err
				}
				requested, _, err := s.backgroundRuntimeCancelEpoch(
					heartbeatCtx,
					descriptor.OwnerID,
					kind,
				)
				if err != nil {
					return err
				}
				if requested > submittedCancelEpoch {
					return background.ErrCancelRequested
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
