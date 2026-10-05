package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	fileRecentDefaultLimit = 16
	fileRecentMaxLimit     = 50
	fileRecentRetention    = 128
)

type fileRecentItemDTO struct {
	Node       nodeDTO               `json:"node"`
	Path       string                `json:"path"`
	Crumbs     []searchBreadcrumbDTO `json:"crumbs"`
	AccessedAt time.Time             `json:"accessed_at"`
}

type fileRecentRow struct {
	ID              uint64
	ParentID        *uint64
	Name            string
	Type            string
	Revision        uint64
	CreatedAt       time.Time
	UpdatedAt       time.Time
	Size            int64
	SHA256          string
	Path            string
	BreadcrumbsJSON string
	AccessedAt      time.Time
}

func fileRecentLimit(c *gin.Context) (int, bool) {
	raw := strings.TrimSpace(c.Query("limit"))
	if raw == "" {
		return fileRecentDefaultLimit, true
	}
	limit, err := strconv.Atoi(raw)
	if err != nil || limit < 1 || limit > fileRecentMaxLimit {
		fail(c, http.StatusBadRequest, "limit must be between 1 and 50")
		return 0, false
	}
	return limit, true
}

func (s *Server) fileRecentItems(
	ctx context.Context,
	ownerID uint64,
	nodeID uint64,
	limit int,
) ([]fileRecentItemDTO, error) {
	const query = `WITH RECURSIVE recent AS (
  SELECT r.node_id, r.last_accessed_at
  FROM xd_file_recent_access r
  JOIN xd_nodes n ON n.id = r.node_id
  WHERE r.owner_id = ?
    AND n.owner_id = ?
    AND n.deleted_at IS NULL
    AND (? = 0 OR n.id = ?)
  ORDER BY r.last_accessed_at DESC, r.node_id DESC
  LIMIT ?
),
ancestors AS (
  SELECT
    n.id, n.parent_id, n.name,
    r.node_id AS recent_id,
    0 AS depth
  FROM recent r
  JOIN xd_nodes n ON n.id = r.node_id
  UNION ALL
  SELECT
    parent.id, parent.parent_id, parent.name,
    a.recent_id,
    a.depth + 1
  FROM ancestors a
  JOIN xd_nodes parent ON parent.id = a.parent_id
  WHERE parent.owner_id = ?
    AND parent.deleted_at IS NULL
)
SELECT
  n.id,
  n.parent_id,
  n.name,
  n.type,
  n.revision,
  n.created_at,
  n.updated_at,
  COALESCE(f.size, 0) AS size,
  COALESCE(f.sha256, '') AS sha256,
  COALESCE((
    SELECT string_agg(a.name, '/' ORDER BY a.depth DESC)
    FROM ancestors a
    WHERE a.recent_id = n.id AND a.parent_id IS NOT NULL
  ), '') AS path,
  (
    SELECT jsonb_agg(
      jsonb_build_object('id', a.id, 'name', a.name)
      ORDER BY a.depth DESC
    )::text
    FROM ancestors a
    WHERE a.recent_id = n.id
  ) AS breadcrumbs_json,
  r.last_accessed_at AS accessed_at
FROM recent r
JOIN xd_nodes n ON n.id = r.node_id
LEFT JOIN xd_files f ON f.node_id = n.id
ORDER BY r.last_accessed_at DESC, n.id DESC`

	var rows []fileRecentRow
	if err := s.DB.WithContext(ctx).Raw(
		query,
		ownerID,
		ownerID,
		nodeID,
		nodeID,
		limit,
		ownerID,
	).Scan(&rows).Error; err != nil {
		return nil, err
	}

	items := make([]fileRecentItemDTO, 0, len(rows))
	for _, row := range rows {
		var crumbs []searchBreadcrumbDTO
		if err := json.Unmarshal([]byte(row.BreadcrumbsJSON), &crumbs); err != nil {
			return nil, err
		}
		items = append(items, fileRecentItemDTO{
			Node: nodeDTO{
				ID: row.ID, ParentID: row.ParentID, Name: row.Name, Type: row.Type,
				Size: row.Size, Revision: row.Revision, SHA256: row.SHA256,
				CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
			},
			Path:       row.Path,
			Crumbs:     crumbs,
			AccessedAt: row.AccessedAt,
		})
	}
	return items, nil
}

func (s *Server) listFileRecent(c *gin.Context) {
	limit, ok := fileRecentLimit(c)
	if !ok {
		return
	}
	items, err := s.fileRecentItems(c.Request.Context(), userID(c), 0, limit)
	if err != nil {
		fail(c, http.StatusInternalServerError, "list recent files failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, items)
}

func (s *Server) touchFileRecent(c *gin.Context) {
	nodeID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid node id")
		return
	}
	node, err := s.ownedNode(userID(c), nodeID, false)
	if err != nil {
		fail(c, http.StatusNotFound, "node not found")
		return
	}
	if node.ParentID == nil {
		c.Status(http.StatusNoContent)
		return
	}

	now := time.Now()
	entry := meta.FileRecentAccess{
		OwnerID:      userID(c),
		NodeID:       nodeID,
		LastAccessed: now,
	}
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "owner_id"}, {Name: "node_id"}},
			DoUpdates: clause.Assignments(map[string]any{
				"last_accessed_at": now,
				"updated_at":       now,
			}),
		}).Create(&entry).Error; err != nil {
			return err
		}
		return tx.Exec(`
			DELETE FROM xd_file_recent_access
			WHERE owner_id = ?
			  AND node_id IN (
				SELECT node_id
				FROM xd_file_recent_access
				WHERE owner_id = ?
				ORDER BY last_accessed_at DESC, node_id DESC
				OFFSET ?
			  )
		`, userID(c), userID(c), fileRecentRetention).Error
	})
	if err != nil {
		fail(c, http.StatusInternalServerError, "record recent access failed")
		return
	}

	items, err := s.fileRecentItems(c.Request.Context(), userID(c), nodeID, 1)
	if err != nil || len(items) != 1 {
		fail(c, http.StatusInternalServerError, "load recent item failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, items[0])
}

func (s *Server) clearFileRecent(c *gin.Context) {
	if err := s.DB.WithContext(c.Request.Context()).
		Where("owner_id = ?", userID(c)).
		Delete(&meta.FileRecentAccess{}).Error; err != nil {
		fail(c, http.StatusInternalServerError, "clear recent files failed")
		return
	}
	c.Status(http.StatusNoContent)
}
