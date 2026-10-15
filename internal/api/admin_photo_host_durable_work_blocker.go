package api

import (
	"context"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
)

// This is a strictly NEGATIVE stop-safety observation. Persisted rows can
// prove that work exists; the absence of rows cannot prove fleet-wide idle,
// fencing of new jobs, or a safe disable/restart. It is read only and runs
// exclusively as part of the administrator's explicit Host preflight.
const photoHostDurableWorkProbeTimeout = 800 * time.Millisecond

func (s *Server) photoHostDurableWorkBlocker(ctx context.Context) string {
	if s == nil || s.DB == nil || ctx == nil || ctx.Err() != nil {
		return "unverified"
	}
	probeCtx, cancel := context.WithTimeout(ctx, photoHostDurableWorkProbeTimeout)
	defer cancel()

	// Fixed, indexed state-only existence queries. Do not read users, file
	// paths, task payloads, model results or even individual task identifiers.
	// Pending analysis rows are not an active lease; they still prevent a
	// positive drain proof until enqueue is fenced in a later phase.
	probes := []struct {
		table  string
		states []string
	}{
		{
			table:  meta.PhotoAnalysisState{}.TableName(),
			states: []string{meta.PhotoAnalysisStateRunning},
		},
		{
			table:  meta.PhotoPersonClusterState{}.TableName(),
			states: []string{meta.PhotoAnalysisStateRunning},
		},
		{
			table: meta.PhotoCreativeGeneration{}.TableName(),
			states: []string{
				meta.PhotoCreativeStateQueued,
				meta.PhotoCreativeStateRunning,
			},
		},
	}
	for _, probe := range probes {
		var present int
		result := s.DB.WithContext(probeCtx).
			Table(probe.table).
			Select("1").
			Where("state IN ?", probe.states).
			Limit(1).
			Scan(&present)
		if result.Error != nil || probeCtx.Err() != nil {
			return "unverified"
		}
		if result.RowsAffected > 0 {
			return "blocked"
		}
	}
	// This must NEVER return verified/safe/idle. Other Server instances,
	// in-memory tasks, workers and newly enqueued work have no durable
	// cross-replica drain fence in this phase.
	return "unverified"
}
