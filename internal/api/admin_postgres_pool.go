package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	postgresPoolSettingName       = "server"
	postgresPoolReconcileInterval = 30 * time.Second
	postgresPoolRevisionLimit     = 40
)

var errPostgresPoolRevisionConflict = errors.New("PostgreSQL connection pool revision changed")

// 0 max-open retains database/sql's original unlimited-open default;
// idle=2 is the Go default. A managed nonzero limit must leave enough
// connections for live xDrive API/database operations; never permit 1.
type postgresPoolValues struct {
	MaxOpenConnections int `json:"max_open_connections"`
	MaxIdleConnections int `json:"max_idle_connections"`
}

// A complete object is required: omitted fields must not silently change a
// live Server's idle/open pool limits to zero.
func (value *postgresPoolValues) UnmarshalJSON(data []byte) error {
	var input struct {
		MaxOpenConnections *int `json:"max_open_connections"`
		MaxIdleConnections *int `json:"max_idle_connections"`
	}
	if err := json.Unmarshal(data, &input); err != nil {
		return err
	}
	if input.MaxOpenConnections == nil || input.MaxIdleConnections == nil {
		return errors.New("both PostgreSQL pool limits must be supplied")
	}
	*value = postgresPoolValues{MaxOpenConnections: *input.MaxOpenConnections, MaxIdleConnections: *input.MaxIdleConnections}
	return nil
}

func defaultPostgresPoolValues() postgresPoolValues {
	return postgresPoolValues{MaxOpenConnections: 0, MaxIdleConnections: 2}
}

func validPostgresPoolValues(value postgresPoolValues) bool {
	return (value.MaxOpenConnections == 0 ||
		(value.MaxOpenConnections >= 8 && value.MaxOpenConnections <= 256)) &&
		value.MaxIdleConnections >= 0 && value.MaxIdleConnections <= 32 &&
		(value.MaxOpenConnections == 0 || value.MaxIdleConnections <= value.MaxOpenConnections)
}

type postgresPoolDesired struct {
	Values    postgresPoolValues
	Revision  uint64
	Source    string
	UpdatedAt *time.Time
}

type postgresPoolRuntime struct {
	Values   postgresPoolValues
	Revision uint64
}

func readPostgresPoolDesired(ctx context.Context, db *gorm.DB) (postgresPoolDesired, error) {
	initial := postgresPoolDesired{Values: defaultPostgresPoolValues(), Source: "default"}
	if db == nil {
		return initial, nil
	}
	var row meta.AdminPostgresPoolSetting
	err := db.WithContext(ctx).Where("name = ?", postgresPoolSettingName).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return initial, nil
	}
	if err != nil {
		return postgresPoolDesired{}, err
	}
	values := postgresPoolValues{MaxOpenConnections: row.MaxOpenConnections, MaxIdleConnections: row.MaxIdleConnections}
	if row.Revision == 0 || !validPostgresPoolValues(values) {
		return postgresPoolDesired{}, errors.New("stored PostgreSQL pool policy is invalid")
	}
	return postgresPoolDesired{Values: values, Revision: row.Revision, Source: "saved", UpdatedAt: &row.UpdatedAt}, nil
}

// All changes happen only to this Server process's *sql.DB. This operation
// cannot change PostgreSQL server settings, DSN, credentials or storage.
func (s *Server) applyPostgresPoolDesired(next postgresPoolDesired) error {
	if s == nil || s.DB == nil || !validPostgresPoolValues(next.Values) {
		return errors.New("PostgreSQL connection pool is unavailable or invalid")
	}
	sqlDB, err := s.DB.DB()
	if err != nil {
		return err
	}
	sqlDB.SetMaxOpenConns(next.Values.MaxOpenConnections)
	sqlDB.SetMaxIdleConns(next.Values.MaxIdleConnections)
	if sqlDB.Stats().MaxOpenConnections != next.Values.MaxOpenConnections {
		return errors.New("PostgreSQL pool did not apply the desired open connection limit")
	}
	s.postgresPoolApplied.Store(&postgresPoolRuntime{Values: next.Values, Revision: next.Revision})
	return nil
}

