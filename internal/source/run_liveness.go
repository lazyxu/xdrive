package source

import (
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
)

const SyncRunStaleAfter = 30 * time.Minute

func SyncRunHeartbeatAt(run meta.SyncRun) time.Time {
	if !run.UpdatedAt.IsZero() {
		return run.UpdatedAt
	}
	return run.StartedAt
}

func SyncRunStale(run meta.SyncRun, now time.Time) bool {
	if run.Status != meta.SyncRunStatusRunning {
		return false
	}
	heartbeat := SyncRunHeartbeatAt(run)
	if heartbeat.IsZero() {
		return true
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	return now.Sub(heartbeat) > SyncRunStaleAfter
}
