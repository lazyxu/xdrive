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

const photoHostSettingName = "photo-intelligence-host"
const photoHostRequirement = "仅记录共享 Photo Intelligence 宿主容器的期望启停修订；目前不提供宿主机应用操作。需另行实现经审计、版本校验、可回滚且仅作用于固定 photo-intelligence Profile 的 Host Manager 事务，并核验目标修订与实际容器状态、模型探针后才能宣称生效。自动分析任务准入另由全局分析策略管理。"

var errPhotoHostRevisionConflict = errors.New("Photo Intelligence host desired revision changed")

type photoHostDesired struct {
	Revision  uint64
	Enabled   bool
	Source    string
	UpdatedAt *time.Time
}

type adminPhotoHostConfigDTO struct {
	DesiredEnabled             bool       `json:"desired_enabled"`
	Revision                   uint64     `json:"revision"`
	Source                     string     `json:"source"`
	UpdatedAt                  *time.Time `json:"updated_at,omitempty"`
	ApplyState                 string     `json:"apply_state"`
	Editable                   bool       `json:"editable"`
	ApplySupported             bool       `json:"apply_supported"`
	Requirement                string     `json:"requirement"`
	HostObserved               bool       `json:"host_observed"`
	HostRuntimeState           string     `json:"host_runtime_state"`
	HostProfileConfigured      *bool      `json:"host_profile_configured,omitempty"`
	HostControlSupported       bool       `json:"host_control_supported"`
	HostControlState           string     `json:"host_control_state"`
	HostControlRevision        uint64     `json:"host_control_revision"`
	HostAppliedRevision        uint64     `json:"host_applied_revision"`
	HostControlProfileVerified bool       `json:"host_control_profile_verified"`
}

type adminPhotoHostRevisionDTO struct {
	Revision  uint64    `json:"revision"`
	Enabled   bool      `json:"enabled"`
	Origin    string    `json:"origin"`
	CreatedAt time.Time `json:"created_at"`
}

func (s *Server) readPhotoHostDesired(ctx context.Context) (photoHostDesired, error) {
	defaults := photoHostDesired{Source: "default"}
	if s == nil || s.DB == nil {
		return defaults, errors.New("Photo Intelligence desired database unavailable")
	}
	var row meta.AdminPhotoHostSetting
	err := s.DB.WithContext(ctx).Where("name = ?", photoHostSettingName).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return defaults, nil
	}
	if err != nil {
		return defaults, err
	}
	if row.Revision == 0 || row.Revision >= 1<<60 {
		return defaults, errors.New("invalid stored Photo Intelligence host revision")
	}
	return photoHostDesired{
		Revision: row.Revision, Enabled: row.Enabled, Source: "saved",
		UpdatedAt: &row.UpdatedAt,
	}, nil
}

// GET is a read-only comparison, never a Host Manager command. In particular,
// equal desired/profile booleans are NOT evidence of an applied desired revision.
func (s *Server) adminPhotoHostConfig(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	desired, err := s.readPhotoHostDesired(c.Request.Context())
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Photo Intelligence host configuration unavailable")
		return
	}
	state := "unmanaged"
	if desired.Revision > 0 {
		state = "pending"
	}
	result := adminPhotoHostConfigDTO{
		DesiredEnabled: desired.Enabled, Revision: desired.Revision,
		Source: desired.Source, UpdatedAt: desired.UpdatedAt, ApplyState: state,
		Editable: true, ApplySupported: false, Requirement: photoHostRequirement,
		HostRuntimeState: "unknown", HostControlState: "unavailable",
	}
	if host, observed := s.readPhotoIntelligenceHostStatus(); observed {
		result.HostObserved = true
		result.HostRuntimeState = host.State
		profile := host.ProfileConfigured
		result.HostProfileConfigured = &profile
	}
	if control, supported := s.readPhotoHostControlStatus(); supported {
		result.HostControlSupported = true
		result.HostControlState = control.State
		result.HostControlRevision = control.Revision
		result.HostAppliedRevision = control.AppliedRevision
		result.HostControlProfileVerified = control.ProfileVerified
	}
	// PH1b1 observation is NOT admin-authorized application. Preserve pending
	// until a separate audited revision/token-fenced dispatch exists.
	c.JSON(http.StatusOK, result)
}

