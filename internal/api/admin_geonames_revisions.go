package api

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const geoNamesRevisionHistoryLimit = 40

type geoNamesRevisionDTO struct {
	Revision      uint64    `json:"revision"`
	MaxDistanceKM float64   `json:"max_distance_km"`
	Origin        string    `json:"origin"`
	CreatedAt     time.Time `json:"created_at"`
}

type geoNamesRevisionPage struct {
	Items []geoNamesRevisionDTO `json:"items"`
}

// Journal entries cannot be edited. Re-encountering a previously recorded
// revision must have the same value; its original source is preserved.
func recordGeoNamesRevisionTx(tx *gorm.DB, revision uint64, radius float64, origin string) error {
	if !validGeoNamesMaxDistanceKM(radius) {
		return errors.New("invalid GeoNames historical radius")
	}
	var saved meta.AdminGeoNamesRevision
	err := tx.Where("name = ? AND revision = ?", geoNamesSettingName, revision).Take(&saved).Error
	if err == nil {
		if saved.MaxDistanceKM != radius {
			return errors.New("GeoNames revision history conflict")
		}
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return tx.Create(&meta.AdminGeoNamesRevision{
		Name: geoNamesSettingName, Revision: revision, MaxDistanceKM: radius,
		Origin: origin, CreatedAt: time.Now().UTC(),
	}).Error
}

func (s *Server) adminGeoNamesRevisions(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "GeoNames history is unavailable")
		return
	}
	var rows []meta.AdminGeoNamesRevision
	if err := s.DB.WithContext(c.Request.Context()).
		Where("name = ?", geoNamesSettingName).
		Order("revision DESC").Limit(geoNamesRevisionHistoryLimit).Find(&rows).Error; err != nil {
		fail(c, http.StatusServiceUnavailable, "GeoNames history is unavailable")
		return
	}
	items := make([]geoNamesRevisionDTO, 0, len(rows))
	for _, row := range rows {
		items = append(items, geoNamesRevisionDTO{
			Revision: row.Revision, MaxDistanceKM: row.MaxDistanceKM,
			Origin: row.Origin, CreatedAt: row.CreatedAt,
		})
	}
	c.JSON(http.StatusOK, geoNamesRevisionPage{Items: items})
}

// Rollback is another versioned, audited hot apply. Never accept a dataset
// path, change the read-only mount, or claim coordinated replica activation.
func (s *Server) adminRollbackGeoNamesConfig(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s.DB == nil || s.GeoNamesRuntime == nil || strings.TrimSpace(s.GeoNamesDataDir) == "" ||
		s.GeoNamesRuntime.Version() == "" {
		fail(c, http.StatusServiceUnavailable, "GeoNames runtime is not configured")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 512)
	var input struct {
		Revision       *uint64 `json:"revision"`
		TargetRevision *uint64 `json:"target_revision"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || input.Revision == nil ||
		input.TargetRevision == nil || *input.TargetRevision >= *input.Revision {
		fail(c, http.StatusBadRequest, "current revision and older target revision required")
		return
	}
	if !s.geoNamesReloadMu.TryLock() {
		fail(c, http.StatusConflict, "GeoNames configuration or reload already in progress")
		return
	}
	defer s.geoNamesReloadMu.Unlock()
	ctx := c.Request.Context()
	desired, err := geoNamesDesiredSettings(ctx, s.DB, s.GeoNamesMaxDistanceKM)
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "GeoNames settings are unavailable")
		return
	}
	if desired.Revision != *input.Revision {
		fail(c, http.StatusConflict, "GeoNames settings changed; refresh and retry")
		return
	}
	var target meta.AdminGeoNamesRevision
	err = s.DB.WithContext(ctx).
		Where("name = ? AND revision = ?", geoNamesSettingName, *input.TargetRevision).
		Take(&target).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		fail(c, http.StatusNotFound, "GeoNames history revision not found")
		return
	}
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "GeoNames history is unavailable")
		return
	}
	if !validGeoNamesMaxDistanceKM(target.MaxDistanceKM) {
		fail(c, http.StatusUnprocessableEntity, "GeoNames historical configuration is invalid")
		return
	}
	candidate, err := s.loadGeoNamesResolverForFingerprint(ctx, desired.Fingerprint, target.MaxDistanceKM)
	if err != nil {
		fail(c, http.StatusUnprocessableEntity, "GeoNames dataset validation failed; active settings unchanged")
		return
	}
	if ctx.Err() != nil {
		return
	}
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var current meta.AdminGeoNamesSetting
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", geoNamesSettingName).Take(&current).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errGeoNamesRevisionConflict
			}
			return err
		}
		if current.Revision != *input.Revision || current.Fingerprint != desired.Fingerprint {
			return errGeoNamesRevisionConflict
		}
		if err := recordGeoNamesRevisionTx(tx, current.Revision, current.MaxDistanceKM, "saved"); err != nil {
			return err
		}
		nextRevision := current.Revision + 1
		updated := tx.Model(&meta.AdminGeoNamesSetting{}).
			Where("name = ? AND revision = ?", geoNamesSettingName, current.Revision).
			Updates(map[string]any{
				"max_distance_km": target.MaxDistanceKM,
				"revision":        nextRevision,
				"updated_at":      time.Now().UTC(),
			})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return errGeoNamesRevisionConflict
		}
		if err := recordGeoNamesRevisionTx(tx, nextRevision, target.MaxDistanceKM, "rollback"); err != nil {
			return err
		}
		return recordAuditTx(tx, auditEventFromContext(
			c, "admin.service.geonames.rollback", "service", geoNamesSettingName,
			"GeoNames 地名索引", auditpkg.ResultSuccess,
			map[string]any{
				"revision": nextRevision, "previous_revision": current.Revision,
				"target_revision": target.Revision, "max_distance_km": target.MaxDistanceKM,
				"resolver_version": candidate.Version(),
			},
		))
	})
	if err != nil {
		if errors.Is(err, errGeoNamesRevisionConflict) {
			fail(c, http.StatusConflict, "GeoNames settings changed; refresh and retry")
		} else {
			fail(c, http.StatusServiceUnavailable, "GeoNames rollback could not be saved and audited")
		}
		return
	}
	s.GeoNamesRuntime.Swap(candidate)
	s.SetGeoNamesStartupDataset(desired.Fingerprint)
	s.GeoNamesAppliedRevision.Store(*input.Revision + 1)
	s.adminGeoNamesConfig(c)
}
