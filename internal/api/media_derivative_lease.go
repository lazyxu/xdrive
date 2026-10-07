package api

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/sourceaccount"
)

const mediaDerivativeLeaseHeartbeatInterval = 5 * time.Second

func mediaDerivativeLeaseKey(taskKey string) string {
	return "media-derivative:v1:" + strings.TrimSpace(taskKey)
}

func (s *Server) mediaDerivativeLeaseProvider(
	taskKey string,
) background.LeaseProvider {
	leaseKey := mediaDerivativeLeaseKey(taskKey)
	return func(
		ctx context.Context,
		descriptor background.Descriptor,
	) (background.Lease, bool, error) {
		if s == nil ||
			descriptor.Scope != background.ScopeUser ||
			descriptor.OwnerID == 0 ||
			strings.TrimSpace(taskKey) == "" {
			return background.Lease{}, false, fmt.Errorf(
				"media derivative lease is not configured",
			)
		}
		// Production derivative generation requires the database for source
		// revision/fingerprint fencing. Keep DB-less test fixtures lightweight
		// without claiming distributed ownership.
		if s.DB == nil {
			return background.Lease{}, true, nil
		}
		lease, acquired, err := sourceaccount.TryAcquire(
			ctx,
			s.DB,
			leaseKey,
		)
		if err != nil {
			return background.Lease{}, false, err
		}
		if !acquired {
			return background.Lease{}, false, nil
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
