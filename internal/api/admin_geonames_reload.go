package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
)

type adminGeoNamesConfigDTO struct {
	DatasetConfigured        bool                   `json:"dataset_configured"`
	ReloadSupported          bool                   `json:"reload_supported"`
	Source                   string                 `json:"source"`
	CurrentVersion           string                 `json:"current_version"`
	MaxDistanceKM            float64                `json:"max_distance_km"`
	RequiresRestart          bool                   `json:"requires_restart"`
	Editable                 bool                   `json:"editable"`
	Revision                 uint64                 `json:"revision"`
	EffectiveDistance        float64                `json:"effective_max_distance_km"`
	EffectiveRevision        uint64                 `json:"effective_revision"`
	ApplyState               string                 `json:"apply_state"`
	UpdatedAt                *time.Time             `json:"updated_at,omitempty"`
	ReplicaApplyState        string                 `json:"replica_apply_state"`
	ObservedInstances        int                    `json:"observed_instances"`
	AppliedInstances         int                    `json:"applied_instances"`
	UnconfiguredInstances    int                    `json:"unconfigured_instances"`
	ReplicaStatusTruncated   bool                   `json:"replica_status_truncated"`
	DatasetConsistent        bool                   `json:"dataset_versions_consistent"`
	DatasetVersions          []geoNamesVersionGroup `json:"dataset_versions"`
	SnapshotSupported        bool                   `json:"snapshot_supported"`
	SnapshotRequirement      string                 `json:"snapshot_requirement"`
	SnapshotHistoryKnown     bool                   `json:"snapshot_history_known"`
	Snapshots                []geoNamesSnapshotDTO  `json:"snapshots"`
	DesiredFingerprint       string                 `json:"desired_dataset_fingerprint"`
	ActiveDatasetFingerprint string                 `json:"active_dataset_fingerprint"`
	ActiveDatasetSource      string                 `json:"active_dataset_source"`
	ActiveDatasetPersistent  bool                   `json:"active_dataset_persistent"`
	SnapshotApplySupported   bool                   `json:"snapshot_apply_supported"`
	MissingArchiveState      string                 `json:"missing_archive_state"`
	RestoreMissingEnabled    bool                   `json:"restore_missing_enabled"`
	RestoreMissingHint       string                 `json:"restore_missing_hint"`
}

// GeoNames dataset paths are deliberately not accepted from HTTP. A trusted,
// read-only deployment mount is the sole dataset source in this first phase.
func (s *Server) adminGeoNamesConfig(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	desired, err := geoNamesDesiredSettings(c.Request.Context(), s.DB, s.GeoNamesMaxDistanceKM)
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "GeoNames settings are unavailable")
		return
	}
	version := ""
	effectiveDistance := float64(0)
	if s.GeoNamesRuntime != nil {
		version = s.GeoNamesRuntime.Version()
		effectiveDistance = s.GeoNamesRuntime.MaxDistanceKM()
	}
	configured := strings.TrimSpace(s.GeoNamesDataDir) != "" && version != ""
	effectiveRevision := s.GeoNamesAppliedRevision.Load()
	applyState := "unavailable"
	if configured {
		applyState = "pending"
		if effectiveDistance == desired.MaxDistanceKM && effectiveRevision == desired.Revision &&
			s.currentGeoNamesDatasetFingerprint() == desired.Fingerprint {
			applyState = "applied"
		}
	}
	// An unreadable/older presence schema must never become a fabricated
	// success. Keep the existing local radius editor available and mark
	// cross-replica evidence unknown instead of returning a false 500.
	replicas := geoNamesReplicaSummary{
		State: "unknown", Versions: make([]geoNamesVersionGroup, 0),
	}
	if s.DB != nil {
		var observed []meta.GeoNamesReplicaPresence
		err := s.DB.WithContext(c.Request.Context()).
			Where("expires_at > ?", time.Now().UTC()).
			Order("instance_id ASC").Limit(geoNamesReplicaQueryCap + 1).
			Find(&observed).Error
		if err == nil {
			truncated := len(observed) > geoNamesReplicaQueryCap
			if truncated {
				observed = observed[:geoNamesReplicaQueryCap]
			}
			replicas = summarizeGeoNamesReplicas(desired, observed, truncated)
		}
	}
	snapshots, snapshotHistoryKnown := s.geoNamesSnapshotHistory(c.Request.Context())
	snapshotSupported := configured && snapshotHistoryKnown &&
		geoNamesSnapshotStorageConfigured(s.GeoNamesSnapshotDir, s.GeoNamesDataDir)
	activeFingerprint := s.currentGeoNamesDatasetFingerprint()
	datasetSource := "deployment"
	if activeFingerprint != "" {
		datasetSource = "snapshot"
	}
	snapshotRequirement := "需先在部署中配置 XD_GEONAMES_SNAPSHOT_DIR 为独立可写的持久目录，并完成数据库迁移。"
	if snapshotSupported {
		snapshotRequirement = "仅将受信任挂载的数据校验并暂存到此 Server 的持久目录；不会激活或分发到其他实例。"
	}
	missingArchiveState, restoreMissingEnabled, restoreMissingHint := s.geoNamesMissingArchiveRecoveryStatus(c, desired, snapshotSupported)
	c.JSON(http.StatusOK, adminGeoNamesConfigDTO{
		DatasetConfigured:        configured,
		ReloadSupported:          s.DB != nil && configured,
		Source:                   desired.Source,
		CurrentVersion:           version,
		MaxDistanceKM:            desired.MaxDistanceKM,
		RequiresRestart:          false,
		Editable:                 s.DB != nil && configured,
		Revision:                 desired.Revision,
		EffectiveDistance:        effectiveDistance,
		EffectiveRevision:        effectiveRevision,
		ApplyState:               applyState,
		UpdatedAt:                desired.UpdatedAt,
		ReplicaApplyState:        replicas.State,
		ObservedInstances:        replicas.ObservedInstances,
		AppliedInstances:         replicas.AppliedInstances,
		UnconfiguredInstances:    replicas.UnconfiguredInstances,
		ReplicaStatusTruncated:   replicas.Truncated,
		DatasetConsistent:        replicas.DatasetConsistent,
		DatasetVersions:          replicas.Versions,
		SnapshotSupported:        snapshotSupported,
		SnapshotRequirement:      snapshotRequirement,
		SnapshotHistoryKnown:     snapshotHistoryKnown,
		Snapshots:                snapshots,
		DesiredFingerprint:       desired.Fingerprint,
		ActiveDatasetFingerprint: activeFingerprint,
		ActiveDatasetSource:      datasetSource,
		ActiveDatasetPersistent: configured && effectiveRevision == desired.Revision &&
			activeFingerprint == desired.Fingerprint,
		SnapshotApplySupported: snapshotSupported,
		MissingArchiveState:    missingArchiveState,
		RestoreMissingEnabled:  restoreMissingEnabled,
		RestoreMissingHint:     restoreMissingHint,
	})
}

