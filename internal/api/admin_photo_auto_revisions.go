package api

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const photoAutoRevisionHistoryLimit = 40

type photoAutoRevisionDTO struct {
	Revision    uint64         `json:"revision"`
	AutoEnabled bool           `json:"auto_enabled"`
	Kinds       photoAutoKinds `json:"kinds"`
	Origin      string         `json:"origin"`
	CreatedAt   time.Time      `json:"created_at"`
}

type photoAutoRevisionPage struct {
	Items []photoAutoRevisionDTO `json:"items"`
}

// Historical rows are append-only. Every duplicate revision must preserve its
// original global switch, exact per-kind settings and source metadata.
func recordPhotoAutoRevisionTx(tx *gorm.DB, revision uint64, enabled bool, rawKinds, origin string) error {
	if _, err := parsePhotoAutoKinds(rawKinds); err != nil {
		return err
	}
	var old meta.AdminPhotoAutoRevision
	err := tx.Where("name = ? AND revision = ?", photoAutoSettingName, revision).Take(&old).Error
	if err == nil {
		if old.AutoEnabled != enabled || old.KindsJSON != rawKinds {
			return errors.New("photo intelligence revision history conflict")
		}
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return tx.Create(&meta.AdminPhotoAutoRevision{
		Name: photoAutoSettingName, Revision: revision, AutoEnabled: enabled,
		KindsJSON: rawKinds, Origin: origin, CreatedAt: time.Now().UTC(),
	}).Error
}

func (s *Server) adminPhotoAutoRevisions(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "photo intelligence revision history is unavailable")
		return
	}
	var rows []meta.AdminPhotoAutoRevision
	if err := s.DB.WithContext(c.Request.Context()).
		Where("name = ?", photoAutoSettingName).
		Order("revision DESC").
		Limit(photoAutoRevisionHistoryLimit).Find(&rows).Error; err != nil {
		fail(c, http.StatusServiceUnavailable, "photo intelligence revision history is unavailable")
		return
	}
	items := make([]photoAutoRevisionDTO, 0, len(rows))
	for _, row := range rows {
		kinds, err := parsePhotoAutoKinds(row.KindsJSON)
		if err != nil {
			fail(c, http.StatusServiceUnavailable, "photo intelligence revision history is invalid")
			return
		}
		items = append(items, photoAutoRevisionDTO{
			Revision: row.Revision, AutoEnabled: row.AutoEnabled,
			Kinds:  effectivePhotoAutoKinds(kinds),
			Origin: row.Origin, CreatedAt: row.CreatedAt,
		})
	}
	c.JSON(http.StatusOK, photoAutoRevisionPage{Items: items})
}

// Rollback changes a task-admission policy only. It neither cancels in-flight
// analyses nor changes AI images, model files, sockets or host resources.
func (s *Server) adminRollbackPhotoAutoConfig(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "photo intelligence policy storage is unavailable")
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
	s.photoAutoSaveMu.Lock()
	defer s.photoAutoSaveMu.Unlock()

	ctx := c.Request.Context()
	desired, err := photoAutoDesiredSettings(ctx, s.DB)
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "photo intelligence policy could not be read")
		return
	}
	if desired.Revision != *input.Revision {
		fail(c, http.StatusConflict, "photo intelligence policy changed; refresh and retry")
		return
	}
	var target meta.AdminPhotoAutoRevision
	err = s.DB.WithContext(ctx).
		Where("name = ? AND revision = ?", photoAutoSettingName, *input.TargetRevision).
		Take(&target).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		fail(c, http.StatusNotFound, "photo intelligence target revision not found")
		return
	}
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "photo intelligence revision history is unavailable")
		return
	}
	targetKinds, err := parsePhotoAutoKinds(target.KindsJSON)
	if err != nil {
		fail(c, http.StatusUnprocessableEntity, "photo intelligence historical policy is invalid")
		return
	}
	var nextRevision uint64
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var current meta.AdminPhotoAutoSetting
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", photoAutoSettingName).Take(&current).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errPhotoAutoRevisionConflict
			}
			return err
		}
		if current.Revision != *input.Revision {
			return errPhotoAutoRevisionConflict
		}
		if err := recordPhotoAutoRevisionTx(tx, current.Revision, current.AutoEnabled, current.KindsJSON, "saved"); err != nil {
			return err
		}
		nextRevision = current.Revision + 1
		updated := tx.Model(&meta.AdminPhotoAutoSetting{}).
			Where("name = ? AND revision = ?", photoAutoSettingName, current.Revision).
			Updates(map[string]any{
				"auto_enabled": target.AutoEnabled,
				"kinds_json":   target.KindsJSON,
				"revision":     nextRevision,
				"updated_at":   time.Now().UTC(),
			})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return errPhotoAutoRevisionConflict
		}
		if err := recordPhotoAutoRevisionTx(tx, nextRevision, target.AutoEnabled, target.KindsJSON, "rollback"); err != nil {
			return err
		}
		return recordAuditTx(tx, auditEventFromContext(
			c, "admin.service.photo-intelligence.rollback", "service", "photo-intelligence",
			"Photo Intelligence 自动分析", auditpkg.ResultSuccess,
			map[string]any{
				"revision": nextRevision, "previous_revision": current.Revision,
				"target_revision": target.Revision, "auto_enabled": target.AutoEnabled,
				"kinds": effectivePhotoAutoKinds(targetKinds),
			},
		))
	})
	if err != nil {
		if errors.Is(err, errPhotoAutoRevisionConflict) {
			fail(c, http.StatusConflict, "photo intelligence policy changed; refresh and retry")
		} else {
			fail(c, http.StatusServiceUnavailable, "photo intelligence rollback could not be saved and audited")
		}
		return
	}
	s.setPhotoAutoRuntime(photoAutoDesired{
		AutoEnabled: target.AutoEnabled, Kinds: targetKinds, Revision: nextRevision,
	})
	s.adminPhotoAutoConfig(c)
}
