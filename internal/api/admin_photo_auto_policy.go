package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
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

// These are task admission groups, not individual model/container lifecycle
// switches. Smart visual classification and OCR share one task kind today.
type photoAutoKinds struct {
	Face          bool `json:"face"`
	Smart         bool `json:"smart"`
	Semantic      bool `json:"semantic"`
	PersonCluster bool `json:"person_cluster"`
}

func defaultPhotoAutoKinds() photoAutoKinds {
	return photoAutoKinds{Face: true, Smart: true, Semantic: true, PersonCluster: true}
}

func effectivePhotoAutoKinds(value *photoAutoKinds) photoAutoKinds {
	if value == nil {
		return defaultPhotoAutoKinds()
	}
	return *value
}

// The empty persisted value means "legacy/default: all four enabled".
// Non-empty JSON must contain EXACTLY four booleans. Fail closed on corruption
// instead of silently changing what scheduled tasks can run.
func parsePhotoAutoKinds(raw string) (*photoAutoKinds, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	var values map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &values); err != nil {
		return nil, fmt.Errorf("invalid photo intelligence kind policy: %w", err)
	}
	if len(values) != 4 {
		return nil, errors.New("photo intelligence kinds require exactly four switches")
	}
	for _, key := range []string{"face", "smart", "semantic", "person_cluster"} {
		value, ok := values[key]
		if !ok || (string(value) != "true" && string(value) != "false") {
			return nil, fmt.Errorf("invalid photo intelligence %s switch", key)
		}
	}
	var kinds photoAutoKinds
	if err := json.Unmarshal([]byte(raw), &kinds); err != nil {
		return nil, err
	}
	return &kinds, nil
}

func (k photoAutoKinds) allows(kind photoIntelligenceTaskKind) bool {
	switch kind {
	case photoIntelligenceFace:
		return k.Face
	case photoIntelligenceSmartSearch:
		return k.Smart
	case photoIntelligenceSemanticSearch:
		return k.Semantic
	case photoIntelligencePersonCluster:
		return k.PersonCluster
	default:
		return true
	}
}

type photoAutoDesired struct {
	AutoEnabled bool
	Kinds       *photoAutoKinds
	Revision    uint64
	Source      string
	UpdatedAt   *time.Time
}

type photoAutoRuntime struct {
	AutoEnabled bool
	Kinds       *photoAutoKinds
	Revision    uint64
}

type adminPhotoAutoConfigDTO struct {
	AutoEnabled          bool           `json:"auto_enabled"`
	EffectiveAutoEnabled bool           `json:"effective_auto_enabled"`
	Kinds                photoAutoKinds `json:"kinds"`
	EffectiveKinds       photoAutoKinds `json:"effective_kinds"`
	Revision             uint64         `json:"revision"`
	EffectiveRevision    uint64         `json:"effective_revision"`
	Source               string         `json:"source"`
	ApplyState           string         `json:"apply_state"`
	Editable             bool           `json:"editable"`
	RequiresRestart      bool           `json:"requires_restart"`
	UpdatedAt            *time.Time     `json:"updated_at,omitempty"`
}

// Missing persisted settings preserve existing deployments: automatic analysis
// and each individual group remain on by default. Unreadable/corrupt policy
// must never turn previously disabled automatic analysis back on.
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
	kinds, err := parsePhotoAutoKinds(row.KindsJSON)
	if err != nil {
		return photoAutoDesired{}, err
	}
	return photoAutoDesired{
		AutoEnabled: row.AutoEnabled, Kinds: kinds, Revision: row.Revision,
		Source: "saved", UpdatedAt: &row.UpdatedAt,
	}, nil
}

