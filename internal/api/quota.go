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
	usage.PhysicalUsedBytes = usage.LogicalFileBytes + usage.TrashBytes + usage.HistoryBytes
	usage.OverQuota = usage.QuotaBytes > 0 && usage.PhysicalUsedBytes > usage.QuotaBytes
	return usage, nil
}

func (s *Server) ensureQuota(db *gorm.DB, uid uint64, additional int64, lockUser bool) (quotaUsageDTO, error) {
	if additional < 0 {
		additional = 0
	}
	usage, err := s.loadQuotaUsage(db, uid, lockUser)
	if err != nil {
		return quotaUsageDTO{}, err
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
