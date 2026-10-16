package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

type sourceRunSkipDTO struct {
	ID         uint64    `json:"id"`
	ExternalID string    `json:"external_id"`
	Kind       string    `json:"kind"`
	Path       string    `json:"path"`
	Size       int64     `json:"size"`
	Reason     string    `json:"reason"`
	ObservedAt time.Time `json:"observed_at"`
}

func (s *Server) listSourceRunSkips(c *gin.Context) {
	sourceID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid source id")
		return
	}
	runID, ok := canonicalRunID(c.Param("runID"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid run id")
		return
	}
	source, err := s.ownedSource(userID(c), sourceID)
	if err != nil {
		fail(c, statusForLookup(err), "source not found")
		return
	}
	if denyLocalSourceDetailRead(c, source) {
		return
	}
	var run meta.SyncRun
	if err := s.DB.Select("id").Where("id = ? AND source_id = ?", runID, sourceID).First(&run).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "source run not found")
		} else {
			fail(c, http.StatusInternalServerError, "read source run failed")
		}
		return
	}
	limit, offset, ok := sourceListWindow(c)
	if !ok {
		return
	}
	reason := strings.TrimSpace(c.Query("reason"))
	if reason != "" && reason != "ignore" && reason != "unchanged" {
		fail(c, http.StatusBadRequest, "invalid skip reason")
		return
	}
	query := s.DB.Where("run_id = ? AND source_id = ?", runID, sourceID)
	if reason != "" {
		query = query.Where("reason = ?", reason)
	}
	var skipped []meta.SourceRunSkip
	if err := query.Order("id ASC").Limit(limit).Offset(offset).Find(&skipped).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list source run skips failed")
		return
	}
	out := make([]sourceRunSkipDTO, 0, len(skipped))
	for _, item := range skipped {
		out = append(out, sourceRunSkipDTO{
			ID: item.ID, ExternalID: item.ExternalID, Kind: item.Kind, Path: item.Path,
			Size: item.Size, Reason: item.Reason, ObservedAt: item.ObservedAt,
		})
	}
	c.JSON(http.StatusOK, out)
}

type sourceFailureCategoryCount struct {
	Category string
	Total    int64
}

func sourceRunFailureCategoryCountsTx(tx *gorm.DB, runID string) (string, error) {
	var rows []sourceFailureCategoryCount
	if err := tx.Model(&meta.SourceRunFailure{}).
		Select("category, count(*) AS total").Where("run_id = ?", runID).
		Group("category").Scan(&rows).Error; err != nil {
		return "", err
	}
	counts := map[string]int64{}
	for _, row := range rows {
		counts[row.Category] += row.Total
	}
	raw, err := json.Marshal(counts)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

const (
	defaultSourceRunSkipRetention = 30 * 24 * time.Hour
	sourceRunSkipCleanupBatchSize = 1000
)

// Keep run counters permanently; bulk skip snapshots expire after 30 days.
func (s *Server) cleanupSourceRunSkipHistory(ctx context.Context) error {
	cutoff := time.Now().UTC().Add(-defaultSourceRunSkipRetention)
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		var ids []uint64
		if err := s.DB.WithContext(ctx).Model(&meta.SourceRunSkip{}).
			Where("observed_at < ?", cutoff).
			Order("id ASC").Limit(sourceRunSkipCleanupBatchSize).
			Pluck("id", &ids).Error; err != nil {
			return err
		}
		if len(ids) == 0 {
			return nil
		}
		if err := s.DB.WithContext(ctx).Where("id IN ?", ids).
			Delete(&meta.SourceRunSkip{}).Error; err != nil {
			return err
		}
		if len(ids) < sourceRunSkipCleanupBatchSize {
			return nil
		}
	}
}

func validSourceFailureCategory(category string) bool {
	switch category {
	case "rate_limit", "permission", "source_changed", "conflict", "network", "other":
		return true
	default:
		return false
	}
}
