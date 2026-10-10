package api

import (
	"context"
	"log/slog"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	postgresPoolPresenceInterval = 5 * time.Second
	postgresPoolPresenceTTL      = 20 * time.Second
	postgresPoolReplicaQueryCap  = 100
)

type postgresPoolPolicyGroup struct {
	Revision           uint64 `json:"revision"`
	MaxOpenConnections int    `json:"max_open_connections"`
	MaxIdleConnections int    `json:"max_idle_connections"`
	Count              int    `json:"count"`
}

type postgresPoolReplicaSummary struct {
	State              string                    `json:"state"`
	ObservedInstances  int                       `json:"observed_instances"`
	AppliedInstances   int                       `json:"applied_instances"`
	PendingInstances   int                       `json:"pending_instances"`
	UnmanagedInstances int                       `json:"unmanaged_instances"`
	Truncated          bool                      `json:"truncated"`
	LimitsConsistent   bool                      `json:"limits_consistent"`
	PolicyGroups       []postgresPoolPolicyGroup `json:"policy_groups"`
}

// An applied state covers all OBSERVED fresh rows only, never an unseen fleet.
// Instance IDs, host metadata, paths, credentials and raw errors stay private.
func summarizePostgresPoolReplicas(desired postgresPoolDesired, rows []meta.PostgresPoolReplicaPresence, truncated bool) postgresPoolReplicaSummary {
	out := postgresPoolReplicaSummary{
		State: "unavailable", ObservedInstances: len(rows), Truncated: truncated,
		PolicyGroups: make([]postgresPoolPolicyGroup, 0),
	}
	type policyKey struct {
		revision uint64
		open     int
		idle     int
	}
	groups := make(map[policyKey]int)
	for _, row := range rows {
		revision := row.AppliedRevision
		if !row.Configured || revision == 0 {
			revision = 0
			out.UnmanagedInstances++
		}
		key := policyKey{revision: revision, open: row.MaxOpenConnections, idle: row.MaxIdleConnections}
		groups[key]++
		if row.Configured && revision != 0 && desired.Revision != 0 &&
			revision == desired.Revision &&
			row.MaxOpenConnections == desired.Values.MaxOpenConnections &&
			row.MaxIdleConnections == desired.Values.MaxIdleConnections {
			out.AppliedInstances++
		} else {
			out.PendingInstances++
		}
	}
	for key, count := range groups {
		out.PolicyGroups = append(out.PolicyGroups, postgresPoolPolicyGroup{
			Revision: key.revision, MaxOpenConnections: key.open,
			MaxIdleConnections: key.idle, Count: count,
		})
	}
	sort.Slice(out.PolicyGroups, func(i, j int) bool {
		a, b := out.PolicyGroups[i], out.PolicyGroups[j]
		if a.Revision != b.Revision {
			return a.Revision < b.Revision
		}
		if a.MaxOpenConnections != b.MaxOpenConnections {
			return a.MaxOpenConnections < b.MaxOpenConnections
		}
		return a.MaxIdleConnections < b.MaxIdleConnections
	})
	out.LimitsConsistent = len(out.PolicyGroups) == 1 && out.UnmanagedInstances == 0
	switch {
	case len(rows) == 0:
		out.State = "unavailable"
	case desired.Revision == 0:
		out.State = "unmanaged"
	case !truncated && out.AppliedInstances == len(rows) && out.LimitsConsistent:
		out.State = "applied"
	default:
		out.State = "pending"
	}
	return out
}

// database/sql Stats exposes configured max-open, not configured max-idle.
// Max-idle is reported only from the successfully installed local policy.
func (s *Server) postgresPoolPresenceSnapshot(id string, now time.Time) meta.PostgresPoolReplicaPresence {
	row := meta.PostgresPoolReplicaPresence{
		InstanceID: id, HeartbeatAt: now, ExpiresAt: now.Add(postgresPoolPresenceTTL),
	}
	if s == nil || s.DB == nil {
		return row
	}
	sqlDB, err := s.DB.DB()
	if err != nil {
		return row
	}
	row.MaxOpenConnections = sqlDB.Stats().MaxOpenConnections
	applied := s.postgresPoolApplied.Load()
	if applied != nil && applied.Revision != 0 && validPostgresPoolValues(applied.Values) &&
		row.MaxOpenConnections == applied.Values.MaxOpenConnections {
		row.Configured = true
		row.AppliedRevision = applied.Revision
		row.MaxIdleConnections = applied.Values.MaxIdleConnections
	}
	return row
}

func publishPostgresPoolReplicaPresence(ctx context.Context, db *gorm.DB, row meta.PostgresPoolReplicaPresence) error {
	return db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "instance_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"configured", "applied_revision", "max_open_connections", "max_idle_connections",
			"heartbeat_at", "expires_at",
		}),
	}).Create(&row).Error
}

func (s *Server) StartPostgresPoolReplicaPresence(ctx context.Context) {
	if s == nil || s.DB == nil {
		return
	}
	id := s.BackgroundRuntimeInstanceID
	if id == "" {
		id = uuid.NewString()
	}
	db := s.DB
	go func() {
		defer func() {
			cleanupCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			if err := db.WithContext(cleanupCtx).Model(&meta.PostgresPoolReplicaPresence{}).
				Where("instance_id = ?", id).
				Update("expires_at", time.Now().UTC()).Error; err != nil {
				slog.Warn("postgres_pool_replica_expire_failed", "error", err)
			}
		}()
		pruneCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		if err := db.WithContext(pruneCtx).Where("expires_at < ?", time.Now().UTC().Add(-7*24*time.Hour)).
			Delete(&meta.PostgresPoolReplicaPresence{}).Error; err != nil && ctx.Err() == nil {
			slog.Warn("postgres_pool_replica_prune_failed", "error", err)
		}
		cancel()
		publish := func() {
			pulseCtx, done := context.WithTimeout(ctx, 3*time.Second)
			defer done()
			if err := publishPostgresPoolReplicaPresence(pulseCtx, db,
				s.postgresPoolPresenceSnapshot(id, time.Now().UTC())); err != nil && ctx.Err() == nil {
				slog.Warn("postgres_pool_replica_publish_failed", "error", err)
			}
		}
		publish()
		ticker := time.NewTicker(postgresPoolPresenceInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				publish()
			}
		}
	}()
}

// Failed reads (including missing migration) are unknown, not "all applied".
// The cutoff rejects expired, stale and wildly future-dated leases.
func (s *Server) readPostgresPoolReplicaSummary(ctx context.Context, desired postgresPoolDesired) postgresPoolReplicaSummary {
	unknown := postgresPoolReplicaSummary{State: "unknown", PolicyGroups: make([]postgresPoolPolicyGroup, 0)}
	if s == nil || s.DB == nil {
		return unknown
	}
	now := time.Now().UTC()
	var rows []meta.PostgresPoolReplicaPresence
	err := s.DB.WithContext(ctx).
		Where("expires_at > ? AND heartbeat_at > ? AND heartbeat_at <= ?",
			now, now.Add(-postgresPoolPresenceTTL), now.Add(postgresPoolPresenceInterval)).
		Order("instance_id ASC").Limit(postgresPoolReplicaQueryCap + 1).
		Find(&rows).Error
	if err != nil {
		return unknown
	}
	truncated := len(rows) > postgresPoolReplicaQueryCap
	if truncated {
		rows = rows[:postgresPoolReplicaQueryCap]
	}
	return summarizePostgresPoolReplicas(desired, rows, truncated)
}
