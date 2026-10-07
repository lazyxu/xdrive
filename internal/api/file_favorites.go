package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const fileFavoriteLimit = 256

type fileFavoriteItemDTO struct {
	Node        nodeDTO               `json:"node"`
	Path        string                `json:"path"`
	Crumbs      []searchBreadcrumbDTO `json:"crumbs"`
	FavoritedAt time.Time             `json:"favorited_at"`
}

type fileFavoriteRow struct {
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
	FavoritedAt     time.Time
}

func (s *Server) fileFavoriteItems(ctx context.Context, ownerID uint64, nodeID uint64) ([]fileFavoriteItemDTO, error) {
	const query = `WITH RECURSIVE favorites AS (
  SELECT q.node_id, q.created_at AS favorited_at
  FROM xd_file_favorites q
  JOIN xd_nodes n ON n.id = q.node_id
  WHERE q.owner_id = ?
    AND n.owner_id = ?
    AND n.type = 'file'
    AND n.deleted_at IS NULL
    AND (? = 0 OR n.id = ?)
),
ancestors AS (
  SELECT n.id, n.parent_id, n.name, f.node_id AS favorite_id, 0 AS depth
  FROM favorites f
  JOIN xd_nodes n ON n.id = f.node_id
  UNION ALL
  SELECT parent.id, parent.parent_id, parent.name, a.favorite_id, a.depth + 1
  FROM ancestors a
  JOIN xd_nodes parent ON parent.id = a.parent_id
  WHERE parent.owner_id = ? AND parent.deleted_at IS NULL
)
SELECT
  n.id, n.parent_id, n.name, n.type, n.revision, n.created_at, n.updated_at,
  COALESCE(file.size, 0) AS size,
  COALESCE(file.sha256, '') AS sha256,
  COALESCE((
    SELECT string_agg(a.name, '/' ORDER BY a.depth DESC)
    FROM ancestors a
    WHERE a.favorite_id = n.id AND a.parent_id IS NOT NULL
  ), '') AS path,
  (
    SELECT jsonb_agg(
      jsonb_build_object('id', a.id, 'name', a.name)
      ORDER BY a.depth DESC
    )::text
    FROM ancestors a
    WHERE a.favorite_id = n.id
  ) AS breadcrumbs_json,
  f.favorited_at
FROM favorites f
JOIN xd_nodes n ON n.id = f.node_id
LEFT JOIN xd_files file ON file.node_id = n.id
ORDER BY f.favorited_at ASC, n.id ASC`

	var rows []fileFavoriteRow
	if err := s.DB.WithContext(ctx).Raw(query, ownerID, ownerID, nodeID, nodeID, ownerID).Scan(&rows).Error; err != nil {
		return nil, err
	}

	items := make([]fileFavoriteItemDTO, 0, len(rows))
	for _, row := range rows {
		var crumbs []searchBreadcrumbDTO
		if err := json.Unmarshal([]byte(row.BreadcrumbsJSON), &crumbs); err != nil {
			return nil, err
		}
		items = append(items, fileFavoriteItemDTO{
			Node: nodeDTO{
				ID: row.ID, ParentID: row.ParentID, Name: row.Name, Type: row.Type,
				Size: row.Size, Revision: row.Revision, SHA256: row.SHA256,
				CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
			},
			Path: row.Path, Crumbs: crumbs, FavoritedAt: row.FavoritedAt,
		})
	}
	return items, nil
}

func (s *Server) listFileFavorites(c *gin.Context) {
	items, err := s.fileFavoriteItems(c.Request.Context(), userID(c), 0)
	if err != nil {
		fail(c, http.StatusInternalServerError, "list file favorites failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, items)
}

func (s *Server) favoriteFile(c *gin.Context) {
	nodeID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid node id")
		return
	}
	node, err := s.ownedNode(userID(c), nodeID, false)
	if err != nil {
		fail(c, http.StatusNotFound, "file not found")
		return
	}
	if node.Type != meta.NodeTypeFile {
		fail(c, http.StatusBadRequest, "only files can be favorited")
		return
	}

	created := false
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var existing meta.FileFavorite
		err := tx.Where("owner_id = ? AND node_id = ?", userID(c), nodeID).First(&existing).Error
		if err == nil {
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var count int64
		if err := tx.Model(&meta.FileFavorite{}).Where("owner_id = ?", userID(c)).Count(&count).Error; err != nil {
			return err
		}
		if count >= fileFavoriteLimit {
			return errFileFavoriteLimit
		}
		if err := tx.Create(&meta.FileFavorite{OwnerID: userID(c), NodeID: nodeID}).Error; err != nil {
			return err
		}
		created = true
		return nil
	})
	if err != nil {
		if errors.Is(err, errFileFavoriteLimit) {
			fail(c, http.StatusConflict, "file favorite limit reached")
			return
		}
		fail(c, http.StatusInternalServerError, "favorite file failed")
		return
	}

	items, err := s.fileFavoriteItems(c.Request.Context(), userID(c), nodeID)
	if err != nil || len(items) != 1 {
		fail(c, http.StatusInternalServerError, "load file favorite failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	if created {
		c.JSON(http.StatusCreated, items[0])
		return
	}
	c.JSON(http.StatusOK, items[0])
}

func (s *Server) unfavoriteFile(c *gin.Context) {
	nodeID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid node id")
		return
	}
	if err := s.DB.WithContext(c.Request.Context()).
		Where("owner_id = ? AND node_id = ?", userID(c), nodeID).
		Delete(&meta.FileFavorite{}).Error; err != nil {
		fail(c, http.StatusInternalServerError, "unfavorite file failed")
		return
	}
	c.Status(http.StatusNoContent)
}

var errFileFavoriteLimit = errors.New("file favorite limit reached")
