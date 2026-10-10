package api

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var errGeoNamesMissingArchiveChanged = errors.New("GeoNames archived destination already exists")

// GET only examines the deployment-configured root and the audited manifest.
// Directory presence is NOT a fresh content hash and must never mean healthy.
func (s *Server) geoNamesMissingArchiveRecoveryStatus(c *gin.Context, desired geoNamesDesiredConfig, supported bool) (string, bool, string) {
	if desired.Fingerprint == "" {
		return "not-selected", false, "先从已验证的归档快照中选择一个持久化目标版本。"
	}
	if !supported {
		return "unavailable", false, "本实例需先加载 GeoNames、配置独立持久归档目录并完成数据库迁移。"
	}
	root, err := geoNamesSnapshotRoot(s.GeoNamesSnapshotDir, s.GeoNamesDataDir)
	if err != nil {
		return "unavailable", false, "归档存储目录不可用；请由部署管理员修复挂载及权限。"
	}
	location := filepath.Join(root, desired.Fingerprint)
	info, err := os.Lstat(location)
	if err == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return "invalid", false, "目标路径已存在但不是可信目录；本操作不会覆盖或删除。请由部署管理员检查。"
		}
		return "present-unverified", false, "目标目录存在但尚未重新校验。如内容损坏，请通过受控维护恢复，不会自动覆盖旧归档。"
	}
	if !errors.Is(err, os.ErrNotExist) {
		return "unavailable", false, "无法安全判断目标归档是否缺失；不会执行恢复。"
	}
	var manifest meta.AdminGeoNamesDatasetSnapshot
	if err := s.DB.WithContext(c.Request.Context()).Where("fingerprint = ?", desired.Fingerprint).Take(&manifest).Error; err != nil ||
		manifest.TotalBytes <= 0 || manifest.TotalBytes > geoNamesSnapshotMaxTotal {
		return "unavailable", false, "缺少有效的历史归档审计记录，无法从部署挂载恢复。"
	}
	return "missing", true, "仅当受信任部署挂载的三文件内容与已审计归档指纹和字节数完全一致时，才能恢复本实例并热应用；不会覆盖现有目录。"
}

