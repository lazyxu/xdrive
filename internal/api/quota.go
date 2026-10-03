package api

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type quotaUsageDTO struct {
	QuotaBytes         int64  `json:"quota_bytes"`
	PhysicalUsedBytes  int64  `json:"physical_used_bytes"`
	ReservedBytes      int64  `json:"reserved_bytes"`
	AvailableBytes     int64  `json:"available_bytes"`
	DiskTotalBytes     *int64 `json:"disk_total_bytes,omitempty"`
	DiskAvailableBytes *int64 `json:"disk_available_bytes,omitempty"`
	LogicalFileBytes   int64  `json:"logical_file_bytes"`
	TrashBytes         int64  `json:"trash_bytes"`
	HistoryBytes       int64  `json:"history_bytes"`
	OverQuota          bool   `json:"over_quota"`
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
	capacity, err := s.storageCapacity(c.Request.Context())
	if err != nil {
		fail(c, http.StatusInternalServerError, "load storage capacity failed")
		return
	}
	usage.AvailableBytes = effectiveAvailableBytes(
		usage.QuotaBytes,
		usage.PhysicalUsedBytes+usage.ReservedBytes,
		capacity.AvailableBytes,
	)
	if usage.QuotaBytes == 0 {
		total := capacity.TotalBytes
		available := capacity.AvailableBytes
		usage.DiskTotalBytes = &total
		usage.DiskAvailableBytes = &available
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, usage)
}

func (s *Server) loadQuotaUsage(db *gorm.DB, uid uint64, lockUser bool) (quotaUsageDTO, error) {
	started := time.Now()
	defer func() {
		if s.obs != nil {
			s.obs.observeInternalOperation("quota_single", time.Since(started))
		}
	}()
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
	usages, err := quotaUsagesForUsers(db, []meta.User{user})
	if err != nil {
		return quotaUsageDTO{}, err
	}
	return usages[user.ID], nil
}

type quotaUsageRow struct {
	OwnerID           uint64 `gorm:"column:owner_id"`
	LogicalFileBytes  int64  `gorm:"column:logical_file_bytes"`
	TrashBytes        int64  `gorm:"column:trash_bytes"`
	HistoryBytes      int64  `gorm:"column:history_bytes"`
	PhysicalUsedBytes int64  `gorm:"column:physical_used_bytes"`
	ReservedBytes     int64  `gorm:"column:reserved_bytes"`
}

func quotaUsagesForUsers(db *gorm.DB, users []meta.User) (map[uint64]quotaUsageDTO, error) {
	out := make(map[uint64]quotaUsageDTO, len(users))
	if len(users) == 0 {
		return out, nil
	}
	ids := make([]uint64, 0, len(users))
	for _, user := range users {
		ids = append(ids, user.ID)
		out[user.ID] = quotaUsageDTO{QuotaBytes: user.QuotaBytes}
	}

	var rows []quotaUsageRow
	err := db.Raw(`WITH current_usage AS (
  SELECT n.owner_id,
    COALESCE(SUM(f.size) FILTER (WHERE n.deleted_at IS NULL), 0) AS logical_file_bytes,
    COALESCE(SUM(f.size) FILTER (WHERE n.deleted_at IS NOT NULL), 0) AS trash_bytes
  FROM xd_files f
  JOIN xd_nodes n ON n.id = f.node_id
  WHERE n.owner_id IN ?
  GROUP BY n.owner_id
),
history_usage AS (
  SELECT n.owner_id, COALESCE(SUM(v.size), 0) AS history_bytes
  FROM xd_file_versions v
  JOIN xd_nodes n ON n.id = v.node_id
  WHERE n.owner_id IN ?
  GROUP BY n.owner_id
),
refs AS (
  SELECT n.owner_id, f.storage_key, f.size
  FROM xd_files f
  JOIN xd_nodes n ON n.id = f.node_id
  WHERE n.owner_id IN ?
  UNION ALL
  SELECT n.owner_id, v.storage_key, v.size
  FROM xd_file_versions v
  JOIN xd_nodes n ON n.id = v.node_id
  WHERE n.owner_id IN ?
),
physical_usage AS (
  SELECT owner_id, COALESCE(SUM(size), 0) AS physical_used_bytes
  FROM (
    SELECT owner_id, storage_key, MAX(size) AS size
    FROM refs
    GROUP BY owner_id, storage_key
  ) unique_refs
  GROUP BY owner_id
),
reserved_usage AS (
  SELECT owner_id, COALESCE(SUM(quota_reserved_bytes), 0) AS reserved_bytes
  FROM xd_upload_sessions
  WHERE owner_id IN ? AND status = ? AND expires_at > NOW() AND quota_reserved_bytes > 0
  GROUP BY owner_id
)
SELECT u.id AS owner_id,
  COALESCE(c.logical_file_bytes, 0) AS logical_file_bytes,
  COALESCE(c.trash_bytes, 0) AS trash_bytes,
  COALESCE(h.history_bytes, 0) AS history_bytes,
  COALESCE(p.physical_used_bytes, 0) AS physical_used_bytes,
  COALESCE(r.reserved_bytes, 0) AS reserved_bytes
FROM xd_users u
LEFT JOIN current_usage c ON c.owner_id = u.id
LEFT JOIN history_usage h ON h.owner_id = u.id
LEFT JOIN physical_usage p ON p.owner_id = u.id
LEFT JOIN reserved_usage r ON r.owner_id = u.id
WHERE u.id IN ?`,
		ids, ids, ids, ids, ids, meta.UploadStatusActive, ids,
	).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		usage := out[row.OwnerID]
		usage.LogicalFileBytes = row.LogicalFileBytes
		usage.TrashBytes = row.TrashBytes
		usage.HistoryBytes = row.HistoryBytes
		usage.PhysicalUsedBytes = row.PhysicalUsedBytes
		usage.ReservedBytes = row.ReservedBytes
		usage.OverQuota = usage.QuotaBytes > 0 && usage.PhysicalUsedBytes > usage.QuotaBytes
		out[row.OwnerID] = usage
	}
	return out, nil
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
	return s.ensureQuotaForStorageKeyExcludingSession(db, uid, additional, storageKey, "", lockUser)
}

