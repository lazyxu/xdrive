package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const mediaWorkerSettingName = "media-worker"

var errMediaWorkerRevision = errors.New("media worker activation revision changed")

type mediaWorkerDesired struct {
	Revision  uint64
	Enabled   bool
	Source    string
	UpdatedAt *time.Time
}

func (s *Server) readMediaWorkerDesired(ctx context.Context) (mediaWorkerDesired, error) {
	defaults := mediaWorkerDesired{Source: "default"}
	if s == nil || s.DB == nil {
		return defaults, errors.New("database unavailable")
	}
	var row meta.AdminMediaWorkerSetting
	err := s.DB.WithContext(ctx).Where("name = ?", mediaWorkerSettingName).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return defaults, nil
	}
	if err != nil {
		return defaults, err
	}
	if row.Revision == 0 {
		return defaults, errors.New("invalid media worker revision")
	}
	return mediaWorkerDesired{
		Revision: row.Revision, Enabled: row.Enabled, Source: "saved",
		UpdatedAt: &row.UpdatedAt,
	}, nil
}

func recordMediaWorkerRevisionTx(tx *gorm.DB, revision uint64, enabled bool, origin string) error {
	var old meta.AdminMediaWorkerRevision
	err := tx.Where("name = ? AND revision = ?", mediaWorkerSettingName, revision).Take(&old).Error
	if err == nil {
		if old.Enabled != enabled {
			return errors.New("immutable media worker revision conflict")
		}
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return tx.Create(&meta.AdminMediaWorkerRevision{
		Name: mediaWorkerSettingName, Revision: revision,
		Enabled: enabled, Origin: origin, CreatedAt: time.Now().UTC(),
	}).Error
}

// Changing the desired revision never directly starts/stops a process.
// The separate audited /apply action asks the Host Manager to do so.
func (s *Server) adminSaveMediaWorkerConfig(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s == nil || s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "media worker settings unavailable")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 512)
	var input struct {
		Revision *uint64 `json:"revision"`
		Enabled  *bool   `json:"enabled"`
	}
	if c.ShouldBindJSON(&input) != nil || input.Revision == nil || input.Enabled == nil {
		fail(c, http.StatusBadRequest, "media worker revision and enabled boolean required")
		return
	}
	s.mediaWorkerConfigSaveMu.Lock()
	defer s.mediaWorkerConfigSaveMu.Unlock()
	// Do not change desired state while a previous activation is in progress:
	// only a completed/stale operation may be superseded.
	host := s.readMediaWorkerHostStatus()
	if s.mediaWorkerHostBusy() || (host.Supported && (host.State == "queued" || host.State == "running")) {
		fail(c, http.StatusConflict, "media worker operation is in progress")
		return
	}
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var row meta.AdminMediaWorkerSetting
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", mediaWorkerSettingName).Take(&row).Error
		exists := err == nil
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if (exists && row.Revision != *input.Revision) || (!exists && *input.Revision != 0) {
			return errMediaWorkerRevision
		}
		before, origin := false, "default"
		if exists {
			before, origin = row.Enabled, "saved"
		}
		if err := recordMediaWorkerRevisionTx(tx, *input.Revision, before, origin); err != nil {
			return err
		}
		nextRevision := *input.Revision + 1
		if exists {
			changed := tx.Model(&meta.AdminMediaWorkerSetting{}).
				Where("name = ? AND revision = ?", mediaWorkerSettingName, row.Revision).
				Updates(map[string]any{
					"enabled":    *input.Enabled,
					"revision":   nextRevision,
					"updated_at": time.Now().UTC(),
				})
			if changed.Error != nil {
				return changed.Error
			}
			if changed.RowsAffected != 1 {
				return errMediaWorkerRevision
			}
		} else {
			created := tx.Clauses(clause.OnConflict{DoNothing: true}).
				Create(&meta.AdminMediaWorkerSetting{
					Name: mediaWorkerSettingName, Revision: nextRevision, Enabled: *input.Enabled,
				})
			if created.Error != nil {
				return created.Error
			}
			if created.RowsAffected != 1 {
				return errMediaWorkerRevision
			}
		}
		if err := recordMediaWorkerRevisionTx(tx, nextRevision, *input.Enabled, "saved"); err != nil {
			return err
		}
		return recordAuditTx(tx, auditEventFromContext(c,
			"admin.service.media-worker.configure", "service", "media-worker",
			"FFmpeg Media Worker", auditpkg.ResultSuccess,
			map[string]any{"revision": nextRevision, "desired_enabled": *input.Enabled},
		))
	})
	if errors.Is(err, errMediaWorkerRevision) {
		fail(c, http.StatusConflict, "media worker config revision changed; refresh")
		return
	}
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "media worker config not saved/audited")
		return
	}
	s.adminMediaWorkerConfig(c)
}

