package api

import (
	"context"

	"github.com/lazyxu/xdrive/internal/sourceaccount"
)

const (
	maintenanceLeaderJanitor        = "system-maintenance:storage-janitor"
	maintenanceLeaderStorageSampler = "system-maintenance:storage-sampler"
)

func (s *Server) runMaintenanceLeaderPass(
	ctx context.Context,
	key string,
	run func(),
) bool {
	if s == nil || s.DB == nil || run == nil || ctx.Err() != nil {
		return false
	}
	lease, acquired, err := sourceaccount.TryAcquire(ctx, s.DB, key)
	if err != nil {
		s.ensureObservability()
		s.obs.logger.Warn(
			"maintenance_leader_lock_failed",
			"maintenance", key,
			"error", err,
		)
		return false
	}
	if !acquired {
		return false
	}
	defer lease.Close()
	run()
	return true
}