func (s *Server) adminGeoNamesReload(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s.DB == nil || s.GeoNamesRuntime == nil ||
		strings.TrimSpace(s.GeoNamesDataDir) == "" {
		fail(c, http.StatusServiceUnavailable, "GeoNames dataset reload is not configured")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 512)
	var input struct {
		ExpectedVersion string `json:"expected_version"`
	}
	if err := c.ShouldBindJSON(&input); err != nil ||
		len(input.ExpectedVersion) == 0 || len(input.ExpectedVersion) > 128 {
		fail(c, http.StatusBadRequest, "GeoNames expected version is required")
		return
	}
	if !s.geoNamesReloadMu.TryLock() {
		fail(c, http.StatusConflict, "GeoNames reload is already running")
		return
	}
	defer s.geoNamesReloadMu.Unlock()

	current := s.GeoNamesRuntime.Snapshot()
	if current == nil || current.Version() != input.ExpectedVersion {
		fail(c, http.StatusConflict, "GeoNames dataset changed; refresh and retry")
		return
	}
	// Always build a fresh, fully validated immutable index BEFORE publishing it.
	// A bad or partial data update must leave existing tasks and the active version intact.
	desired, err := geoNamesDesiredSettings(c.Request.Context(), s.DB, s.GeoNamesMaxDistanceKM)
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "GeoNames settings are unavailable")
		return
	}
	next, err := s.loadGeoNamesResolverForFingerprint(
		c.Request.Context(), desired.Fingerprint, desired.MaxDistanceKM,
	)
	if err != nil {
		fail(c, http.StatusUnprocessableEntity, "GeoNames dataset validation failed; active version retained")
		return
	}
	if c.Request.Context().Err() != nil {
		return
	}
	previousVersion := current.Version()
	changed := next.Version() != previousVersion || s.currentGeoNamesDatasetFingerprint() != desired.Fingerprint
	confirmed, err := geoNamesDesiredSettings(c.Request.Context(), s.DB, s.GeoNamesMaxDistanceKM)
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "GeoNames desired state verification unavailable")
		return
	}
	if confirmed.Revision != desired.Revision || confirmed.MaxDistanceKM != desired.MaxDistanceKM ||
		confirmed.Fingerprint != desired.Fingerprint {
		fail(c, http.StatusConflict, "GeoNames desired state changed; refresh and retry")
		return
	}
	// Persist a no-secret admin audit BEFORE changing the live pointer. Without
	// a working audit database, the reload is not authorized to take effect.
	if err := recordAuditTx(s.DB.WithContext(c.Request.Context()), auditEventFromContext(
		c, "admin.service.geonames.reload", "service", "geonames",
		"GeoNames 离线地名", auditpkg.ResultSuccess,
		map[string]any{"changed": changed, "previous_version": previousVersion, "next_version": next.Version()},
	)); err != nil {
		fail(c, http.StatusServiceUnavailable, "GeoNames reload audit is unavailable")
		return
	}
	if changed {
		s.GeoNamesRuntime.Swap(next)
	}
	s.SetGeoNamesStartupDataset(desired.Fingerprint)
	s.GeoNamesAppliedRevision.Store(desired.Revision)
	c.JSON(http.StatusOK, gin.H{
		"applied": true, "changed": changed, "previous_version": previousVersion,
		"current_version": s.GeoNamesRuntime.Version(),
		"checked_at":      time.Now().UTC().Format(time.RFC3339),
	})
}