func recordPhotoHostRevisionTx(tx *gorm.DB, revision uint64, enabled bool, origin string) error {
	var old meta.AdminPhotoHostRevision
	err := tx.Where("name = ? AND revision = ?", photoHostSettingName, revision).Take(&old).Error
	if err == nil {
		if old.Enabled != enabled {
			return errors.New("immutable Photo Intelligence host revision mismatch")
		}
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return tx.Create(&meta.AdminPhotoHostRevision{
		Name: photoHostSettingName, Revision: revision,
		Enabled: enabled, Origin: origin, CreatedAt: time.Now().UTC(),
	}).Error
}

func (s *Server) adminSavePhotoHostDesired(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s == nil || s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "Photo Intelligence host desired database unavailable")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 512)
	var input struct {
		Revision *uint64 `json:"revision"`
		Enabled  *bool   `json:"enabled"`
	}
	if c.ShouldBindJSON(&input) != nil || input.Revision == nil || input.Enabled == nil ||
		*input.Revision >= 1<<60 {
		fail(c, http.StatusBadRequest, "complete revisioned Photo Intelligence host intent required")
		return
	}
	s.photoHostDesiredSaveMu.Lock()
	defer s.photoHostDesiredSaveMu.Unlock()
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var old meta.AdminPhotoHostSetting
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", photoHostSettingName).Take(&old).Error
		exists := err == nil
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if (exists && old.Revision != *input.Revision) || (!exists && *input.Revision != 0) {
			return errPhotoHostRevisionConflict
		}
		before, origin := false, "default"
		if exists {
			before, origin = old.Enabled, "saved"
		}
		if err := recordPhotoHostRevisionTx(tx, *input.Revision, before, origin); err != nil {
			return err
		}
		next := *input.Revision + 1
		if exists {
			updated := tx.Model(&meta.AdminPhotoHostSetting{}).
				Where("name = ? AND revision = ?", photoHostSettingName, old.Revision).
				Updates(map[string]any{"enabled": *input.Enabled, "revision": next, "updated_at": time.Now().UTC()})
			if updated.Error != nil {
				return updated.Error
			}
			if updated.RowsAffected != 1 {
				return errPhotoHostRevisionConflict
			}
		} else {
			created := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&meta.AdminPhotoHostSetting{
				Name: photoHostSettingName, Revision: next, Enabled: *input.Enabled,
			})
			if created.Error != nil {
				return created.Error
			}
			if created.RowsAffected != 1 {
				return errPhotoHostRevisionConflict
			}
		}
		if err := recordPhotoHostRevisionTx(tx, next, *input.Enabled, "saved"); err != nil {
			return err
		}
		return recordAuditTx(tx, auditEventFromContext(c,
			"admin.service.photo-host.desired.configure", "service", "photo-intelligence",
			"Photo Intelligence host desired configuration", auditpkg.ResultSuccess,
			map[string]any{"revision": next, "desired_enabled": *input.Enabled, "host_applied": false},
		))
	})
	if errors.Is(err, errPhotoHostRevisionConflict) {
		fail(c, http.StatusConflict, "Photo Intelligence host desired revision changed; refresh")
		return
	}
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Photo Intelligence desired configuration not saved or audited")
		return
	}
	s.adminPhotoHostConfig(c)
}

func (s *Server) adminPhotoHostRevisions(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s == nil || s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "Photo Intelligence host history unavailable")
		return
	}
	var rows []meta.AdminPhotoHostRevision
	if err := s.DB.WithContext(c.Request.Context()).Where("name = ?", photoHostSettingName).
		Order("revision DESC").Limit(40).Find(&rows).Error; err != nil {
		fail(c, http.StatusServiceUnavailable, "Photo Intelligence host history unavailable")
		return
	}
	items := make([]adminPhotoHostRevisionDTO, 0, len(rows))
	for _, row := range rows {
		items = append(items, adminPhotoHostRevisionDTO{
			Revision: row.Revision, Enabled: row.Enabled,
			Origin: row.Origin, CreatedAt: row.CreatedAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (s *Server) adminRollbackPhotoHostDesired(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s == nil || s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "Photo Intelligence host desired database unavailable")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 512)
	var input struct {
		Revision       *uint64 `json:"revision"`
		TargetRevision *uint64 `json:"target_revision"`
	}
	if c.ShouldBindJSON(&input) != nil || input.Revision == nil || input.TargetRevision == nil ||
		*input.Revision == 0 || *input.Revision >= 1<<60 ||
		*input.TargetRevision >= *input.Revision {
		fail(c, http.StatusBadRequest, "current and older Photo Intelligence host revisions required")
		return
	}
	s.photoHostDesiredSaveMu.Lock()
	defer s.photoHostDesiredSaveMu.Unlock()
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var row meta.AdminPhotoHostSetting
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", photoHostSettingName).Take(&row).Error; err != nil {
			return err
		}
		if row.Revision != *input.Revision {
			return errPhotoHostRevisionConflict
		}
		var history meta.AdminPhotoHostRevision
		if err := tx.Where("name = ? AND revision = ?", photoHostSettingName, *input.TargetRevision).
			Take(&history).Error; err != nil {
			return err
		}
		if err := recordPhotoHostRevisionTx(tx, row.Revision, row.Enabled, "saved"); err != nil {
			return err
		}
		next := row.Revision + 1
		updated := tx.Model(&meta.AdminPhotoHostSetting{}).
			Where("name = ? AND revision = ?", photoHostSettingName, row.Revision).
			Updates(map[string]any{"enabled": history.Enabled, "revision": next, "updated_at": time.Now().UTC()})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return errPhotoHostRevisionConflict
		}
		if err := recordPhotoHostRevisionTx(tx, next, history.Enabled, "rollback"); err != nil {
			return err
		}
		return recordAuditTx(tx, auditEventFromContext(c,
			"admin.service.photo-host.desired.rollback", "service", "photo-intelligence",
			"Photo Intelligence host desired rollback", auditpkg.ResultSuccess,
			map[string]any{"revision": next, "target_revision": *input.TargetRevision,
				"desired_enabled": history.Enabled, "host_applied": false},
		))
	})
	if errors.Is(err, errPhotoHostRevisionConflict) {
		fail(c, http.StatusConflict, "Photo Intelligence host desired revision changed")
		return
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		fail(c, http.StatusNotFound, "Photo Intelligence host historical revision not found")
		return
	}
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Photo Intelligence host rollback not saved or audited")
		return
	}
	s.adminPhotoHostConfig(c)
}
