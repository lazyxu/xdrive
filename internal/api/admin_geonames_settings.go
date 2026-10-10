package api

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const geoNamesSettingName = "geonames"

var errGeoNamesRevisionConflict = errors.New("GeoNames configuration revision changed")

type geoNamesDesiredConfig struct {
	MaxDistanceKM float64
	Revision      uint64
	Source        string
	UpdatedAt     *time.Time
}

func validGeoNamesMaxDistanceKM(distance float64) bool {
	return distance > 0 && distance <= 500 &&
		!math.IsNaN(distance) && !math.IsInf(distance, 0)
}

// A saved revision overrides deployment defaults. Corrupt saved values fail
// closed rather than reactivating an obsolete environment configuration.
func geoNamesDesiredSettings(ctx context.Context, db *gorm.DB, fallback float64) (geoNamesDesiredConfig, error) {
	if !validGeoNamesMaxDistanceKM(fallback) {
		fallback = 100
	}
	defaultValue := geoNamesDesiredConfig{MaxDistanceKM: fallback, Source: "environment"}
	if db == nil {
		return defaultValue, nil
	}
	var row meta.AdminGeoNamesSetting
	err := db.WithContext(ctx).Where("name = ?", geoNamesSettingName).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return defaultValue, nil
	}
	if err != nil {
		return geoNamesDesiredConfig{}, err
	}
	if !validGeoNamesMaxDistanceKM(row.MaxDistanceKM) || row.Revision == 0 {
		return geoNamesDesiredConfig{}, fmt.Errorf("persisted GeoNames configuration is invalid")
	}
	return geoNamesDesiredConfig{
		MaxDistanceKM: row.MaxDistanceKM,
		Revision:      row.Revision,
		Source:        "saved",
		UpdatedAt:     &row.UpdatedAt,
	}, nil
}

// Startup must capture the radius AND its persisted revision from one read.
// A heartbeat cannot acknowledge a revision merely because the radius matches.
func GeoNamesStartupDistanceRevision(ctx context.Context, db *gorm.DB, fallback float64) (float64, uint64, error) {
	config, err := geoNamesDesiredSettings(ctx, db, fallback)
	if err != nil {
		return 0, 0, err
	}
	return config.MaxDistanceKM, config.Revision, nil
}

func GeoNamesStartupMaxDistance(ctx context.Context, db *gorm.DB, fallback float64) (float64, error) {
	distance, _, err := GeoNamesStartupDistanceRevision(ctx, db, fallback)
	return distance, err
}

func (s *Server) adminSaveGeoNamesConfig(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s.DB == nil || s.GeoNamesRuntime == nil || s.GeoNamesDataDir == "" ||
		s.GeoNamesRuntime.Version() == "" {
		fail(c, http.StatusServiceUnavailable, "GeoNames runtime is not configured")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 512)
	var input struct {
		MaxDistanceKM *float64 `json:"max_distance_km"`
		Revision      *uint64  `json:"revision"`
	}
	if err := c.ShouldBindJSON(&input); err != nil ||
		input.Revision == nil || input.MaxDistanceKM == nil ||
		!validGeoNamesMaxDistanceKM(*input.MaxDistanceKM) {
		fail(c, http.StatusBadRequest, "GeoNames distance must be > 0 and <= 500 km; revision is required")
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
	// Fully validate and build an immutable candidate before database writes.
	candidate, err := s.loadCurrentGeoNamesResolver(ctx, *input.MaxDistanceKM)
	if err != nil {
		fail(c, http.StatusUnprocessableEntity, "GeoNames dataset validation failed; active settings unchanged")
		return
	}
	if ctx.Err() != nil {
		return
	}
	nextRevision := uint64(0)
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row meta.AdminGeoNamesSetting
		readErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", geoNamesSettingName).Take(&row).Error
		exists := readErr == nil
		if readErr != nil && !errors.Is(readErr, gorm.ErrRecordNotFound) {
			return readErr
		}
		if (exists && row.Revision != *input.Revision) ||
			(!exists && *input.Revision != 0) {
			return errGeoNamesRevisionConflict
		}
		nextRevision = *input.Revision + 1
		if exists {
			write := tx.Model(&meta.AdminGeoNamesSetting{}).
				Where("name = ? AND revision = ?", geoNamesSettingName, row.Revision).
				Updates(map[string]any{
					"max_distance_km": *input.MaxDistanceKM,
					"revision":        nextRevision,
					"updated_at":      time.Now().UTC(),
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
					Name: geoNamesSettingName, MaxDistanceKM: *input.MaxDistanceKM,
					Revision: nextRevision,
				})
			if write.Error != nil {
				return write.Error
			}
			if write.RowsAffected != 1 {
				return errGeoNamesRevisionConflict
			}
		}
		// Include the previous value and the new value in an immutable journal.
		// Revision zero snapshots the original deployment default.
		previousRadius := desired.MaxDistanceKM
		previousOrigin := "environment"
		if exists {
			previousRadius = row.MaxDistanceKM
			previousOrigin = "saved"
		}
		if err := recordGeoNamesRevisionTx(tx, *input.Revision, previousRadius, previousOrigin); err != nil {
			return err
		}
		if err := recordGeoNamesRevisionTx(tx, nextRevision, *input.MaxDistanceKM, "saved"); err != nil {
			return err
		}
		return recordAuditTx(tx, auditEventFromContext(
			c, "admin.service.geonames.configure", "service", geoNamesSettingName,
			"GeoNames 地名索引", auditpkg.ResultSuccess,
			map[string]any{
				"revision":         nextRevision,
				"max_distance_km":  *input.MaxDistanceKM,
				"resolver_version": candidate.Version(),
			},
		))
	})
	if err != nil {
		if errors.Is(err, errGeoNamesRevisionConflict) {
			fail(c, http.StatusConflict, "GeoNames settings changed; refresh and retry")
		} else {
			fail(c, http.StatusServiceUnavailable, "GeoNames settings could not be saved and audited")
		}
		return
	}
	// Saved desired state becomes effective only on THIS instance after
	// a successful transaction. Other replicas report pending until reloaded.
	s.GeoNamesRuntime.Swap(candidate)
	s.GeoNamesAppliedRevision.Store(nextRevision)
	s.adminGeoNamesConfig(c)
}
