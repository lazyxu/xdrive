package api

import (
	"errors"
	"net/http"
	"sort"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourceworkerpolicy"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var errSourceWorkerRevisionConflict = errors.New("source worker configuration revision changed")

type sourceWorkerEffectiveGroup struct {
	Config   sourceworkerpolicy.Values `json:"config"`
	Revision uint64                    `json:"revision"`
	Count    int                       `json:"count"`
}

type sourceWorkerConfigDTO struct {
	Desired          sourceworkerpolicy.Values    `json:"desired"`
	Revision         uint64                       `json:"revision"`
	Source           string                       `json:"source"`
	UpdatedAt        *time.Time                   `json:"updated_at,omitempty"`
	Effective        []sourceWorkerEffectiveGroup `json:"effective"`
	ActiveInstances  int                          `json:"active_instances"`
	AppliedInstances int                          `json:"applied_instances"`
	Truncated        bool                         `json:"truncated"`
	ApplyState       string                       `json:"apply_state"`
	Editable         bool                         `json:"editable"`
	RequiresRestart  bool                         `json:"requires_restart"`
}

func summarizeSourceWorkerEffective(desired sourceworkerpolicy.Desired, rows []meta.SourceWorkerPresence, truncated bool) (string, int, []sourceWorkerEffectiveGroup) {
	groups := make(map[sourceWorkerEffectiveGroup]int)
	applied := 0
	for _, row := range rows {
		values := sourceworkerpolicy.Values{
			ScanIntervalSeconds: row.ScanIntervalSeconds,
			PollIntervalSeconds: row.PollIntervalSeconds,
			MaxConcurrency:      row.MaxConcurrency,
		}
		key := sourceWorkerEffectiveGroup{Config: values, Revision: row.AppliedRevision}
		groups[key]++
		if desired.Revision != 0 && desired.Revision == row.AppliedRevision && desired.Values == values {
			applied++
		}
	}
	result := make([]sourceWorkerEffectiveGroup, 0, len(groups))
	for key, count := range groups {
		key.Count = count
		result = append(result, key)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Revision != result[j].Revision {
			return result[i].Revision > result[j].Revision
		}
		if result[i].Config.ScanIntervalSeconds != result[j].Config.ScanIntervalSeconds {
			return result[i].Config.ScanIntervalSeconds < result[j].Config.ScanIntervalSeconds
		}
		if result[i].Config.PollIntervalSeconds != result[j].Config.PollIntervalSeconds {
			return result[i].Config.PollIntervalSeconds < result[j].Config.PollIntervalSeconds
		}
		return result[i].Config.MaxConcurrency < result[j].Config.MaxConcurrency
	})
	if desired.Revision == 0 {
		return "unmanaged", applied, result
	}
	if len(rows) == 0 {
		return "unavailable", applied, result
	}
	if !truncated && applied == len(rows) {
		return "applied", applied, result
	}
	return "pending", applied, result
}

func (s *Server) adminSourceWorkerConfig(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "source worker settings are unavailable")
		return
	}
	ctx := c.Request.Context()
	desired, err := sourceworkerpolicy.Read(ctx, s.DB)
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "source worker settings could not be read")
		return
	}
	var rows []meta.SourceWorkerPresence
	if err := s.DB.WithContext(ctx).Where("expires_at > ?", time.Now().UTC()).
		Order("instance_id ASC").Limit(101).Find(&rows).Error; err != nil {
		fail(c, http.StatusServiceUnavailable, "source worker heartbeat state could not be read")
		return
	}
	truncated := len(rows) > 100
	if truncated {
		rows = rows[:100]
	}
	state, applied, groups := summarizeSourceWorkerEffective(desired, rows, truncated)
	c.JSON(http.StatusOK, sourceWorkerConfigDTO{
		Desired: desired.Values, Revision: desired.Revision, Source: desired.Source,
		UpdatedAt: desired.UpdatedAt, Effective: groups,
		ActiveInstances: len(rows), AppliedInstances: applied, Truncated: truncated,
		ApplyState: state, Editable: true, RequiresRestart: false,
	})
}

type sourceWorkerUpdateInput struct {
	Revision *uint64                    `json:"revision"`
	Desired  *sourceworkerpolicy.Values `json:"desired"`
}

func (s *Server) adminSaveSourceWorkerConfig(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "source worker settings are unavailable")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
	var input sourceWorkerUpdateInput
	if c.ShouldBindJSON(&input) != nil || input.Revision == nil ||
		input.Desired == nil || !sourceworkerpolicy.Valid(*input.Desired) {
		fail(c, http.StatusBadRequest, "source worker revision and complete valid desired settings are required")
		return
	}
	s.sourceWorkerConfigSaveMu.Lock()
	defer s.sourceWorkerConfigSaveMu.Unlock()
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var row meta.AdminSourceWorkerSetting
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", sourceworkerpolicy.SettingName).Take(&row).Error
		exists := err == nil
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if (exists && row.Revision != *input.Revision) || (!exists && *input.Revision != 0) {
			return errSourceWorkerRevisionConflict
		}
		before := sourceworkerpolicy.Defaults()
		origin := "default"
		if exists {
			before = sourceworkerpolicy.Values{
				ScanIntervalSeconds: row.ScanIntervalSeconds,
				PollIntervalSeconds: row.PollIntervalSeconds,
				MaxConcurrency:      row.MaxConcurrency,
			}
			origin = "saved"
		}
		if err := recordSourceWorkerRevisionTx(tx, *input.Revision, before, origin); err != nil {
			return err
		}
		nextRevision := *input.Revision + 1
		if exists {
			updated := tx.Model(&meta.AdminSourceWorkerSetting{}).
				Where("name = ? AND revision = ?", sourceworkerpolicy.SettingName, row.Revision).
				Updates(map[string]any{
					"scan_interval_seconds": input.Desired.ScanIntervalSeconds,
					"poll_interval_seconds": input.Desired.PollIntervalSeconds,
					"max_concurrency":       input.Desired.MaxConcurrency,
					"revision":              nextRevision, "updated_at": time.Now().UTC(),
				})
			if updated.Error != nil {
				return updated.Error
			}
			if updated.RowsAffected != 1 {
				return errSourceWorkerRevisionConflict
			}
		} else {
			created := tx.Clauses(clause.OnConflict{DoNothing: true}).
				Create(&meta.AdminSourceWorkerSetting{
					Name: sourceworkerpolicy.SettingName, Revision: nextRevision,
					ScanIntervalSeconds: input.Desired.ScanIntervalSeconds,
					PollIntervalSeconds: input.Desired.PollIntervalSeconds,
					MaxConcurrency:      input.Desired.MaxConcurrency,
				})
			if created.Error != nil {
				return created.Error
			}
			if created.RowsAffected != 1 {
				return errSourceWorkerRevisionConflict
			}
		}
		if err := recordSourceWorkerRevisionTx(tx, nextRevision, *input.Desired, "saved"); err != nil {
			return err
		}
		return recordAuditTx(tx, auditEventFromContext(
			c, "admin.service.source-worker.configure", "service", "source-worker",
			"独立 Pull Worker 调度", auditpkg.ResultSuccess,
			map[string]any{"revision": nextRevision, "desired": input.Desired},
		))
	})
	if err != nil {
		if errors.Is(err, errSourceWorkerRevisionConflict) {
			fail(c, http.StatusConflict, "source worker settings changed; refresh and retry")
		} else {
			fail(c, http.StatusServiceUnavailable, "source worker configuration could not be saved and audited")
		}
		return
	}
	// Saving desired state is not actual activation; wait for worker leases.
	s.adminSourceWorkerConfig(c)
}
