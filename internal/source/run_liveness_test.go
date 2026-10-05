package source

import (
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestSyncRunStaleUsesUpdatedAtHeartbeat(t *testing.T) {
	now := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	started := now.Add(-2 * SyncRunStaleAfter)
	recent := now.Add(-SyncRunStaleAfter / 2)
	run := meta.SyncRun{
		Status:    meta.SyncRunStatusRunning,
		StartedAt: started,
		UpdatedAt: recent,
	}
	if SyncRunStale(run, now) {
		t.Fatalf("recent heartbeat marked stale: heartbeat=%s", SyncRunHeartbeatAt(run))
	}
	run.UpdatedAt = now.Add(-SyncRunStaleAfter - time.Second)
	if !SyncRunStale(run, now) {
		t.Fatalf("expired heartbeat not marked stale: heartbeat=%s", SyncRunHeartbeatAt(run))
	}
	run.Status = meta.SyncRunStatusCompleted
	if SyncRunStale(run, now) {
		t.Fatal("terminal run marked stale")
	}
}

func TestSyncRunHeartbeatFallsBackToStartedAt(t *testing.T) {
	started := time.Date(2026, 10, 5, 10, 0, 0, 0, time.UTC)
	run := meta.SyncRun{
		Status:    meta.SyncRunStatusRunning,
		StartedAt: started,
	}
	if got := SyncRunHeartbeatAt(run); !got.Equal(started) {
		t.Fatalf("heartbeat=%s want=%s", got, started)
	}
}
