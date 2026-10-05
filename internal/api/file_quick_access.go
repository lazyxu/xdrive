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

const fileQuickAccessLimit = 64

type fileQuickAccessItemDTO struct {
	Node     nodeDTO               `json:"node"`
	Path     string                `json:"path"`
	Crumbs   []searchBreadcrumbDTO `json:"crumbs"`
	PinnedAt time.Time             `json:"pinned_at"`
}

type fileQuickAccessRow struct {
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
	PinnedAt        time.Time
}

func (s *Server) fileQuickAccessItems(
	ctx context.Context,
	ownerID uint64,
	nodeID uint64,
) ([]fileQuickAccessItemDTO, error) {
	const query = `WITH RECURSIVE pinned AS (
  SELECT q.node_id, q.created_at AS pinned_at
  FROM xd_file_quick_access q
  JOIN xd_nodes n ON n.id = q.node_id
  WHERE q.owner_id = ?
    AND n.owner_id = ?
    AND n.type = 'dir'
    AND n.deleted_at IS NULL
    AND (? = 0 OR n.id = ?)
),
ancestors AS (
  SELECT
    n.id, n.parent_id, n.name,
    p.node_id AS pinned_id,
    0 AS depth
  FROM pinned p
  JOIN xd_nodes n ON n.id = p.node_id
  UNION ALL
  SELECT
    parent.id, parent.parent_id, parent.name,
    a.pinned_id,
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
    WHERE a.pinned_id = n.id AND a.parent_id IS NOT NULL
  ), '') AS path,
  (
    SELECT jsonb_agg(
      jsonb_build_object('id', a.id, 'name', a.name)
      ORDER BY a.depth DESC
    )::text
    FROM ancestors a
    WHERE a.pinned_id = n.id
  ) AS breadcrumbs_json,
  p.pinned_at
FROM pinned p
JOIN xd_nodes n ON n.id = p.node_id
LEFT JOIN xd_files f ON f.node_id = n.id
ORDER BY p.pinned_at ASC, n.id ASC`

	var rows []fileQuickAccessRow
	if err := s.DB.WithContext(ctx).Raw(
		query,
		ownerID,
		ownerID,
		nodeID,
		nodeID,
		ownerID,
	).Scan(&rows).Error; err != nil {
		return nil, err
	}

	items := make([]fileQuickAccessItemDTO, 0, len(rows))
	for _, row := range rows {
		var crumbs []searchBreadcrumbDTO
		if err := json.Unmarshal([]byte(row.BreadcrumbsJSON), &crumbs); err != nil {
			return nil, err
		}
		items = append(items, fileQuickAccessItemDTO{
			Node: nodeDTO{
				ID: row.ID, ParentID: row.ParentID, Name: row.Name, Type: row.Type,
				Size: row.Size, Revision: row.Revision, SHA256: row.SHA256,
				CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
			},
			Path:     row.Path,
			Crumbs:   crumbs,
			PinnedAt: row.PinnedAt,
		})
	}
	return items, nil
}

func (s *Server) listFileQuickAccess(c *gin.Context) {
	items, err := s.fileQuickAccessItems(c.Request.Context(), userID(c), 0)
	if err != nil {
		fail(c, http.StatusInternalServerError, "list quick access failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, items)
}

func (s *Server) pinFileQuickAccess(c *gin.Context) {
	nodeID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid node id")
		return
	}
	node, err := s.ownedNode(userID(c), nodeID, false)
	if err != nil {
		fail(c, http.StatusNotFound, "folder not found")
		return
	}
	if node.Type != meta.NodeTypeDir || node.ParentID == nil {
		fail(c, http.StatusBadRequest, "only non-root folders can be pinned")
		return
	}

	created := false
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var existing meta.FileQuickAccess
		err := tx.Where("owner_id = ? AND node_id = ?", userID(c), nodeID).First(&existing).Error
		if err == nil {
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var count int64
		if err := tx.Model(&meta.FileQuickAccess{}).
			Where("owner_id = ?", userID(c)).
			Count(&count).Error; err != nil {
			return err
		}
		if count >= fileQuickAccessLimit {
			return errFileQuickAccessLimit
		}
		if err := tx.Create(&meta.FileQuickAccess{
			OwnerID: userID(c),
			NodeID:  nodeID,
		}).Error; err != nil {
			return err
		}
		created = true
		return nil
	})
	if err != nil {
		if errors.Is(err, errFileQuickAccessLimit) {
			fail(c, http.StatusConflict, "quick access limit reached")
			return
		}
		fail(c, http.StatusInternalServerError, "pin quick access failed")
		return
	}

	items, err := s.fileQuickAccessItems(c.Request.Context(), userID(c), nodeID)
	if err != nil || len(items) != 1 {
		fail(c, http.StatusInternalServerError, "load quick access item failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	if created {
		c.JSON(http.StatusCreated, items[0])
		return
	}
	c.JSON(http.StatusOK, items[0])
}

func (s *Server) unpinFileQuickAccess(c *gin.Context) {
	nodeID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid node id")
		return
	}
	if err := s.DB.WithContext(c.Request.Context()).
		Where("owner_id = ? AND node_id = ?", userID(c), nodeID).
		Delete(&meta.FileQuickAccess{}).Error; err != nil {
		fail(c, http.StatusInternalServerError, "unpin quick access failed")
		return
	}
	c.Status(http.StatusNoContent)
}

var errFileQuickAccessLimit = errors.New("quick access limit reached")
