package api

import (
	"context"
	"encoding/hex"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// GeoNames data-file activation is local to the responding Server. Its desired
// content address is persisted with the global GeoNames configuration revision.
// Each replica separately verifies bytes before it can acknowledge activation.
type geoNamesActiveDataset struct {
	Fingerprint string
}

func (s *Server) currentGeoNamesDatasetFingerprint() string {
	if s == nil {
		return ""
	}
	if active := s.geoNamesActiveDataset.Load(); active != nil {
		return active.Fingerprint
	}
	return ""
}

func validGeoNamesSnapshotFingerprint(value string) bool {
	if len(value) != 64 {
		return false
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == 32 && hex.EncodeToString(decoded) == value
}

// Resolve a previously recorded immutable content-addressed dataset. Treat
// archive directory presence as untrusted: copy/hash/bound each of the three
// files again, build the complete resolver, and only return verified bytes.
func (s *Server) verifiedGeoNamesSnapshotResolver(
	ctx context.Context, fingerprint string, radius float64,
) (*photointelligence.GeoNamesResolver, error) {
	if s == nil || s.DB == nil || !validGeoNamesSnapshotFingerprint(fingerprint) {
		return nil, errors.New("GeoNames snapshot reference is invalid")
	}
	root, err := geoNamesSnapshotRoot(s.GeoNamesSnapshotDir, s.GeoNamesDataDir)
	if err != nil {
		return nil, err
	}
	var row meta.AdminGeoNamesDatasetSnapshot
	if err := s.DB.WithContext(ctx).Where("fingerprint = ?", fingerprint).Take(&row).Error; err != nil {
		return nil, err
	}
	if row.TotalBytes <= 0 || row.TotalBytes > geoNamesSnapshotMaxTotal {
		return nil, errors.New("GeoNames snapshot has an invalid persisted size")
	}
	location := filepath.Join(root, fingerprint)
	info, err := os.Lstat(location)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("GeoNames snapshot storage is not a real directory")
	}
	temp, actual, size, version, err := copyAndValidateGeoNamesSnapshot(ctx, location, root, radius)
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(temp)
	if fingerprint != actual || size != row.TotalBytes {
		return nil, errors.New("GeoNames archived bytes differ from the audited immutable manifest")
	}
	// The copyAndValidate helper validates the complete index from the private
	// bytes. Keep the resulting candidate in memory after the temp is removed.
	candidate, err := photointelligence.LoadGeoNamesResolver(temp, radius)
	if err != nil || candidate.Version() != version {
		return nil, errors.New("GeoNames archived candidate verification failed")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return candidate, nil
}

// A candidate always comes from the recorded content address or the trusted
// deployment mount, never from a renderer-provided directory.
func (s *Server) loadGeoNamesResolverForFingerprint(
	ctx context.Context, fingerprint string, radius float64,
) (*photointelligence.GeoNamesResolver, error) {
	if fingerprint != "" {
		return s.verifiedGeoNamesSnapshotResolver(ctx, fingerprint, radius)
	}
	return photointelligence.LoadGeoNamesResolver(s.GeoNamesDataDir, radius)
}

// Preserve the current-runtime loader for compatibility with existing callers.
func (s *Server) loadCurrentGeoNamesResolver(
	ctx context.Context, radius float64,
) (*photointelligence.GeoNamesResolver, error) {
	return s.loadGeoNamesResolverForFingerprint(ctx, s.currentGeoNamesDatasetFingerprint(), radius)
}

// Only the verified, selected fingerprint is attached to the running process.
func (s *Server) SetGeoNamesStartupDataset(fingerprint string) {
	if s == nil {
		return
	}
	if fingerprint == "" {
		s.geoNamesActiveDataset.Store(nil)
	} else {
		s.geoNamesActiveDataset.Store(&geoNamesActiveDataset{Fingerprint: fingerprint})
	}
}

// Before constructing the Server, bootstrap can verify a persisted selected
// archive via the same content-address and immutable-index validation path.
func GeoNamesStartupVerifiedSnapshot(
	ctx context.Context, db *gorm.DB, deploymentDir, archiveDir, fingerprint string, radius float64,
) (*photointelligence.GeoNamesResolver, error) {
	s := &Server{DB: db, GeoNamesDataDir: deploymentDir, GeoNamesSnapshotDir: archiveDir}
	return s.verifiedGeoNamesSnapshotResolver(ctx, fingerprint, radius)
}

func (s *Server) adminApplyGeoNamesDatasetSnapshot(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s == nil || s.DB == nil || s.GeoNamesRuntime == nil ||
		strings.TrimSpace(s.GeoNamesDataDir) == "" {
		fail(c, http.StatusServiceUnavailable, "GeoNames runtime is unavailable")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
	var input struct {
		Revision            *uint64 `json:"revision"`
		ExpectedVersion     string  `json:"expected_version"`
		ExpectedFingerprint string  `json:"expected_fingerprint"`
		Target              string  `json:"target"`
	}
	if c.ShouldBindJSON(&input) != nil || input.Revision == nil ||
		len(input.ExpectedVersion) == 0 || len(input.ExpectedVersion) > 128 ||
		len(input.ExpectedFingerprint) > 64 ||
		(input.ExpectedFingerprint != "" && !validGeoNamesSnapshotFingerprint(input.ExpectedFingerprint)) ||
		(input.Target != "deployment" && !validGeoNamesSnapshotFingerprint(input.Target)) {
		fail(c, http.StatusBadRequest, "GeoNames dataset target, revision and expected runtime version are required")
		return
	}
	if !s.geoNamesReloadMu.TryLock() {
		fail(c, http.StatusConflict, "GeoNames apply, radius edit or reload is already in progress")
		return
	}
	defer s.geoNamesReloadMu.Unlock()

	current := s.GeoNamesRuntime.Snapshot()
	if current == nil || current.Version() != input.ExpectedVersion ||
		s.currentGeoNamesDatasetFingerprint() != input.ExpectedFingerprint {
		fail(c, http.StatusConflict, "GeoNames active dataset changed; refresh and retry")
		return
	}
	ctx := c.Request.Context()
	desired, err := geoNamesDesiredSettings(ctx, s.DB, s.GeoNamesMaxDistanceKM)
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "GeoNames desired settings are unavailable")
		return
	}
	if desired.Revision != *input.Revision {
		fail(c, http.StatusConflict, "GeoNames revision changed; refresh and retry")
		return
	}
	var candidate *photointelligence.GeoNamesResolver
	if input.Target == "deployment" {
		candidate, err = photointelligence.LoadGeoNamesResolver(s.GeoNamesDataDir, desired.MaxDistanceKM)
	} else {
		candidate, err = s.verifiedGeoNamesSnapshotResolver(ctx, input.Target, desired.MaxDistanceKM)
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		fail(c, http.StatusNotFound, "GeoNames recorded dataset snapshot was not found")
		return
	}
	if err != nil {
		fail(c, http.StatusUnprocessableEntity, "GeoNames dataset failed content verification; active index preserved")
		return
	}
	if ctx.Err() != nil {
		return
	}
	confirmed, err := geoNamesDesiredSettings(ctx, s.DB, s.GeoNamesMaxDistanceKM)
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "GeoNames revision verification unavailable")
		return
	}
	if confirmed.Revision != desired.Revision || confirmed.MaxDistanceKM != desired.MaxDistanceKM ||
		confirmed.Fingerprint != desired.Fingerprint {
		fail(c, http.StatusConflict, "GeoNames desired configuration changed during validation")
		return
	}
	targetFingerprint := ""
	if input.Target != "deployment" {
		targetFingerprint = input.Target
	}
	previousVersion := current.Version()
	changed := previousVersion != candidate.Version() || input.ExpectedFingerprint != targetFingerprint
	nextRevision := desired.Revision + 1
	// The desired content address and audit must commit together before any
	// runtime swap. Unconfigured replicas are never falsely acknowledged.
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row meta.AdminGeoNamesSetting
		readErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", geoNamesSettingName).Take(&row).Error
		if readErr != nil && !errors.Is(readErr, gorm.ErrRecordNotFound) {
			return readErr
		}
		exists := readErr == nil
		if (exists && (row.Revision != desired.Revision ||
			row.MaxDistanceKM != desired.MaxDistanceKM || row.Fingerprint != desired.Fingerprint)) ||
			(!exists && desired.Revision != 0) {
			return errGeoNamesRevisionConflict
		}
		if exists {
			write := tx.Model(&meta.AdminGeoNamesSetting{}).
				Where("name = ? AND revision = ?", geoNamesSettingName, row.Revision).
				Updates(map[string]any{
					"fingerprint": targetFingerprint,
					"revision":    nextRevision,
					"updated_at":  time.Now().UTC(),
				})
			if write.Error != nil {
				return write.Error
			}
			if write.RowsAffected != 1 {
				return errGeoNamesRevisionConflict
			}
		} else {
			write := tx.Clauses(clause.OnConflict{DoNothing: true}).
				Create(&meta.AdminGeoNamesSetting{
					Name: geoNamesSettingName, MaxDistanceKM: desired.MaxDistanceKM,
					Fingerprint: targetFingerprint, Revision: nextRevision,
				})
			if write.Error != nil {
				return write.Error
			}
			if write.RowsAffected != 1 {
				return errGeoNamesRevisionConflict
			}
		}
		if err := recordGeoNamesRevisionTx(tx, desired.Revision, desired.MaxDistanceKM, desired.Source); err != nil {
			return err
		}
		if err := recordGeoNamesRevisionTx(tx, nextRevision, desired.MaxDistanceKM, "saved"); err != nil {
			return err
		}
		return recordAuditTx(tx, auditEventFromContext(
			c, "admin.service.geonames.dataset_select", "service", geoNamesSettingName,
			"GeoNames 数据集持久目标配置与当前实例热应用", auditpkg.ResultSuccess,
			map[string]any{
				"target_fingerprint":   targetFingerprint,
				"previous_fingerprint": desired.Fingerprint,
				"previous_version":     previousVersion,
				"next_version":         candidate.Version(),
				"revision":             nextRevision,
				"persistent":           true,
				"changed":              changed,
			},
		))
	})
	if errors.Is(err, errGeoNamesRevisionConflict) {
		fail(c, http.StatusConflict, "GeoNames desired revision changed; refresh and retry")
		return
	}
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "GeoNames dataset preference or audit could not be persisted; active index preserved")
		return
	}
	// Pinned in-flight PlaceRunner snapshots remain valid after atomic swap.
	s.GeoNamesRuntime.Swap(candidate)
	s.SetGeoNamesStartupDataset(targetFingerprint)
	s.GeoNamesAppliedRevision.Store(nextRevision)
	s.adminGeoNamesConfig(c)
}
