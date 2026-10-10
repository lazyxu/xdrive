package api

import (
	"context"
	"log/slog"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	geoNamesPresenceInterval = 5 * time.Second
	geoNamesPresenceTTL      = 20 * time.Second
	geoNamesReplicaQueryCap  = 100
)

type geoNamesVersionGroup struct {
	Version string `json:"version"`
	Count   int    `json:"count"`
}

type geoNamesReplicaSummary struct {
	State                 string                 `json:"replica_apply_state"`
	ObservedInstances     int                    `json:"observed_instances"`
	AppliedInstances      int                    `json:"applied_instances"`
	UnconfiguredInstances int                    `json:"unconfigured_instances"`
	Truncated             bool                   `json:"replica_status_truncated"`
	DatasetConsistent     bool                   `json:"dataset_versions_consistent"`
	Versions              []geoNamesVersionGroup `json:"dataset_versions"`
}

// This is an observation of live leases, not a registry of every deployed
// replica. "applied" means all OBSERVED live instances report the persisted
// radius revision and exactly matching immutable dataset fingerprints.
func summarizeGeoNamesReplicas(desired geoNamesDesiredConfig, rows []meta.GeoNamesReplicaPresence, truncated bool) geoNamesReplicaSummary {
	out := geoNamesReplicaSummary{
		State: "unavailable", ObservedInstances: len(rows), Truncated: truncated,
		Versions: make([]geoNamesVersionGroup, 0),
	}
	versions := make(map[string]int)
	for _, row := range rows {
		if !row.Configured || row.ResolverVersion == "" {
			out.UnconfiguredInstances++
			continue
		}
		versions[row.ResolverVersion]++
		if desired.Revision != 0 && row.AppliedRevision == desired.Revision &&
			row.MaxDistanceKM == desired.MaxDistanceKM {
			out.AppliedInstances++
		}
	}
	for version, count := range versions {
		out.Versions = append(out.Versions, geoNamesVersionGroup{Version: version, Count: count})
	}
	sort.Slice(out.Versions, func(i, j int) bool {
		return out.Versions[i].Version < out.Versions[j].Version
	})
	out.DatasetConsistent = len(out.Versions) == 1 && out.UnconfiguredInstances == 0
	switch {
	case len(rows) == 0:
		out.State = "unavailable"
	case desired.Revision == 0:
		out.State = "unmanaged"
	case !truncated && out.AppliedInstances == len(rows) && out.DatasetConsistent:
		out.State = "applied"
	default:
		out.State = "pending"
	}
	return out
}

func (s *Server) geoNamesPresenceSnapshot(id string, now time.Time) meta.GeoNamesReplicaPresence {
	row := meta.GeoNamesReplicaPresence{
		InstanceID: id, HeartbeatAt: now, ExpiresAt: now.Add(geoNamesPresenceTTL),
	}
	if s == nil || s.GeoNamesRuntime == nil ||
		strings.TrimSpace(s.GeoNamesDataDir) == "" {
		return row
	}
	snapshot, ok := s.GeoNamesRuntime.Snapshot().(*photointelligence.GeoNamesResolver)
	if !ok || snapshot == nil {
		return row
	}
	row.Configured = true
	row.ResolverVersion = snapshot.Version()
	row.MaxDistanceKM = snapshot.MaxDistanceKM()
	row.AppliedRevision = s.GeoNamesAppliedRevision.Load()
	return row
}

func publishGeoNamesReplicaPresence(ctx context.Context, db *gorm.DB, row meta.GeoNamesReplicaPresence) error {
	return db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "instance_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"configured", "resolver_version", "max_distance_km",
			"applied_revision", "heartbeat_at", "expires_at",
		}),
	}).Create(&row).Error
}

// A heartbeat proves that the process observed this effective resolver. It
// does not prove that an unobserved/missing cluster node is healthy.
func (s *Server) StartGeoNamesReplicaPresence(ctx context.Context) {
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
			if err := db.WithContext(cleanupCtx).Model(&meta.GeoNamesReplicaPresence{}).
				Where("instance_id = ?", id).
				Update("expires_at", time.Now().UTC()).Error; err != nil {
				slog.Warn("geonames_replica_presence_expire_failed", "error", err)
			}
		}()
		cleanupCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		if err := db.WithContext(cleanupCtx).Where("expires_at < ?", time.Now().UTC().Add(-7*24*time.Hour)).
			Delete(&meta.GeoNamesReplicaPresence{}).Error; err != nil && ctx.Err() == nil {
			slog.Warn("geonames_replica_presence_prune_failed", "error", err)
		}
		cancel()
		publish := func() {
			pulseCtx, done := context.WithTimeout(ctx, 3*time.Second)
			defer done()
			if err := publishGeoNamesReplicaPresence(pulseCtx, db,
				s.geoNamesPresenceSnapshot(id, time.Now().UTC())); err != nil && ctx.Err() == nil {
				slog.Warn("geonames_replica_presence_publish_failed", "error", err)
			}
		}
		publish()
		ticker := time.NewTicker(geoNamesPresenceInterval)
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
