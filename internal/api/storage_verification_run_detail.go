package api

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const storageVerificationDetailProtocol = "xdrive-storage-verification-detail-v1"

// A single terminal verification receipt. Only the validated, bounded counters
// are returned: raw ReportJSON, Summary, Error, keys and paths never leave Server.
type storageVerificationRunDetail struct {
	Protocol string                         `json:"protocol"`
	Run      storageVerificationHistoryItem `json:"run"`
	Evidence *storageVerifyEvidence         `json:"evidence,omitempty"`
}

func (s *Server) adminStorageVerificationRunDetail(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	rawID := c.Param("runID")
	id, err := strconv.ParseUint(rawID, 10, 64)
	if err != nil || id == 0 || strconv.FormatUint(id, 10) != rawID ||
		len(c.Request.URL.Query()) != 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_storage_verification_run_id"})
		return
	}
	if s == nil || s.DB == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "storage_verification_detail_unavailable"})
		return
	}
	var run meta.SystemMaintenanceRun
	err = s.DB.WithContext(c.Request.Context()).
		Select("id", "kind", "status", "started_at", "finished_at", "report_json").
		Where("id = ? AND kind IN ? AND status IN ? AND finished_at IS NOT NULL",
			id,
			[]string{meta.SystemMaintenanceKindStorageVerify, meta.SystemMaintenanceKindStorageVerifyFast},
			[]string{
				meta.SystemMaintenanceStatusSuccess, meta.SystemMaintenanceStatusIssues,
				meta.SystemMaintenanceStatusFailed, meta.SystemMaintenanceStatusPartial,
				meta.SystemMaintenanceStatusCancelled,
			}).
		First(&run).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "storage_verification_run_not_found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "storage_verification_detail_read_failed"})
		return
	}
	mode := "deep"
	if run.Kind == meta.SystemMaintenanceKindStorageVerifyFast {
		mode = "fast"
	}
	detail := storageVerificationRunDetail{
		Protocol: storageVerificationDetailProtocol,
		Run: storageVerificationHistoryItem{
			RunID: strconv.FormatUint(run.ID, 10), Mode: mode, State: run.Status,
			StartedAt: run.StartedAt, FinishedAt: *run.FinishedAt,
		},
	}
	// An old task or malformed stored evidence is not a verified measurement.
	// No fallback to private task Summary/Error or fabricated zero counters.
	if evidence := parseStorageVerifyEvidence(run.ReportJSON); evidence != nil && evidence.Mode == mode {
		detail.Evidence = evidence
	}
	c.JSON(http.StatusOK, detail)
}