// Current-process only. Other Server replicas apply separately on their next
// 30-second poll. No cluster-wide health or applied claim is made here.
func (s *Server) reconcilePostgresPool(ctx context.Context) error {
	if s == nil || s.DB == nil || !s.postgresPoolSaveMu.TryLock() {
		return nil
	}
	defer s.postgresPoolSaveMu.Unlock()
	next, err := readPostgresPoolDesired(ctx, s.DB)
	if err != nil {
		return fmt.Errorf("read PostgreSQL pool desired state: %w", err)
	}
	if next.Revision == 0 {
		// Preserve existing Go defaults and any operator-managed code config.
		// Never mark an unmanaged pool as administrator-applied.
		return nil
	}
	sqlDB, err := s.DB.DB()
	if err != nil {
		return err
	}
	applied := s.postgresPoolApplied.Load()
	if applied != nil && applied.Revision == next.Revision && applied.Values == next.Values &&
		sqlDB.Stats().MaxOpenConnections == next.Values.MaxOpenConnections {
		return nil
	}
	confirmed, err := readPostgresPoolDesired(ctx, s.DB)
	if err != nil {
		return err
	}
	if confirmed.Revision != next.Revision || confirmed.Values != next.Values {
		return nil
	}
	return s.applyPostgresPoolDesired(confirmed)
}

func (s *Server) StartPostgresPoolReconciliation(ctx context.Context) {
	if s == nil || s.DB == nil {
		return
	}
	if err := s.reconcilePostgresPool(ctx); err != nil {
		slog.Warn("postgres_pool_startup_apply_failed", "error", err)
	}
	go func() {
		ticker := time.NewTicker(postgresPoolReconcileInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := s.reconcilePostgresPool(ctx); err != nil && ctx.Err() == nil {
					slog.Warn("postgres_pool_reconcile_failed", "error", err)
				}
			}
		}
	}()
}

type adminPostgresPoolConfigDTO struct {
	Desired           postgresPoolValues         `json:"desired"`
	Effective         *postgresPoolValues        `json:"effective,omitempty"`
	Revision          uint64                     `json:"revision"`
	EffectiveRevision uint64                     `json:"effective_revision"`
	Source            string                     `json:"source"`
	ApplyState        string                     `json:"apply_state"`
	Editable          bool                       `json:"editable"`
	RequiresRestart   bool                       `json:"requires_restart"`
	UpdatedAt         *time.Time                 `json:"updated_at,omitempty"`
	CurrentMaxOpen    int                        `json:"current_max_open_connections"`
	OpenConnections   int                        `json:"open_connections"`
	InUseConnections  int                        `json:"in_use_connections"`
	IdleConnections   int                        `json:"idle_connections"`
	Replicas          postgresPoolReplicaSummary `json:"replicas"`
}

func (s *Server) adminPostgresPoolConfig(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s == nil || s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "PostgreSQL connection pool is unavailable")
		return
	}
	sqlDB, err := s.DB.DB()
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "PostgreSQL pool handle is unavailable")
		return
	}
	desired, err := readPostgresPoolDesired(c.Request.Context(), s.DB)
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "PostgreSQL pool settings could not be read")
		return
	}
	stats := sqlDB.Stats()
	runtime := s.postgresPoolApplied.Load()
	result := adminPostgresPoolConfigDTO{
		Desired: desired.Values, Revision: desired.Revision, Source: desired.Source,
		UpdatedAt: desired.UpdatedAt, Editable: true, RequiresRestart: false,
		CurrentMaxOpen: stats.MaxOpenConnections, OpenConnections: stats.OpenConnections,
		InUseConnections: stats.InUse, IdleConnections: stats.Idle,
		Replicas: s.readPostgresPoolReplicaSummary(c.Request.Context(), desired),
	}
	if desired.Revision == 0 {
		result.ApplyState = "unmanaged"
	} else {
		result.ApplyState = "pending"
	}
	if runtime != nil {
		effective := runtime.Values
		result.Effective = &effective
		result.EffectiveRevision = runtime.Revision
		if desired.Revision != 0 && runtime.Revision == desired.Revision &&
			runtime.Values == desired.Values &&
			stats.MaxOpenConnections == desired.Values.MaxOpenConnections {
			result.ApplyState = "applied"
		}
	}
	c.JSON(http.StatusOK, result)
}

