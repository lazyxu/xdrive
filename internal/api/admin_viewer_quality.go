package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/maintenance"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const adminViewerQualitySettingName = "viewer-quality"

var errAdminViewerQualityRevision = errors.New("viewer admin maximum revision changed")

type adminViewerQualityDTO struct {
	Revision uint64 `json:"revision"`
	Maximum  mediapkg.ViewerQualityPreset `json:"maximum_preset"`
	CacheBudgetBytes int64 `json:"cache_budget_bytes"`
}

// Every Server request validates the persisted maximum. No client parameter
// or account setting can raise the configured generated-image cap.
func (s *Server) readAdminViewerQualityMaximum(ctx context.Context) (adminViewerQualityDTO, error) {
	defaults := adminViewerQualityDTO{
		Maximum: mediapkg.ViewerQualityHigh,
		CacheBudgetBytes: maintenance.ViewerVariantCacheDefaultBudgetBytes,
	}
	if s == nil || s.DB == nil {
		return defaults, errors.New("viewer admin policy database unavailable")
	}
	var row meta.AdminViewerQualitySetting
	err := s.DB.WithContext(ctx).
		Where("name = ?", adminViewerQualitySettingName).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return defaults, nil
	}
	if err != nil {
		return defaults, err
	}
	preset, err := mediapkg.ParseViewerQualityPreset(row.MaximumPreset)
	if err != nil || row.Revision == 0 || string(preset) != row.MaximumPreset ||
		!validViewerCacheBudget(row.CacheBudgetBytes) {
		return defaults, errors.New("invalid stored viewer admin maximum")
	}
	return adminViewerQualityDTO{Revision: row.Revision, Maximum: preset,
		CacheBudgetBytes: row.CacheBudgetBytes}, nil
}

func (s *Server) adminGetViewerQuality(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	policy, err := s.readAdminViewerQualityMaximum(c.Request.Context())
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "viewer administrator policy unavailable")
		return
	}
	c.JSON(http.StatusOK, policy)
}

func (s *Server) adminPutViewerQuality(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s == nil || s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "viewer administrator policy unavailable")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256)
	var input struct {
		Revision *uint64 `json:"revision"`
		Maximum  string  `json:"maximum_preset"`
		CacheBudgetBytes *int64 `json:"cache_budget_bytes"`
	}
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || input.Revision == nil ||
		input.Maximum == "" || strings.TrimSpace(input.Maximum) != input.Maximum {
		fail(c, http.StatusBadRequest, "revision and maximum_preset required")
		return
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		fail(c, http.StatusBadRequest, "one viewer admin policy object required")
		return
	}
	maximum, err := mediapkg.ParseViewerQualityPreset(input.Maximum)
	if input.CacheBudgetBytes != nil && !validViewerCacheBudget(*input.CacheBudgetBytes) {
		fail(c, http.StatusBadRequest, "invalid Viewer cache budget")
		return
	}
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid viewer quality maximum")
		return
	}
	next := *input.Revision + 1
	if next == 0 {
		fail(c, http.StatusBadRequest, "invalid viewer admin revision")
		return
	}
	budget := maintenance.ViewerVariantCacheDefaultBudgetBytes
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var current meta.AdminViewerQualitySetting
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", adminViewerQualitySettingName).Take(&current).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if *input.Revision != 0 {
				return errAdminViewerQualityRevision
			}
			if input.CacheBudgetBytes != nil {
				budget = *input.CacheBudgetBytes
			}
			result := tx.Clauses(clause.OnConflict{DoNothing: true}).
				Create(&meta.AdminViewerQualitySetting{
					Name: adminViewerQualitySettingName,
					Revision: next,
					MaximumPreset: string(maximum),
					CacheBudgetBytes: budget,
				})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return errAdminViewerQualityRevision
			}
			return nil
		}
		if err != nil {
			return err
		}
		if current.Revision != *input.Revision {
			return errAdminViewerQualityRevision
		}
		if !validViewerCacheBudget(current.CacheBudgetBytes) {
			return errors.New("invalid persisted Viewer cache budget")
		}
		budget = current.CacheBudgetBytes
		if input.CacheBudgetBytes != nil {
			budget = *input.CacheBudgetBytes
		}
		result := tx.Model(&meta.AdminViewerQualitySetting{}).
			Where("name = ? AND revision = ?", adminViewerQualitySettingName, current.Revision).
			Updates(map[string]any{
				"maximum_preset": string(maximum),
				"cache_budget_bytes": budget,
				"revision": next,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errAdminViewerQualityRevision
		}
		return nil
	})
	if errors.Is(err, errAdminViewerQualityRevision) {
		fail(c, http.StatusConflict, "viewer administrator policy changed, reload")
		return
	}
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "viewer administrator policy unavailable")
		return
	}
	c.JSON(http.StatusOK, adminViewerQualityDTO{Revision: next, Maximum: maximum,
		CacheBudgetBytes: budget})
}

func validViewerCacheBudget(bytes int64) bool {
	return bytes >= 1<<20 && bytes <= 1<<40
}
