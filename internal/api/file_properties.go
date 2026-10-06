package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

type filePropertiesStatsRequest struct {
	Items []batchNodeRef `json:"items"`
}

type filePropertiesStatsResponse struct {
	SelectedCount      int64 `json:"selected_count"`
	EffectiveRootCount int64 `json:"effective_root_count"`
	TotalBytes         int64 `json:"total_bytes"`
	FileCount          int64 `json:"file_count"`
	FolderCount        int64 `json:"folder_count"`
}

func (s *Server) filePropertiesStats(c *gin.Context) {
	var req filePropertiesStatsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	if err := validateBatchNodeRefs(req.Items); err != nil {
		writeBatchMutationFailure(c, "properties", err)
		return
	}
	stats, err := s.computeFilePropertiesStats(
		c.Request.Context(),
		userID(c),
		req.Items,
	)
	if err != nil {
		if errors.Is(err, context.Canceled) ||
			errors.Is(err, context.DeadlineExceeded) ||
			c.Request.Context().Err() != nil {
			return
		}
		writeBatchMutationFailure(c, "properties", err)
		return
	}
	c.JSON(http.StatusOK, stats)
}

func (s *Server) computeFilePropertiesStats(
	ctx context.Context,
	uid uint64,
	items []batchNodeRef,
) (filePropertiesStatsResponse, error) {
	var out filePropertiesStatsResponse
	if err := ctx.Err(); err != nil {
		return out, err
	}
	if err := validateBatchNodeRefs(items); err != nil {
		return out, err
	}

	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := ctx.Err(); err != nil {
			return err
		}

		ids := make([]uint64, 0, len(items))
		for _, item := range items {
			ids = append(ids, item.ID)
		}
		var nodes []meta.Node
		if err := tx.
			Where(
				"owner_id = ? AND deleted_at IS NULL AND id IN ?",
				uid,
				ids,
			).
			Find(&nodes).Error; err != nil {
			return err
		}
		byID := make(map[uint64]meta.Node, len(nodes))
		for _, node := range nodes {
			byID[node.ID] = node
		}
		for index, ref := range items {
			node, ok := byID[ref.ID]
			if !ok {
				return &batchMutationFailure{
					Index:   index,
					ID:      ref.ID,
					Status:  http.StatusNotFound,
					Code:    "node_not_found",
					Message: "node not found",
				}
			}
			if node.ParentID == nil {
				return &batchMutationFailure{
					Index:   index,
					ID:      ref.ID,
					Status:  http.StatusBadRequest,
					Code:    "root_properties_unsupported",
					Message: "root properties are not available from a selection",
				}
			}
			if node.Revision != ref.Revision {
				return &batchMutationFailure{
					Index:           index,
					ID:              ref.ID,
					Status:          http.StatusConflict,
					Code:            "revision_conflict",
					Message:         "node revision changed",
					CurrentRevision: node.Revision,
				}
			}
		}

		topLevel, err := topLevelBatchDeleteRefs(tx, uid, items)
		if err != nil {
			return err
		}
		rootIDs := make([]uint64, 0, len(topLevel))
		var selectedRootFolders int64
		for _, ref := range topLevel {
			rootIDs = append(rootIDs, ref.ID)
			if node := byID[ref.ID]; node.Type == meta.NodeTypeDir {
				selectedRootFolders++
			}
		}

		var row struct {
			TotalBytes     int64 `gorm:"column:total_bytes"`
			FileCount      int64 `gorm:"column:file_count"`
			AllFolderCount int64 `gorm:"column:all_folder_count"`
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := tx.Raw(`
WITH RECURSIVE tree AS (
	SELECT id, type
	FROM xd_nodes
	WHERE owner_id = ?
	  AND deleted_at IS NULL
	  AND id IN ?
	UNION ALL
	SELECT n.id, n.type
	FROM xd_nodes n
	JOIN tree t ON n.parent_id = t.id
	WHERE n.owner_id = ?
	  AND n.deleted_at IS NULL
)
SELECT
	COALESCE(SUM(CASE WHEN tree.type = 'file' THEN COALESCE(f.size, 0) ELSE 0 END), 0) AS total_bytes,
	COUNT(*) FILTER (WHERE tree.type = 'file') AS file_count,
	COUNT(*) FILTER (WHERE tree.type = 'dir') AS all_folder_count
FROM tree
LEFT JOIN xd_files f ON f.node_id = tree.id
`, uid, rootIDs, uid).Scan(&row).Error; err != nil {
			return err
		}

		folderCount := row.AllFolderCount - selectedRootFolders
		if folderCount < 0 {
			folderCount = 0
		}
		out = filePropertiesStatsResponse{
			SelectedCount:      int64(len(items)),
			EffectiveRootCount: int64(len(topLevel)),
			TotalBytes:         row.TotalBytes,
			FileCount:          row.FileCount,
			FolderCount:        folderCount,
		}
		return nil
	})
	return out, err
}
