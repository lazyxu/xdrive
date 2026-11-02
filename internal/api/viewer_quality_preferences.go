package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var errViewerQualityPreferenceConflict = errors.New("viewer preference revision changed")

type viewerQualityPreferenceDTO struct {
	Revision uint64 `json:"revision"`
	Preset   mediapkg.ViewerQualityPreset `json:"preset"`
}

// The view preference belongs to the authenticated Owner, not the device
// making the request. A device-specific override is a separate client choice.
func (s *Server) getViewerQualityPreference(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	if s == nil || s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "viewer preferences unavailable")
		return
	}
	uid := userID(c)
	if uid == 0 {
		fail(c, http.StatusUnauthorized, "authentication required")
		return
	}
	var row meta.ViewerQualityPreference
	err := s.DB.WithContext(c.Request.Context()).
		Where("user_id = ?", uid).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusOK, viewerQualityPreferenceDTO{
			Revision: 0, Preset: mediapkg.ViewerQualityHigh,
		})
		return
	}
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "viewer preferences unavailable")
		return
	}
	preset, err := mediapkg.ParseViewerQualityPreset(row.Preset)
	if err != nil || row.Revision == 0 || preset != mediapkg.ViewerQualityPreset(row.Preset) {
		fail(c, http.StatusServiceUnavailable, "viewer preferences unavailable")
		return
	}
	c.JSON(http.StatusOK, viewerQualityPreferenceDTO{Revision: row.Revision, Preset: preset})
}

// PUT uses optimistic concurrency and the Server's Owner identity. Missing
// revision and unknown/extra fields fail closed; no arbitrary quality numbers.
func (s *Server) putViewerQualityPreference(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	if s == nil || s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "viewer preferences unavailable")
		return
	}
	uid := userID(c)
	if uid == 0 {
		fail(c, http.StatusUnauthorized, "authentication required")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256)
	var input struct {
		Revision *uint64 `json:"revision"`
		Preset   string  `json:"preset"`
	}
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	err := decoder.Decode(&input)
	if err != nil || input.Revision == nil || strings.TrimSpace(input.Preset) != input.Preset || input.Preset == "" {
		fail(c, http.StatusBadRequest, "revision and viewer quality preset required")
		return
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		fail(c, http.StatusBadRequest, "only one viewer preference object allowed")
		return
	}
	preset, err := mediapkg.ParseViewerQualityPreset(input.Preset)
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid viewer quality preset")
		return
	}
	nextRevision := *input.Revision + 1
	if nextRevision == 0 {
		fail(c, http.StatusBadRequest, "invalid preference revision")
		return
	}
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var row meta.ViewerQualityPreference
		readErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("user_id = ?", uid).Take(&row).Error
		if errors.Is(readErr, gorm.ErrRecordNotFound) {
			if *input.Revision != 0 {
				return errViewerQualityPreferenceConflict
			}
			result := tx.Clauses(clause.OnConflict{DoNothing: true}).
				Create(&meta.ViewerQualityPreference{
					UserID: uid, Revision: nextRevision, Preset: string(preset),
				})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return errViewerQualityPreferenceConflict
			}
			return nil
		}
		if readErr != nil {
			return readErr
		}
		if row.Revision != *input.Revision {
			return errViewerQualityPreferenceConflict
		}
		updated := tx.Model(&meta.ViewerQualityPreference{}).
			Where("user_id = ? AND revision = ?", uid, row.Revision).
			Updates(map[string]any{
				"preset": string(preset), "revision": nextRevision,
			})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return errViewerQualityPreferenceConflict
		}
		return nil
	})
	if errors.Is(err, errViewerQualityPreferenceConflict) {
		fail(c, http.StatusConflict, "viewer preference changed, reload")
		return
	}
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "viewer preferences unavailable")
		return
	}
	c.JSON(http.StatusOK, viewerQualityPreferenceDTO{Revision: nextRevision, Preset: preset})
}