// Restore only a missing, currently desired archive from the fixed trusted
// deployment mount. Never accept a host path, arbitrary bytes or an alternative
// target fingerprint. Existing directories (including corrupt ones) are never
// overwritten; this deliberately does not implement cross-replica transport.
func (s *Server) adminRestoreMissingGeoNamesSnapshot(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s == nil || s.DB == nil || s.GeoNamesRuntime == nil ||
		strings.TrimSpace(s.GeoNamesDataDir) == "" || s.GeoNamesRuntime.Snapshot() == nil {
		fail(c, http.StatusServiceUnavailable, "GeoNames runtime is unavailable for local recovery")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 512)
	var input struct {
		Revision            *uint64 `json:"revision"`
		ExpectedVersion     string  `json:"expected_version"`
		ExpectedFingerprint string  `json:"expected_fingerprint"`
	}
	if c.ShouldBindJSON(&input) != nil || input.Revision == nil ||
		len(input.ExpectedVersion) == 0 || len(input.ExpectedVersion) > 128 ||
		(input.ExpectedFingerprint != "" && !validGeoNamesSnapshotFingerprint(input.ExpectedFingerprint)) {
		fail(c, http.StatusBadRequest, "GeoNames revision, current version and fingerprint are required")
		return
	}
	// Stage already takes snapshot then reload locks. Preserve this order.
	if !s.geoNamesSnapshotMu.TryLock() {
		fail(c, http.StatusConflict, "GeoNames staging or recovery is in progress")
		return
	}
	defer s.geoNamesSnapshotMu.Unlock()
	if !s.geoNamesReloadMu.TryLock() {
		fail(c, http.StatusConflict, "GeoNames apply, radius edit or reload is in progress")
		return
	}
	defer s.geoNamesReloadMu.Unlock()

	current := s.GeoNamesRuntime.Snapshot()
	if current == nil || current.Version() != input.ExpectedVersion ||
		s.currentGeoNamesDatasetFingerprint() != input.ExpectedFingerprint {
		fail(c, http.StatusConflict, "GeoNames effective resolver changed; refresh and retry")
		return
	}
	ctx := c.Request.Context()
	desired, err := geoNamesDesiredSettings(ctx, s.DB, s.GeoNamesMaxDistanceKM)
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "GeoNames desired settings are unavailable")
		return
	}
	if desired.Revision != *input.Revision || desired.Fingerprint == "" ||
		!validGeoNamesSnapshotFingerprint(desired.Fingerprint) {
		fail(c, http.StatusConflict, "GeoNames desired snapshot or revision changed")
		return
	}
	root, err := geoNamesSnapshotRoot(s.GeoNamesSnapshotDir, s.GeoNamesDataDir)
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "GeoNames archive storage is not safely configured")
		return
	}
	destination := filepath.Join(root, desired.Fingerprint)
	if _, err := os.Lstat(destination); err == nil {
		fail(c, http.StatusConflict, "GeoNames archive path already exists; never overwrite archived data")
		return
	} else if !errors.Is(err, os.ErrNotExist) {
		fail(c, http.StatusServiceUnavailable, "GeoNames archived path cannot be inspected")
		return
	}

	var manifest meta.AdminGeoNamesDatasetSnapshot
	if err := s.DB.WithContext(ctx).Where("fingerprint = ?", desired.Fingerprint).Take(&manifest).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "GeoNames desired archive has no recorded manifest")
		} else {
			fail(c, http.StatusServiceUnavailable, "GeoNames archive manifest is unavailable")
		}
		return
	}
	if manifest.TotalBytes <= 0 || manifest.TotalBytes > geoNamesSnapshotMaxTotal {
		fail(c, http.StatusUnprocessableEntity, "GeoNames archived manifest is invalid")
		return
	}

	temp, fingerprint, size, version, err := copyAndValidateGeoNamesSnapshot(
		ctx, s.GeoNamesDataDir, root, desired.MaxDistanceKM,
	)
	if err != nil {
		fail(c, http.StatusUnprocessableEntity, "Trusted GeoNames deployment dataset failed full verification")
		return
	}
	defer func() { _ = os.RemoveAll(temp) }()
	if fingerprint != desired.Fingerprint || size != manifest.TotalBytes ||
		(manifest.CheckedRadiusKM == desired.MaxDistanceKM && version != manifest.ResolverVersion) {
		fail(c, http.StatusUnprocessableEntity, "Trusted deployment bytes do not match the recorded desired archive")
		return
	}
	candidate, err := photointelligence.LoadGeoNamesResolver(temp, desired.MaxDistanceKM)
	if err != nil || candidate.Version() != version || ctx.Err() != nil {
		fail(c, http.StatusUnprocessableEntity, "GeoNames recovery index could not be verified")
		return
	}

	// Audit and manifest revision check are transactionally guarded; the new
	// directory is removed on a failed commit and the runtime stays unchanged.
	published := false
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row meta.AdminGeoNamesSetting
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", geoNamesSettingName).Take(&row).Error; err != nil {
			return err
		}
		if row.Revision != desired.Revision || row.MaxDistanceKM != desired.MaxDistanceKM ||
			row.Fingerprint != desired.Fingerprint {
			return errGeoNamesRevisionConflict
		}
		if _, err := os.Lstat(destination); err == nil {
			return errGeoNamesMissingArchiveChanged
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if err := os.Rename(temp, destination); err != nil {
			return err
		}
		published = true
		return recordAuditTx(tx, auditEventFromContext(
			c, "admin.service.geonames.archive_restore_local", "service", geoNamesSettingName,
			"GeoNames 当前实例缺失归档恢复", auditpkg.ResultSuccess,
			map[string]any{
				"fingerprint": desired.Fingerprint,
				"revision":    desired.Revision,
				"total_bytes": size,
				"version":     version,
				"scope":       "current-instance",
			},
		))
	})
	if err != nil {
		if published {
			_ = os.RemoveAll(destination)
		}
		if errors.Is(err, errGeoNamesRevisionConflict) || errors.Is(err, errGeoNamesMissingArchiveChanged) {
			fail(c, http.StatusConflict, "GeoNames archive or desired revision changed during recovery")
		} else {
			fail(c, http.StatusServiceUnavailable, "GeoNames archive restore or audit failed; runtime unchanged")
		}
		return
	}
	// No persistent revision change: this instance has now rebuilt precisely
	// the version already selected and audited by the administrator.
	s.GeoNamesRuntime.Swap(candidate)
	s.SetGeoNamesStartupDataset(desired.Fingerprint)
	s.GeoNamesAppliedRevision.Store(desired.Revision)
	s.adminGeoNamesConfig(c)
}
