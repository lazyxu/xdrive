package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
)

const storageVerificationHistoryProtocol = "xdrive-storage-verification-history-v1"

type storageVerificationHistoryItem struct {
	RunID      string    `json:"run_id"`
	Mode       string    `json:"mode"`
	State      string    `json:"state"`
	StartedAt  time.Time `json:"started_at"`
	FinishedAt time.Time `json:"finished_at"`
}

type storageVerificationHistoryPage struct {
	Protocol   string                           `json:"protocol"`
	Items      []storageVerificationHistoryItem `json:"items"`
	NextCursor string                           `json:"next_cursor,omitempty"`
}

// This route is registered only below /api/v1/admin and requireAdmin().
// It selects *only* fixed metadata columns, never a raw task Summary/Error,
// ReportJSON, file name, object key, physical Host path or sensitive digest.
func (s *Server) adminStorageVerificationRuns(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s == nil || s.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "storage_verification_history_unavailable"})
		return
	}
	query := c.Request.URL.Query()
	for key, values := range query {
		if (key != "limit" && key != "cursor") || len(values) != 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_storage_verification_history_query"})
			return
		}
	}
	limit := 20
	if values, ok := query["limit"]; ok {
		n, err := strconv.Atoi(values[0])
		if err != nil || n < 1 || n > 50 || strconv.Itoa(n) != values[0] {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_storage_verification_history_limit"})
			return
		}
		limit = n
	}
	var beforeID uint64
	if values, ok := query["cursor"]; ok {
		n, err := strconv.ParseUint(values[0], 10, 64)
		if err != nil || n == 0 || strconv.FormatUint(n, 10) != values[0] {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_storage_verification_history_cursor"})
			return
		}
		beforeID = n
	}
	allowedKinds := []string{
		meta.SystemMaintenanceKindStorageVerify,
		meta.SystemMaintenanceKindStorageVerifyFast,
	}
	allowedStates := []string{
		meta.SystemMaintenanceStatusSuccess,
		meta.SystemMaintenanceStatusIssues,
		meta.SystemMaintenanceStatusFailed,
		meta.SystemMaintenanceStatusPartial,
		meta.SystemMaintenanceStatusCancelled,
	}
	q := s.DB.WithContext(c.Request.Context()).Model(&meta.SystemMaintenanceRun{}).
		Select("id", "kind", "status", "started_at", "finished_at").
		Where("kind IN ?", allowedKinds).
		Where("status IN ?", allowedStates).
		Where("finished_at IS NOT NULL")
	if beforeID != 0 {
		q = q.Where("id < ?", beforeID)
	}
	var records []meta.SystemMaintenanceRun
	if err := q.Order("id DESC").Limit(limit + 1).Find(&records).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "storage_verification_history_read_failed"})
		return
	}
	hasMore := len(records) > limit
	if hasMore {
		records = records[:limit]
	}
	page := storageVerificationHistoryPage{
		Protocol: storageVerificationHistoryProtocol,
		Items: make([]storageVerificationHistoryItem, 0, len(records)),
	}
	for _, item := range records {
		mode := "deep" // Existing storage_verify task is historically full SHA-256.
		if item.Kind == meta.SystemMaintenanceKindStorageVerifyFast {
			mode = "fast"
		}
		page.Items = append(page.Items, storageVerificationHistoryItem{
			RunID: strconv.FormatUint(item.ID, 10),
			Mode: mode,
			State: item.Status,
			StartedAt: item.StartedAt,
			FinishedAt: *item.FinishedAt,
		})
	}
	if hasMore {
		page.NextCursor = page.Items[len(page.Items)-1].RunID
	}
	c.JSON(http.StatusOK, page)
}
