package api

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type quotaUsageDTO struct {
	QuotaBytes        int64 `json:"quota_bytes"`
	PhysicalUsedBytes int64 `json:"physical_used_bytes"`
	LogicalFileBytes  int64 `json:"logical_file_bytes"`
	TrashBytes        int64 `json:"trash_bytes"`
	HistoryBytes      int64 `json:"history_bytes"`
	OverQuota         bool  `json:"over_quota"`
}

type quotaExceededError struct {
	Usage      quotaUsageDTO
	Additional int64
}

func (e *quotaExceededError) Error() string { return "quota exceeded" }

func (s *Server) quotaUsage(c *gin.Context) {
	usage, err := s.loadQuotaUsage(s.DB, userID(c), false)
	if err != nil {
		fail(c, http.StatusInternalServerError, "load quota usage failed")
		return
	}
	c.JSON(http.StatusOK, usage)
}

func (s *Server) loadQuotaUsage(db *gorm.DB, uid uint64, lockUser bool) (quotaUsageDTO, error) {
	var user meta.User
	q := db
	if lockUser {
		q = q.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if err := q.First(&user, uid).Error; err != nil {
		return quotaUsageDTO{}, err
	}
	return quotaUsageForUser(db, user)
}

func quotaUsageForUser(db *gorm.DB, user meta.User) (quotaUsageDTO, error) {
	usage := quotaUsageDTO{QuotaBytes: user.QuotaBytes}
	row := db.Raw(`SELECT
COALESCE(SUM(CASE WHEN n.deleted_at IS NULL THEN f.size ELSE 0 END), 0),
COALESCE(SUM(CASE WHEN n.deleted_at IS NOT NULL THEN f.size ELSE 0 END), 0)
FROM xd_files f
JOIN xd_nodes n ON n.id = f.node_id
WHERE n.owner_id = ?`, user.ID).Row()
	if err := row.Scan(&usage.LogicalFileBytes, &usage.TrashBytes); err != nil {
		return quotaUsageDTO{}, err
	}
	row = db.Raw(`SELECT COALESCE(SUM(v.size), 0)
FROM xd_file_versions v
JOIN xd_nodes n ON n.id = v.node_id
WHERE n.owner_id = ?`, user.ID).Row()
	if err := row.Scan(&usage.HistoryBytes); err != nil {
		return quotaUsageDTO{}, err
	}
	row = db.Raw(`SELECT COALESCE(SUM(size), 0)
FROM (
  SELECT storage_key, MAX(size) AS size
  FROM (
    SELECT f.storage_key, f.size
    FROM xd_files f
    JOIN xd_nodes n ON n.id = f.node_id
    WHERE n.owner_id = ?
    UNION ALL
    SELECT v.storage_key, v.size
    FROM xd_file_versions v
    JOIN xd_nodes n ON n.id = v.node_id
    WHERE n.owner_id = ?
  ) refs
  GROUP BY storage_key
) unique_refs`, user.ID, user.ID).Row()
	if err := row.Scan(&usage.PhysicalUsedBytes); err != nil {
		return quotaUsageDTO{}, err
	}
	usage.OverQuota = usage.QuotaBytes > 0 && usage.PhysicalUsedBytes > usage.QuotaBytes
	return usage, nil
}

func (s *Server) ensureQuota(db *gorm.DB, uid uint64, additional int64, lockUser bool) (quotaUsageDTO, error) {
	return s.ensureQuotaForStorageKey(db, uid, additional, "", lockUser)
}

func (s *Server) ensureQuotaForStorageKey(
	db *gorm.DB,
	uid uint64,
	additional int64,
	storageKey string,
	lockUser bool,
) (quotaUsageDTO, error) {
	if additional < 0 {
		additional = 0
	}
	usage, err := s.loadQuotaUsage(db, uid, lockUser)
	if err != nil {
		return quotaUsageDTO{}, err
	}
	if storageKey != "" && additional > 0 {
		var references int64
		row := db.Raw(`SELECT COUNT(*)
FROM (
  SELECT f.storage_key
  FROM xd_files f
  JOIN xd_nodes n ON n.id = f.node_id
  WHERE n.owner_id = ? AND f.storage_key = ?
  UNION ALL
  SELECT v.storage_key
  FROM xd_file_versions v
  JOIN xd_nodes n ON n.id = v.node_id
  WHERE n.owner_id = ? AND v.storage_key = ?
) refs`, uid, storageKey, uid, storageKey).Row()
		if err := row.Scan(&references); err != nil {
			return quotaUsageDTO{}, err
		}
		if references > 0 {
			additional = 0
		}
	}
	if usage.QuotaBytes == 0 || additional == 0 {
		return usage, nil
	}
	remaining := usage.QuotaBytes - usage.PhysicalUsedBytes
	if remaining < 0 || additional > remaining {
		return usage, &quotaExceededError{Usage: usage, Additional: additional}
	}
	return usage, nil
}

func writeQuotaError(c *gin.Context, err error) bool {
	var quotaErr *quotaExceededError
	if !errors.As(err, &quotaErr) {
		return false
	}
	c.AbortWithStatusJSON(http.StatusInsufficientStorage, gin.H{
		"error":                     "quota_exceeded",
		"quota_bytes":               quotaErr.Usage.QuotaBytes,
		"physical_used_bytes":       quotaErr.Usage.PhysicalUsedBytes,
		"required_additional_bytes": quotaErr.Additional,
		"required_physical_bytes":   quotaErr.Usage.PhysicalUsedBytes + quotaErr.Additional,
	})
	return true
}