type mediaWorkerRevisionDTO struct {
	Revision  uint64    `json:"revision"`
	Enabled   bool      `json:"enabled"`
	Origin    string    `json:"origin"`
	CreatedAt time.Time `json:"created_at"`
}

func (s *Server) adminMediaWorkerRevisions(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s == nil || s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "media worker history unavailable")
		return
	}
	var rows []meta.AdminMediaWorkerRevision
	if err := s.DB.WithContext(c.Request.Context()).
		Where("name = ?", mediaWorkerSettingName).
		Order("revision DESC").Limit(40).Find(&rows).Error; err != nil {
		fail(c, http.StatusServiceUnavailable, "media worker history unavailable")
		return
	}
	list := make([]mediaWorkerRevisionDTO, 0, len(rows))
	for _, row := range rows {
		list = append(list, mediaWorkerRevisionDTO{Revision: row.Revision, Enabled: row.Enabled, Origin: row.Origin, CreatedAt: row.CreatedAt})
	}
	c.JSON(http.StatusOK, gin.H{"items": list})
}

func (s *Server) adminRollbackMediaWorker(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s == nil || s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "media worker settings unavailable")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 512)
	var input struct {
		Revision       *uint64 `json:"revision"`
		TargetRevision *uint64 `json:"target_revision"`
	}
	if c.ShouldBindJSON(&input) != nil || input.Revision == nil || input.TargetRevision == nil ||
		*input.TargetRevision >= *input.Revision {
		fail(c, http.StatusBadRequest, "current and older media worker revision required")
		return
	}
	s.mediaWorkerConfigSaveMu.Lock()
	defer s.mediaWorkerConfigSaveMu.Unlock()
	host := s.readMediaWorkerHostStatus()
	if s.mediaWorkerHostBusy() || (host.Supported && (host.State == "queued" || host.State == "running")) {
		fail(c, http.StatusConflict, "media worker operation in progress")
		return
	}
	var history meta.AdminMediaWorkerRevision
	err := s.DB.WithContext(c.Request.Context()).Where("name = ? AND revision = ?", mediaWorkerSettingName, *input.TargetRevision).
		Take(&history).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		fail(c, http.StatusNotFound, "media worker history revision not found")
		return
	}
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "media worker history unavailable")
		return
	}
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var row meta.AdminMediaWorkerSetting
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("name = ?", mediaWorkerSettingName).Take(&row).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errMediaWorkerRevision
		}
		if err != nil {
			return err
		}
		if row.Revision != *input.Revision {
			return errMediaWorkerRevision
		}
		if err := recordMediaWorkerRevisionTx(tx, row.Revision, row.Enabled, "saved"); err != nil {
			return err
		}
		next := row.Revision + 1
		updated := tx.Model(&meta.AdminMediaWorkerSetting{}).
			Where("name = ? AND revision = ?", mediaWorkerSettingName, row.Revision).
			Updates(map[string]any{"enabled": history.Enabled, "revision": next, "updated_at": time.Now().UTC()})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return errMediaWorkerRevision
		}
		if err := recordMediaWorkerRevisionTx(tx, next, history.Enabled, "rollback"); err != nil {
			return err
		}
		return recordAuditTx(tx, auditEventFromContext(c,
			"admin.service.media-worker.rollback", "service", "media-worker",
			"FFmpeg Media Worker", auditpkg.ResultSuccess,
			map[string]any{"revision": next, "target_revision": *input.TargetRevision, "desired_enabled": history.Enabled},
		))
	})
	if errors.Is(err, errMediaWorkerRevision) {
		fail(c, http.StatusConflict, "media worker config revision changed")
		return
	}
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "media worker rollback not saved/audited")
		return
	}
	s.adminMediaWorkerConfig(c)
}