func recordPostgresPoolRevisionTx(tx *gorm.DB, revision uint64, values postgresPoolValues, origin string) error {
	if !validPostgresPoolValues(values) {
		return errors.New("invalid PostgreSQL connection pool revision")
	}
	var found meta.AdminPostgresPoolRevision
	err := tx.Where("name = ? AND revision = ?", postgresPoolSettingName, revision).Take(&found).Error
	if err == nil {
		if found.MaxOpenConnections != values.MaxOpenConnections ||
			found.MaxIdleConnections != values.MaxIdleConnections {
			return errors.New("immutable PostgreSQL pool revision conflict")
		}
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return tx.Create(&meta.AdminPostgresPoolRevision{
		Name: postgresPoolSettingName, Revision: revision,
		MaxOpenConnections: values.MaxOpenConnections, MaxIdleConnections: values.MaxIdleConnections,
		Origin: origin, CreatedAt: time.Now().UTC(),
	}).Error
}

func (s *Server) adminSavePostgresPool(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s == nil || s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "PostgreSQL pool cannot be configured")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 512)
	var input struct {
		Revision *uint64             `json:"revision"`
		Desired  *postgresPoolValues `json:"desired"`
	}
	if c.ShouldBindJSON(&input) != nil || input.Revision == nil ||
		input.Desired == nil || !validPostgresPoolValues(*input.Desired) {
		fail(c, http.StatusBadRequest, "complete bounded pool values and expected revision are required")
		return
	}
	s.postgresPoolSaveMu.Lock()
	defer s.postgresPoolSaveMu.Unlock()
	nextRevision := *input.Revision + 1
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var old meta.AdminPostgresPoolSetting
		readErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", postgresPoolSettingName).Take(&old).Error
		exists := readErr == nil
		if readErr != nil && !errors.Is(readErr, gorm.ErrRecordNotFound) {
			return readErr
		}
		if (exists && old.Revision != *input.Revision) || (!exists && *input.Revision != 0) {
			return errPostgresPoolRevisionConflict
		}
		previous := defaultPostgresPoolValues()
		origin := "default"
		if exists {
			previous = postgresPoolValues{MaxOpenConnections: old.MaxOpenConnections, MaxIdleConnections: old.MaxIdleConnections}
			origin = "saved"
		}
		if err := recordPostgresPoolRevisionTx(tx, *input.Revision, previous, origin); err != nil {
			return err
		}
		if exists {
			update := tx.Model(&meta.AdminPostgresPoolSetting{}).
				Where("name = ? AND revision = ?", postgresPoolSettingName, old.Revision).
				Updates(map[string]any{
					"max_open_connections": input.Desired.MaxOpenConnections,
					"max_idle_connections": input.Desired.MaxIdleConnections,
					"revision":             nextRevision, "updated_at": time.Now().UTC(),
				})
			if update.Error != nil {
				return update.Error
			}
			if update.RowsAffected != 1 {
				return errPostgresPoolRevisionConflict
			}
		} else {
			write := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&meta.AdminPostgresPoolSetting{
				Name: postgresPoolSettingName, Revision: nextRevision,
				MaxOpenConnections: input.Desired.MaxOpenConnections,
				MaxIdleConnections: input.Desired.MaxIdleConnections,
			})
			if write.Error != nil {
				return write.Error
			}
			if write.RowsAffected != 1 {
				return errPostgresPoolRevisionConflict
			}
		}
		if err := recordPostgresPoolRevisionTx(tx, nextRevision, *input.Desired, "saved"); err != nil {
			return err
		}
		return recordAuditTx(tx, auditEventFromContext(
			c, "admin.service.postgres-pool.configure", "service", "postgresql",
			"PostgreSQL 连接池在线配置", auditpkg.ResultSuccess,
			map[string]any{"revision": nextRevision, "desired": input.Desired},
		))
	})
	if err != nil {
		if errors.Is(err, errPostgresPoolRevisionConflict) {
			fail(c, http.StatusConflict, "PostgreSQL pool revision changed; refresh and retry")
		} else {
			fail(c, http.StatusServiceUnavailable, "PostgreSQL pool settings or audit could not be saved")
		}
		return
	}
	if err := s.applyPostgresPoolDesired(postgresPoolDesired{Values: *input.Desired, Revision: nextRevision}); err != nil {
		fail(c, http.StatusServiceUnavailable, "PostgreSQL pool saved; current Server apply not confirmed")
		return
	}
	s.adminPostgresPoolConfig(c)
}

type postgresPoolRevisionDTO struct {
	Revision  uint64             `json:"revision"`
	Desired   postgresPoolValues `json:"desired"`
	Origin    string             `json:"origin"`
	CreatedAt time.Time          `json:"created_at"`
}