// A stale reconcile read must not undo a newer committed administrator update.
func (s *Server) setPhotoAutoRuntime(next photoAutoDesired) {
	value := &photoAutoRuntime{
		AutoEnabled: next.AutoEnabled, Kinds: next.Kinds, Revision: next.Revision,
	}
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

// A policy changes admission for new automatic jobs and is checked once more
// before queued work starts. Manual reanalysis and GeoNames remain available.
// In-flight analysis and durable transfers are never interrupted.
func (s *Server) photoAutoAllows(kind photoIntelligenceTaskKind, trigger background.Trigger) bool {
	if kind == photoIntelligencePlace ||
		trigger == background.TriggerUserAction || trigger == background.TriggerAdminAction {
		return true
	}
	policy := s.photoAutoPolicy.Load()
	if policy == nil {
		return true
	}
	return policy.AutoEnabled && effectivePhotoAutoKinds(policy.Kinds).allows(kind)
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
	activeKinds := defaultPhotoAutoKinds()
	if effective != nil {
		enabled, revision = effective.AutoEnabled, effective.Revision
		activeKinds = effectivePhotoAutoKinds(effective.Kinds)
	}
	desiredKinds := effectivePhotoAutoKinds(desired.Kinds)
	state := "pending"
	if effective != nil && desired.AutoEnabled == enabled &&
		desired.Revision == revision && desiredKinds == activeKinds {
		state = "applied"
	}
	c.JSON(http.StatusOK, adminPhotoAutoConfigDTO{
		AutoEnabled: desired.AutoEnabled, EffectiveAutoEnabled: enabled,
		Kinds: desiredKinds, EffectiveKinds: activeKinds,
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
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
	var input struct {
		Revision    *uint64         `json:"revision"`
		AutoEnabled *bool           `json:"auto_enabled"`
		Kinds       json.RawMessage `json:"kinds"`
	}
	if c.ShouldBindJSON(&input) != nil || input.Revision == nil || input.AutoEnabled == nil {
		fail(c, http.StatusBadRequest, "photo intelligence auto_enabled and revision are required")
		return
	}
	var proposedKinds *photoAutoKinds
	if len(input.Kinds) != 0 {
		var err error
		proposedKinds, err = parsePhotoAutoKinds(string(input.Kinds))
		if err != nil || proposedKinds == nil {
			fail(c, http.StatusBadRequest, "all four photo intelligence kind switches are required booleans")
			return
		}
	}
	s.photoAutoSaveMu.Lock()
	defer s.photoAutoSaveMu.Unlock()
	ctx := c.Request.Context()
	nextRevision := uint64(0)
	var appliedKinds *photoAutoKinds
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
		// Old Web/Desktop clients still send only the global boolean. Preserve
		// an already saved per-kind policy when the new field is omitted.
		rawKinds := ""
		if exists {
			rawKinds = row.KindsJSON
			savedKinds, err := parsePhotoAutoKinds(rawKinds)
			if err != nil {
				return err
			}
			appliedKinds = savedKinds
		}
		if proposedKinds != nil {
			data, err := json.Marshal(proposedKinds)
			if err != nil {
				return err
			}
			rawKinds = string(data)
			appliedKinds = proposedKinds
		}
		nextRevision = *input.Revision + 1
		if exists {
			write := tx.Model(&meta.AdminPhotoAutoSetting{}).
				Where("name = ? AND revision = ?", photoAutoSettingName, row.Revision).
				Updates(map[string]any{
					"auto_enabled": *input.AutoEnabled,
					"kinds_json":   rawKinds,
					"revision":     nextRevision,
					"updated_at":   time.Now().UTC(),
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
					Name: photoAutoSettingName, AutoEnabled: *input.AutoEnabled,
					KindsJSON: rawKinds, Revision: nextRevision,
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
			map[string]any{
				"revision": nextRevision, "auto_enabled": *input.AutoEnabled,
				"kinds": effectivePhotoAutoKinds(appliedKinds),
			},
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
		AutoEnabled: *input.AutoEnabled, Kinds: appliedKinds, Revision: nextRevision,
	})
	s.adminPhotoAutoConfig(c)
}
