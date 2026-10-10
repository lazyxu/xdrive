package api

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"
)

const geoNamesReplicaReconcileInterval = 30 * time.Second

// Each replica reconciles persisted radius and content-addressed dataset;
// actual bytes must pass integrity checks before a revision is acknowledged.
// Every instance validates and publishes its own resolver; no fleet success
// or managed dataset-file rollout is implied.
func (s *Server) StartGeoNamesReplicaReconciliation(ctx context.Context) {
	if s == nil || s.DB == nil || s.GeoNamesRuntime == nil ||
		strings.TrimSpace(s.GeoNamesDataDir) == "" {
		return
	}
	go func() {
		ticker := time.NewTicker(geoNamesReplicaReconcileInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := s.reconcileGeoNamesReplica(ctx); err != nil && ctx.Err() == nil {
					slog.Warn("geonames_replica_reconcile_failed", "error", err)
				}
			}
		}
	}()
}

// A background reconciliation must never compete with an administrator reload,
// configuration update or rollback. A busy instance retries on the next tick.
func (s *Server) reconcileGeoNamesReplica(ctx context.Context) error {
	if s == nil || s.DB == nil || s.GeoNamesRuntime == nil ||
		strings.TrimSpace(s.GeoNamesDataDir) == "" {
		return nil
	}
	if !s.geoNamesReloadMu.TryLock() {
		return nil
	}
	defer s.geoNamesReloadMu.Unlock()

	desired, err := geoNamesDesiredSettings(ctx, s.DB, s.GeoNamesMaxDistanceKM)
	if err != nil {
		return fmt.Errorf("read committed GeoNames settings: %w", err)
	}
	if s.GeoNamesRuntime.Snapshot() == nil {
		return nil
	}
	if s.GeoNamesRuntime.MaxDistanceKM() == desired.MaxDistanceKM &&
		s.currentGeoNamesDatasetFingerprint() == desired.Fingerprint {
		// A newer audit revision can intentionally carry the same radius.
		// This instance actually has the desired immutable resolver settings,
		// so acknowledge the revision without an unnecessary full rebuild.
		s.GeoNamesAppliedRevision.Store(desired.Revision)
		return nil
	}

	// Build completely before publication. Failure leaves the last-good
	// immutable index and in-flight PlaceRunner batches untouched.
	candidate, err := s.loadGeoNamesResolverForFingerprint(
		ctx, desired.Fingerprint, desired.MaxDistanceKM,
	)
	if err != nil {
		return fmt.Errorf("validate GeoNames replica dataset: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	// Another instance may have saved a newer radius while we were building.
	// Discard this candidate rather than publishing known-stale settings.
	confirmed, err := geoNamesDesiredSettings(ctx, s.DB, s.GeoNamesMaxDistanceKM)
	if err != nil {
		return fmt.Errorf("confirm committed GeoNames settings: %w", err)
	}
	if confirmed.Revision != desired.Revision ||
		confirmed.MaxDistanceKM != desired.MaxDistanceKM ||
		confirmed.Fingerprint != desired.Fingerprint {
		return nil
	}
	s.GeoNamesRuntime.Swap(candidate)
	s.SetGeoNamesStartupDataset(confirmed.Fingerprint)
	s.GeoNamesAppliedRevision.Store(confirmed.Revision)
	slog.Info("geonames_replica_radius_applied",
		"revision", confirmed.Revision,
		"max_distance_km", confirmed.MaxDistanceKM,
		"resolver_version", candidate.Version(),
	)
	return nil
}