func (s *Server) adminPostgresPoolRevisions(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s == nil || s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "PostgreSQL pool history is unavailable")
		return
	}
	var rows []meta.AdminPostgresPoolRevision
	err := s.DB.WithContext(c.Request.Context()).Where("name = ?", postgresPoolSettingName).
		Order("revision DESC").Limit(postgresPoolRevisionLimit).Find(&rows).Error
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "PostgreSQL pool history is unavailable")
		return
	}
	items := make([]postgresPoolRevisionDTO, 0, len(rows))
	for _, row := range rows {
		items = append(items, postgresPoolRevisionDTO{
			Revision: row.Revision,
			Desired:  postgresPoolValues{MaxOpenConnections: row.MaxOpenConnections, MaxIdleConnections: row.MaxIdleConnections},
			Origin:   row.Origin, CreatedAt: row.CreatedAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (s *Server) adminRollbackPostgresPool(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s == nil || s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "PostgreSQL pool rollback is unavailable")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256)
	var input struct {
		Revision       *uint64 `json:"revision"`
		TargetRevision *uint64 `json:"target_revision"`
	}
	if c.ShouldBindJSON(&input) != nil || input.Revision == nil ||
		input.TargetRevision == nil || *input.TargetRevision >= *input.Revision {
		fail(c, http.StatusBadRequest, "current and older target revision are required")
		return
	}
	s.postgresPoolSaveMu.Lock()
	defer s.postgresPoolSaveMu.Unlock()
	desired, err := readPostgresPoolDesired(c.Request.Context(), s.DB)
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "PostgreSQL pool current settings are unavailable")
		return
	}
	if desired.Revision != *input.Revision {
		fail(c, http.StatusConflict, "PostgreSQL pool revision changed; refresh and retry")
		return
	}
	var historical meta.AdminPostgresPoolRevision
	err = s.DB.WithContext(c.Request.Context()).
		Where("name = ? AND revision = ?", postgresPoolSettingName, *input.TargetRevision).
		Take(&historical).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		fail(c, http.StatusNotFound, "PostgreSQL pool historical revision not found")
		return
	}
	target := postgresPoolValues{MaxOpenConnections: historical.MaxOpenConnections, MaxIdleConnections: historical.MaxIdleConnections}
	if err != nil || !validPostgresPoolValues(target) {
		fail(c, http.StatusServiceUnavailable, "PostgreSQL pool historical revision is invalid or unavailable")
		return
	}
	nextRevision := desired.Revision + 1
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var row meta.AdminPostgresPoolSetting
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", postgresPoolSettingName).Take(&row).Error; err != nil {
			return err
		}
		if row.Revision != desired.Revision {
			return errPostgresPoolRevisionConflict
		}
		if err := recordPostgresPoolRevisionTx(tx, desired.Revision, desired.Values, "saved"); err != nil {
			return err
		}
		write := tx.Model(&meta.AdminPostgresPoolSetting{}).
			Where("name = ? AND revision = ?", postgresPoolSettingName, row.Revision).
			Updates(map[string]any{
				"max_open_connections": target.MaxOpenConnections,
				"max_idle_connections": target.MaxIdleConnections,
				"revision":             nextRevision, "updated_at": time.Now().UTC(),
			})
		if write.Error != nil {
			return write.Error
		}
		if write.RowsAffected != 1 {
			return errPostgresPoolRevisionConflict
		}
		if err := recordPostgresPoolRevisionTx(tx, nextRevision, target, "rollback"); err != nil {
			return err
		}
		return recordAuditTx(tx, auditEventFromContext(
			c, "admin.service.postgres-pool.rollback", "service", "postgresql",
			"PostgreSQL 连接池历史配置回滚", auditpkg.ResultSuccess,
			map[string]any{"revision": nextRevision, "target_revision": targetRevisionForAudit(input.TargetRevision),
				"desired": target},
		))
	})
	if err != nil {
		if errors.Is(err, errPostgresPoolRevisionConflict) {
			fail(c, http.StatusConflict, "PostgreSQL pool revision changed; refresh and retry")
		} else {
			fail(c, http.StatusServiceUnavailable, "PostgreSQL pool rollback or audit could not be saved")
		}
		return
	}
	if err := s.applyPostgresPoolDesired(postgresPoolDesired{Values: target, Revision: nextRevision}); err != nil {
		fail(c, http.StatusServiceUnavailable, "PostgreSQL pool rollback saved but not confirmed applied")
		return
	}
	s.adminPostgresPoolConfig(c)
}

// Avoid storing pointer-shaped fields in the administrator audit metadata.
func targetRevisionForAudit(value *uint64) uint64 {
	if value == nil {
		return 0
	}
	return *value
}
