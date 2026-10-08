package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
)

type fileMediaDetailsRequest struct {
	Items []batchNodeRef `json:"items"`
}

type fileMediaDetailsItem struct {
	ID         uint64 `json:"id"`
	Revision   uint64 `json:"revision"`
	Width      int    `json:"width,omitempty"`
	Height     int    `json:"height,omitempty"`
	DurationMS int64  `json:"duration_ms,omitempty"`
}

type fileMediaDetailsResponse struct {
	Items []fileMediaDetailsItem `json:"items"`
}

type fileMediaDetailsRow struct {
	ID         uint64 `gorm:"column:id"`
	Revision   uint64 `gorm:"column:revision"`
	NodeType   string `gorm:"column:node_type"`
	Width      int    `gorm:"column:width"`
	Height     int    `gorm:"column:height"`
	DurationMS int64  `gorm:"column:duration_ms"`
}

func (s *Server) fileMediaDetails(c *gin.Context) {
	var req fileMediaDetailsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	details, err := s.computeFileMediaDetails(c.Request.Context(), userID(c), req.Items)
	if err != nil {
		if errors.Is(err, context.Canceled) ||
			errors.Is(err, context.DeadlineExceeded) ||
			c.Request.Context().Err() != nil {
			return
		}
		writeBatchMutationFailure(c, "media-details", err)
		return
	}
	c.JSON(http.StatusOK, fileMediaDetailsResponse{Items: details})
}

func (s *Server) computeFileMediaDetails(
	ctx context.Context,
	uid uint64,
	items []batchNodeRef,
) ([]fileMediaDetailsItem, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := validateBatchNodeRefs(items); err != nil {
		return nil, err
	}

	ids := make([]uint64, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}

	var rows []fileMediaDetailsRow
	if err := s.DB.WithContext(ctx).
		Table("xd_nodes AS n").
		Select(
			`n.id,
			 n.revision,
			 n.type AS node_type,
			 CASE
			   WHEN m.node_revision = n.revision AND m.index_state = ? THEN m.width
			   ELSE 0
			 END AS width,
			 CASE
			   WHEN m.node_revision = n.revision AND m.index_state = ? THEN m.height
			   ELSE 0
			 END AS height,
			 CASE
			   WHEN m.node_revision = n.revision AND m.index_state = ? THEN m.duration_ms
			   ELSE 0
			 END AS duration_ms`,
			meta.MediaIndexStateReady,
			meta.MediaIndexStateReady,
			meta.MediaIndexStateReady,
		).
		Joins("LEFT JOIN xd_media_metadata AS m ON m.node_id = n.id AND m.owner_id = n.owner_id").
		Where("n.owner_id = ? AND n.deleted_at IS NULL AND n.id IN ?", uid, ids).
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	byID := make(map[uint64]fileMediaDetailsRow, len(rows))
	for _, row := range rows {
		byID[row.ID] = row
	}

	out := make([]fileMediaDetailsItem, 0, len(items))
	for index, ref := range items {
		row, ok := byID[ref.ID]
		if !ok {
			return nil, &batchMutationFailure{
				Index:   index,
				ID:      ref.ID,
				Status:  http.StatusNotFound,
				Code:    "node_not_found",
				Message: "node not found",
			}
		}
		if row.NodeType != meta.NodeTypeFile {
			return nil, &batchMutationFailure{
				Index:   index,
				ID:      ref.ID,
				Status:  http.StatusBadRequest,
				Code:    "media_details_file_required",
				Message: "media details require file nodes",
			}
		}
		if row.Revision != ref.Revision {
			return nil, &batchMutationFailure{
				Index:           index,
				ID:              ref.ID,
				Status:          http.StatusConflict,
				Code:            "revision_conflict",
				Message:         "node revision changed",
				CurrentRevision: row.Revision,
			}
		}
		out = append(out, fileMediaDetailsItem{
			ID:         ref.ID,
			Revision:   ref.Revision,
			Width:      row.Width,
			Height:     row.Height,
			DurationMS: row.DurationMS,
		})
	}
	return out, nil
}
