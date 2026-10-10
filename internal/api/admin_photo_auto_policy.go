package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const photoAutoSettingName = "automatic"

var errPhotoAutoRevisionConflict = errors.New("photo intelligence policy revision changed")

type photoAutoDesired struct {
	AutoEnabled bool
	Revision    uint64
	Source      string
	UpdatedAt   *time.Time
}

type photoAutoRuntime struct {
	AutoEnabled bool
	Revision    uint64
}

type adminPhotoAutoConfigDTO struct {
	AutoEnabled          bool       `json:"auto_enabled"`
	EffectiveAutoEnabled bool       `json:"effective_auto_enabled"`
	Revision             uint64     `json:"revision"`
	EffectiveRevision    uint64     `json:"effective_revision"`
	Source               string     `json:"source"`
	ApplyState           string     `json:"apply_state"`
	Editable             bool       `json:"editable"`
	RequiresRestart      bool       `json:"requires_restart"`
	UpdatedAt            *time.Time `json:"updated_at,omitempty"`
}

// Missing persisted settings preserve existing deployments: automatic analysis
// remains on by default. An unreadable persisted row is never ignored.
func photoAutoDesiredSettings(ctx context.Context, db *gorm.DB) (photoAutoDesired, error) {
	def := photoAutoDesired{AutoEnabled: true, Source: "default"}
	if db == nil {
		return def, nil
	}
	var row meta.AdminPhotoAutoSetting
	err := db.WithContext(ctx).Where("name = ?", photoAutoSettingName).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return def, nil
	}
	if err != nil {
		return photoAutoDesired{}, err
	}
	if row.Revision == 0 {
		return photoAutoDesired{}, errors.New("invalid persisted photo intelligence policy")
	}
	return photoAutoDesired{
		AutoEnabled: row.AutoEnabled, Revision: row.Revision,
		Source: "saved", UpdatedAt: &row.UpdatedAt,
	}, nil
}

// A stale reconcile read must not undo a newer committed admin update.
func (s *Server) setPhotoAutoRuntime(next photoAutoDesired) {
	value := &photoAutoRuntime{AutoEnabled: next.AutoEnabled, Revision: next.Revision}
	for {
		old := s.photoAutoPolicy.Load()
		if old != nil && old.Revision > value.Revision {
			return
		}
		if s.photoAutoPolicy.CompareAndSwap(old, value) {
			return
		}
	}
}

func (s *Server) refreshPhotoAutoPolicy(ctx context.Context) error {
	desired, err := photoAutoDesiredSettings(ctx, s.DB)
	if err != nil {
		return err
	}
	s.setPhotoAutoRuntime(desired)
	return nil
}

// Manual re-analysis always remains available; GeoNames place-label resolution
// follows its independent service policy.
func (s *Server) photoAutoAllows(kind photoIntelligenceTaskKind, trigger background.Trigger) bool {
	if kind == photoIntelligencePlace ||
		trigger == background.TriggerUserAction || trigger == background.TriggerAdminAction {
		return true
	}
	policy := s.photoAutoPolicy.Load()
	return policy == nil || policy.AutoEnabled
}

func (s *Server) adminPhotoAutoConfig(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "photo intelligence policy storage is unavailable")
		return
	}
	desired, err := photoAutoDesiredSettings(c.Request.Context(), s.DB)
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "photo intelligence policy could not be read")
		return
	}
	effective := s.photoAutoPolicy.Load()
	enabled, revision := true, uint64(0)
	if effective != nil {
		enabled, revision = effective.AutoEnabled, effective.Revision
	}
	state := "pending"
	if effective != nil && desired.AutoEnabled == enabled && desired.Revision == revision {
		state = "applied"
	}
	c.JSON(http.StatusOK, adminPhotoAutoConfigDTO{
		AutoEnabled: desired.AutoEnabled, EffectiveAutoEnabled: enabled,
		Revision: desired.Revision, EffectiveRevision: revision,
		Source: desired.Source, ApplyState: state, Editable: true,
		RequiresRestart: false, UpdatedAt: desired.UpdatedAt,
	})
}

func (s *Server) adminSavePhotoAutoConfig(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "photo intelligence policy storage is unavailable")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 512)
	var input struct {
		Revision    *uint64 `json:"revision"`
		AutoEnabled *bool   `json:"auto_enabled"`
	}
	if c.ShouldBindJSON(&input) != nil || input.Revision == nil || input.AutoEnabled == nil {
		fail(c, http.StatusBadRequest, "photo intelligence auto_enabled and revision are required")
		return
	}
	s.photoAutoSaveMu.Lock()
	defer s.photoAutoSaveMu.Unlock()
	ctx := c.Request.Context()
	nextRevision := uint64(0)
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row meta.AdminPhotoAutoSetting
		readErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", photoAutoSettingName).Take(&row).Error
		exists := readErr == nil
		if readErr != nil && !errors.Is(readErr, gorm.ErrRecordNotFound) {
			return readErr
		}
		if (exists && row.Revision != *input.Revision) ||
			(!exists && *input.Revision != 0) {
			return errPhotoAutoRevisionConflict
		}
		nextRevision = *input.Revision + 1
		if exists {
			write := tx.Model(&meta.AdminPhotoAutoSetting{}).
				Where("name = ? AND revision = ?", photoAutoSettingName, row.Revision).
				Updates(map[string]any{
					"auto_enabled": *input.AutoEnabled, "revision": nextRevision,
					"updated_at": time.Now().UTC(),
				})
			if write.Error != nil {
				return write.Error
			}
			if write.RowsAffected != 1 {
				return errPhotoAutoRevisionConflict
			}
		} else {
			write := tx.Clauses(clause.OnConflict{DoNothing: true}).
				Create(&meta.AdminPhotoAutoSetting{
					Name: photoAutoSettingName, AutoEnabled: *input.AutoEnabled, Revision: nextRevision,
				})
			if write.Error != nil {
				return write.Error
			}
			if write.RowsAffected != 1 {
				return errPhotoAutoRevisionConflict
			}
		}
		return recordAuditTx(tx, auditEventFromContext(
			c, "admin.service.photo-intelligence.auto-policy", "service", "photo-intelligence",
			"Photo Intelligence 自动分析", auditpkg.ResultSuccess,
			map[string]any{"revision": nextRevision, "auto_enabled": *input.AutoEnabled},
		))
	})
	if err != nil {
		if errors.Is(err, errPhotoAutoRevisionConflict) {
			fail(c, http.StatusConflict, "photo intelligence policy changed; refresh and retry")
		} else {
			fail(c, http.StatusServiceUnavailable, "photo intelligence policy could not be saved and audited")
		}
		return
	}
	s.setPhotoAutoRuntime(photoAutoDesired{
		AutoEnabled: *input.AutoEnabled, Revision: nextRevision,
	})
	s.adminPhotoAutoConfig(c)
}
