package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

type sourceRunFailureDTO struct {
	ID           uint64    `json:"id"`
	SourceItemID uint64    `json:"source_item_id"`
	ExternalID   string    `json:"external_id"`
	Kind         string    `json:"kind"`
	Path         string    `json:"path"`
	Size         int64     `json:"size"`
	Error        string    `json:"error"`
	FailedAt     time.Time `json:"failed_at"`
}

func (s *Server) listSourceRunFailures(c *gin.Context) {
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
	if _, err := s.ownedSource(userID(c), sourceID); err != nil {
		fail(c, statusForLookup(err), "source not found")
		return
	}
	var run meta.SyncRun
	if err := s.DB.Where("id = ? AND source_id = ?", runID, sourceID).First(&run).Error; err != nil {
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
	var failures []meta.SourceRunFailure
	if err := s.DB.Where("run_id = ? AND source_id = ?", runID, sourceID).
		Order("failed_at ASC, id ASC").
		Limit(limit).Offset(offset).
		Find(&failures).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list source run failures failed")
		return
	}
	out := make([]sourceRunFailureDTO, 0, len(failures))
	for _, failure := range failures {
		out = append(out, sourceRunFailureDTO{
			ID: failure.ID, SourceItemID: failure.SourceItemID,
			ExternalID: failure.ExternalID, Kind: failure.Kind,
			Path: failure.Path, Size: failure.Size,
			Error: failure.Error, FailedAt: failure.FailedAt,
		})
	}
	c.JSON(http.StatusOK, out)
}

const (
	defaultSourceRunFailureRetention = 180 * 24 * time.Hour
	sourceRunFailureCleanupBatchSize = 1000
)

func (s *Server) cleanupSourceRunFailureHistory(ctx context.Context) error {
	retention := s.SourceRunFailureRetention
	if retention <= 0 {
		retention = defaultSourceRunFailureRetention
	}
	cutoff := time.Now().UTC().Add(-retention)
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		var ids []uint64
		if err := s.DB.WithContext(ctx).Model(&meta.SourceRunFailure{}).
			Where("failed_at < ?", cutoff).
			Order("id ASC").Limit(sourceRunFailureCleanupBatchSize).
			Pluck("id", &ids).Error; err != nil {
			return err
		}
		if len(ids) == 0 {
			return nil
		}
		if err := s.DB.WithContext(ctx).Where("id IN ?", ids).
			Delete(&meta.SourceRunFailure{}).Error; err != nil {
			return err
		}
		if len(ids) < sourceRunFailureCleanupBatchSize {
			return nil
		}
	}
}