func (s *Server) ensureQuotaForStorageKeyExcludingSession(
	db *gorm.DB,
	uid uint64,
	additional int64,
	storageKey string,
	excludeSessionID string,
	lockUser bool,
) (quotaUsageDTO, error) {
	if additional < 0 {
		additional = 0
	}
	usage, err := s.loadQuotaUsage(db, uid, lockUser)
	if err != nil {
		return quotaUsageDTO{}, err
	}
	reserved := usage.ReservedBytes
	if excludeSessionID != "" && reserved > 0 {
		var own int64
		if err := db.Model(&meta.UploadSession{}).
			Select("COALESCE(quota_reserved_bytes, 0)").
			Where("id = ? AND owner_id = ? AND status = ? AND expires_at > ?", excludeSessionID, uid, meta.UploadStatusActive, time.Now()).
			Scan(&own).Error; err != nil {
			return quotaUsageDTO{}, err
		}
		reserved -= own
		if reserved < 0 {
			reserved = 0
		}
	}
	if storageKey != "" && additional > 0 {
		owned, err := userOwnsStorageKey(db, uid, storageKey)
		if err != nil {
			return quotaUsageDTO{}, err
		}
		if owned {
			additional = 0
		}
	}
	if usage.QuotaBytes == 0 || additional == 0 {
		return usage, nil
	}
	remaining := usage.QuotaBytes - usage.PhysicalUsedBytes - reserved
	if remaining < 0 || additional > remaining {
		return usage, &quotaExceededError{Usage: usage, Additional: additional}
	}
	return usage, nil
}

func (s *Server) reserveUploadQuota(
	tx *gorm.DB,
	uid uint64,
	excludeSessionID string,
	requestedBytes int64,
	storageKey string,
) (int64, error) {
	if requestedBytes < 0 {
		requestedBytes = 0
	}
	usage, err := s.loadQuotaUsage(tx, uid, true)
	if err != nil {
		return 0, err
	}
	if usage.QuotaBytes == 0 || requestedBytes == 0 {
		return 0, nil
	}
	reserved := usage.ReservedBytes
	if excludeSessionID != "" && reserved > 0 {
		var own int64
		if err := tx.Model(&meta.UploadSession{}).
			Select("COALESCE(quota_reserved_bytes, 0)").
			Where("id = ? AND owner_id = ?", excludeSessionID, uid).
			Scan(&own).Error; err != nil {
			return 0, err
		}
		reserved -= own
		if reserved < 0 {
			reserved = 0
		}
	}
	if storageKey != "" {
		owned, err := userOwnsStorageKey(tx, uid, storageKey)
		if err != nil {
			return 0, err
		}
		if owned {
			requestedBytes = 0
		}
	}
	remaining := usage.QuotaBytes - usage.PhysicalUsedBytes - reserved
	if remaining < 0 || requestedBytes > remaining {
		return 0, &quotaExceededError{Usage: usage, Additional: requestedBytes}
	}
	return requestedBytes, nil
}

func (s *Server) rebuildUserQuotaReservations(tx *gorm.DB, uid uint64, quotaBytes int64) error {
	if quotaBytes <= 0 {
		return tx.Model(&meta.UploadSession{}).
			Where("owner_id = ? AND status = ?", uid, meta.UploadStatusActive).
			Update("quota_reserved_bytes", 0).Error
	}
	now := time.Now()
	var sessions []meta.UploadSession
	if err := tx.Where("owner_id = ? AND status = ? AND expires_at > ?", uid, meta.UploadStatusActive, now).
		Order("created_at ASC, id ASC").Find(&sessions).Error; err != nil {
		return err
	}
	for _, session := range sessions {
		reservation := session.TotalSize
		if session.SHA256 != "" {
			key, err := storage.ContentAddressedKey(session.SHA256)
			if err == nil {
				owned, err := userOwnsStorageKey(tx, uid, key)
				if err != nil {
					return err
				}
				if owned {
					reservation = 0
				}
			}
		}
		if err := tx.Model(&meta.UploadSession{}).Where("id = ?", session.ID).
			Update("quota_reserved_bytes", reservation).Error; err != nil {
			return err
		}
	}
	return tx.Model(&meta.UploadSession{}).
		Where("owner_id = ? AND (status <> ? OR expires_at <= ?)", uid, meta.UploadStatusActive, now).
		Update("quota_reserved_bytes", 0).Error
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
		"reserved_bytes":            quotaErr.Usage.ReservedBytes,
		"required_additional_bytes": quotaErr.Additional,
		"required_physical_bytes":   quotaErr.Usage.PhysicalUsedBytes + quotaErr.Additional,
		"required_accounted_bytes":  quotaErr.Usage.PhysicalUsedBytes + quotaErr.Usage.ReservedBytes + quotaErr.Additional,
	})
	return true
}
