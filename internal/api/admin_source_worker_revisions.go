package api

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourceworkerpolicy"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const sourceWorkerRevisionHistoryLimit = 40

func recordSourceWorkerRevisionTx(tx *gorm.DB, revision uint64, values sourceworkerpolicy.Values, origin string) error {
	if !sourceworkerpolicy.Valid(values) {
		return errors.New("invalid historical source worker configuration")
	}
	var old meta.AdminSourceWorkerRevision
	err := tx.Where("name = ? AND revision = ?", sourceworkerpolicy.SettingName, revision).Take(&old).Error
	if err == nil {
		if old.ScanIntervalSeconds != values.ScanIntervalSeconds ||
			old.PollIntervalSeconds != values.PollIntervalSeconds ||
			old.MaxConcurrency != values.MaxConcurrency {
			return errors.New("source worker revision journal conflict")
		}
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return tx.Create(&meta.AdminSourceWorkerRevision{
		Name: sourceworkerpolicy.SettingName, Revision: revision,
		ScanIntervalSeconds: values.ScanIntervalSeconds, PollIntervalSeconds: values.PollIntervalSeconds,
		MaxConcurrency: values.MaxConcurrency, Origin: origin, CreatedAt: time.Now().UTC(),
	}).Error
}

type sourceWorkerRevisionDTO struct {
	Revision  uint64                    `json:"revision"`
	Desired   sourceworkerpolicy.Values `json:"desired"`
	Origin    string                    `json:"origin"`
	CreatedAt time.Time                 `json:"created_at"`
}

type sourceWorkerRevisionPage struct {
	Items []sourceWorkerRevisionDTO `json:"items"`
}

func (s *Server) adminSourceWorkerRevisions(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "source worker history is unavailable")
		return
	}
	var rows []meta.AdminSourceWorkerRevision
	if err := s.DB.WithContext(c.Request.Context()).
		Where("name = ?", sourceworkerpolicy.SettingName).
		Order("revision DESC").Limit(sourceWorkerRevisionHistoryLimit).Find(&rows).Error; err != nil {
		fail(c, http.StatusServiceUnavailable, "source worker history could not be read")
		return
	}
	items := make([]sourceWorkerRevisionDTO, 0, len(rows))
	for _, row := range rows {
		values := sourceworkerpolicy.Values{
			ScanIntervalSeconds: row.ScanIntervalSeconds,
			PollIntervalSeconds: row.PollIntervalSeconds,
			MaxConcurrency:      row.MaxConcurrency,
		}
		if !sourceworkerpolicy.Valid(values) {
			fail(c, http.StatusServiceUnavailable, "source worker history is invalid")
			return
		}
		items = append(items, sourceWorkerRevisionDTO{
			Revision: row.Revision, Desired: values, Origin: row.Origin, CreatedAt: row.CreatedAt,
		})
	}
	c.JSON(http.StatusOK, sourceWorkerRevisionPage{Items: items})
}

func (s *Server) adminRollbackSourceWorkerConfig(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "source worker settings are unavailable")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 512)
	var input struct {
		Revision       *uint64 `json:"revision"`
		TargetRevision *uint64 `json:"target_revision"`
	}
	if c.ShouldBindJSON(&input) != nil || input.Revision == nil ||
		input.TargetRevision == nil || *input.TargetRevision >= *input.Revision {
		fail(c, http.StatusBadRequest, "current and older target source worker revisions are required")
		return
	}
	s.sourceWorkerConfigSaveMu.Lock()
	defer s.sourceWorkerConfigSaveMu.Unlock()
	ctx := c.Request.Context()
	var target meta.AdminSourceWorkerRevision
	err := s.DB.WithContext(ctx).Where("name = ? AND revision = ?", sourceworkerpolicy.SettingName, *input.TargetRevision).
		Take(&target).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		fail(c, http.StatusNotFound, "source worker history revision not found")
		return
	}
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "source worker history could not be read")
		return
	}
	restore := sourceworkerpolicy.Values{
		ScanIntervalSeconds: target.ScanIntervalSeconds, PollIntervalSeconds: target.PollIntervalSeconds,
		MaxConcurrency: target.MaxConcurrency,
	}
	if !sourceworkerpolicy.Valid(restore) {
		fail(c, http.StatusUnprocessableEntity, "source worker historical configuration is invalid")
		return
	}
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row meta.AdminSourceWorkerSetting
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", sourceworkerpolicy.SettingName).Take(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errSourceWorkerRevisionConflict
			}
			return err
		}
		if row.Revision != *input.Revision {
			return errSourceWorkerRevisionConflict
		}
		before := sourceworkerpolicy.Values{
			ScanIntervalSeconds: row.ScanIntervalSeconds, PollIntervalSeconds: row.PollIntervalSeconds,
			MaxConcurrency: row.MaxConcurrency,
		}
		if err := recordSourceWorkerRevisionTx(tx, row.Revision, before, "saved"); err != nil {
			return err
		}
		nextRevision := row.Revision + 1
		updated := tx.Model(&meta.AdminSourceWorkerSetting{}).
			Where("name = ? AND revision = ?", sourceworkerpolicy.SettingName, row.Revision).
			Updates(map[string]any{
				"scan_interval_seconds": restore.ScanIntervalSeconds,
				"poll_interval_seconds": restore.PollIntervalSeconds,
				"max_concurrency":       restore.MaxConcurrency,
				"revision":              nextRevision, "updated_at": time.Now().UTC(),
			})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return errSourceWorkerRevisionConflict
		}
		if err := recordSourceWorkerRevisionTx(tx, nextRevision, restore, "rollback"); err != nil {
			return err
		}
		return recordAuditTx(tx, auditEventFromContext(
			c, "admin.service.source-worker.rollback", "service", "source-worker",
			"独立 Pull Worker 调度", auditpkg.ResultSuccess,
			map[string]any{"revision": nextRevision, "target_revision": *input.TargetRevision,
				"previous_revision": row.Revision, "desired": restore},
		))
	})
	if err != nil {
		if errors.Is(err, errSourceWorkerRevisionConflict) {
			fail(c, http.StatusConflict, "source worker settings changed; refresh and retry")
		} else {
			fail(c, http.StatusServiceUnavailable, "source worker rollback could not be saved and audited")
		}
		return
	}
	s.adminSourceWorkerConfig(c)
}
