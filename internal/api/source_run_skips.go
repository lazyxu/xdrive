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

type sourceRunSkipDTO struct {
	ID         uint64    `json:"id"`
	ExternalID string    `json:"external_id"`
	Kind       string    `json:"kind"`
	Path       string    `json:"path"`
	Size       int64     `json:"size"`
	Reason     string    `json:"reason"`
	SkippedAt  time.Time `json:"skipped_at"`
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
	var skips []meta.SourceRunSkip
	if err := s.DB.Where("run_id = ? AND source_id = ?", runID, sourceID).
		Order("skipped_at ASC, id ASC").Limit(limit).Offset(offset).Find(&skips).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list source run skips failed")
		return
	}
	out := make([]sourceRunSkipDTO, 0, len(skips))
	for _, row := range skips {
		out = append(out, sourceRunSkipDTO{ID: row.ID, ExternalID: row.ExternalID,
			Kind: row.Kind, Path: row.Path, Size: row.Size, Reason: row.Reason, SkippedAt: row.SkippedAt})
	}
	c.JSON(http.StatusOK, out)
}

// Mirror the existing failure retention window: the run's aggregate metrics
// remain, but per-item snapshots have bounded PostgreSQL storage cost.
func (s *Server) cleanupSourceRunSkipHistory(ctx context.Context) error {
	retention := s.SourceRunFailureRetention
	if retention <= 0 {
		retention = defaultSourceRunFailureRetention
	}
	cutoff := time.Now().UTC().Add(-retention)
	for {
		var ids []uint64
		if err := s.DB.WithContext(ctx).Model(&meta.SourceRunSkip{}).
			Where("skipped_at < ?", cutoff).Order("id ASC").Limit(sourceRunFailureCleanupBatchSize).
			Pluck("id", &ids).Error; err != nil {
			return err
		}
		if len(ids) == 0 {
			return nil
		}
		if err := s.DB.WithContext(ctx).Where("id IN ?", ids).Delete(&meta.SourceRunSkip{}).Error; err != nil {
			return err
		}
		if len(ids) < sourceRunFailureCleanupBatchSize {
			return nil
		}
	}
}
