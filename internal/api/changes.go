package api

import (
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
)

const (
	nodeChangeDefaultLimit = 200
	nodeChangeMaxLimit     = 1000
)

type nodeChangeDTO struct {
	Cursor            uint64   `json:"cursor"`
	NodeID            uint64   `json:"node_id"`
	Operation         string   `json:"operation"`
	AffectedParentIDs []uint64 `json:"affected_parent_ids,omitempty"`
	Path              string   `json:"path,omitempty"`
	Node              *nodeDTO `json:"node,omitempty"`
}

type nodeChangePageDTO struct {
	Changes       []nodeChangeDTO `json:"changes"`
	NextCursor    uint64          `json:"next_cursor"`
	LatestCursor  uint64          `json:"latest_cursor"`
	HasMore       bool            `json:"has_more"`
	ResetRequired bool            `json:"reset_required,omitempty"`
}

func (s *Server) listNodeChanges(c *gin.Context) {
	after, ok := parseOptionalCursor(c, "after")
	if !ok {
		return
	}
	limit, ok := parseChangeLimit(c)
	if !ok {
		return
	}
	includeDeletedPaths := strings.EqualFold(strings.TrimSpace(c.Query("include_deleted_paths")), "true") ||
		strings.TrimSpace(c.Query("include_deleted_paths")) == "1"
	uid := userID(c)

	var latest uint64
	if err := s.DB.Model(&meta.NodeChange{}).
		Where("owner_id = ?", uid).
		Select("COALESCE(MAX(id), 0)").
		Scan(&latest).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list changes failed")
		return
	}
	if after > latest {
		c.JSON(http.StatusOK, nodeChangePageDTO{
			Changes:       []nodeChangeDTO{},
			NextCursor:    latest,
			LatestCursor:  latest,
			ResetRequired: true,
		})
		return
	}

	var rows []meta.NodeChange
	if err := s.DB.Where("owner_id = ? AND id > ?", uid, after).
		Order("id ASC").
		Limit(limit).
		Find(&rows).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list changes failed")
		return
	}
	if len(rows) == 0 {
		c.JSON(http.StatusOK, nodeChangePageDTO{
			Changes:      []nodeChangeDTO{},
			NextCursor:   after,
			LatestCursor: latest,
			HasMore:      after < latest,
		})
		return
	}

	nextCursor := rows[len(rows)-1].ID
	type dirtyNode struct {
		NodeID            uint64
		Cursor            uint64
		AffectedParentIDs map[uint64]struct{}
	}
	latestByNode := make(map[uint64]*dirtyNode, len(rows))
	for _, row := range rows {
		item := latestByNode[row.NodeID]
		if item == nil {
			item = &dirtyNode{
				NodeID:            row.NodeID,
				AffectedParentIDs: make(map[uint64]struct{}, 2),
			}
			latestByNode[row.NodeID] = item
		}
		item.Cursor = row.ID
		if row.ParentID != nil && *row.ParentID != 0 {
			item.AffectedParentIDs[*row.ParentID] = struct{}{}
		}
		if row.PreviousParentID != nil && *row.PreviousParentID != 0 {
			item.AffectedParentIDs[*row.PreviousParentID] = struct{}{}
		}
	}
	dirty := make([]dirtyNode, 0, len(latestByNode))
	nodeIDs := make([]uint64, 0, len(latestByNode))
	for nodeID, item := range latestByNode {
		dirty = append(dirty, *item)
		nodeIDs = append(nodeIDs, nodeID)
	}
	sort.Slice(dirty, func(i, j int) bool { return dirty[i].Cursor < dirty[j].Cursor })

	var active []meta.Node
	if err := s.DB.Preload("File").
		Where("owner_id = ? AND id IN ? AND deleted_at IS NULL", uid, nodeIDs).
		Find(&active).Error; err != nil {
		fail(c, http.StatusInternalServerError, "load changed nodes failed")
		return
	}
	nodes := make(map[uint64]meta.Node, len(active))
	for _, node := range active {
		nodes[node.ID] = node
	}

	paths, err := s.activeNodePaths(uid, nodeIDs)
	if err != nil {
		fail(c, http.StatusInternalServerError, "resolve changed node paths failed")
		return
	}
	deletedPaths := map[uint64]string{}
	if includeDeletedPaths {
		deletedNodeIDs := make([]uint64, 0, len(dirty))
		for _, item := range dirty {
			if _, exists := nodes[item.NodeID]; !exists {
				deletedNodeIDs = append(deletedNodeIDs, item.NodeID)
			}
		}
		deletedPaths, err = s.nodePathsIncludingDeleted(uid, deletedNodeIDs)
		if err != nil {
			fail(c, http.StatusInternalServerError, "resolve deleted node paths failed")
			return
		}
	}

	changes := make([]nodeChangeDTO, 0, len(dirty))
	for _, item := range dirty {
		affectedParentIDs := make([]uint64, 0, len(item.AffectedParentIDs))
		for parentID := range item.AffectedParentIDs {
			affectedParentIDs = append(affectedParentIDs, parentID)
		}
		sort.Slice(affectedParentIDs, func(i, j int) bool { return affectedParentIDs[i] < affectedParentIDs[j] })
		node, exists := nodes[item.NodeID]
		if !exists {
			changes = append(changes, nodeChangeDTO{
				Cursor: item.Cursor, NodeID: item.NodeID, Operation: "delete",
				AffectedParentIDs: affectedParentIDs, Path: deletedPaths[item.NodeID],
			})
			continue
		}
		path, exists := paths[item.NodeID]
		if !exists {
			fail(c, http.StatusInternalServerError, "resolve changed node path failed")
			return
		}
		dto := toNodeDTO(node)
		changes = append(changes, nodeChangeDTO{
			Cursor: item.Cursor, NodeID: item.NodeID, Operation: "upsert",
			AffectedParentIDs: affectedParentIDs, Path: path, Node: &dto,
		})
	}

	c.JSON(http.StatusOK, nodeChangePageDTO{
		Changes:      changes,
		NextCursor:   nextCursor,
		LatestCursor: latest,
		HasMore:      nextCursor < latest,
	})
}

func (s *Server) activeNodePaths(ownerID uint64, nodeIDs []uint64) (map[uint64]string, error) {
	paths := make(map[uint64]string, len(nodeIDs))
	if len(nodeIDs) == 0 {
		return paths, nil
	}
	type row struct {
		TargetID uint64
		Path     string
	}
	var rows []row
	err := s.DB.Raw(`
WITH RECURSIVE ancestry AS (
	SELECT
		n.id AS target_id,
		n.id AS current_id,
		n.parent_id,
		CASE WHEN n.parent_id IS NULL THEN '' ELSE n.name END::text AS path
	FROM xd_nodes AS n
	WHERE n.owner_id = ? AND n.id IN ? AND n.deleted_at IS NULL

	UNION ALL

	SELECT
		a.target_id,
		p.id AS current_id,
		p.parent_id,
		CASE
			WHEN p.parent_id IS NULL THEN a.path
			WHEN a.path = '' THEN p.name
			ELSE p.name || '/' || a.path
		END AS path
	FROM ancestry AS a
	JOIN xd_nodes AS p ON p.id = a.parent_id
	WHERE p.owner_id = ? AND p.deleted_at IS NULL
)
SELECT target_id, path
FROM ancestry
WHERE parent_id IS NULL
`, ownerID, nodeIDs, ownerID).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, item := range rows {
		paths[item.TargetID] = item.Path
	}
	return paths, nil
}

func (s *Server) nodePathsIncludingDeleted(ownerID uint64, nodeIDs []uint64) (map[uint64]string, error) {
	paths := make(map[uint64]string, len(nodeIDs))
	if len(nodeIDs) == 0 {
		return paths, nil
	}
	type row struct {
		TargetID uint64
		Path     string
	}
	var rows []row
	err := s.DB.Raw(`
WITH RECURSIVE ancestry AS (
	SELECT
		n.id AS target_id,
		n.id AS current_id,
		n.parent_id,
		CASE WHEN n.parent_id IS NULL THEN '' ELSE n.name END::text AS path
	FROM xd_nodes AS n
	WHERE n.owner_id = ? AND n.id IN ?

	UNION ALL

	SELECT
		a.target_id,
		p.id AS current_id,
		p.parent_id,
		CASE
			WHEN p.parent_id IS NULL THEN a.path
			WHEN a.path = '' THEN p.name
			ELSE p.name || '/' || a.path
		END AS path
	FROM ancestry AS a
	JOIN xd_nodes AS p ON p.id = a.parent_id
	WHERE p.owner_id = ?
)
SELECT target_id, path
FROM ancestry
WHERE parent_id IS NULL
`, ownerID, nodeIDs, ownerID).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, item := range rows {
		paths[item.TargetID] = item.Path
	}
	return paths, nil
}

func parseOptionalCursor(c *gin.Context, name string) (uint64, bool) {
	raw := strings.TrimSpace(c.Query(name))
	if raw == "" {
		return 0, true
	}
	value, err := strconv.ParseUint(raw, 10, 64)
	if err != nil {
		fail(c, http.StatusBadRequest, name+" must be an unsigned integer")
		return 0, false
	}
	return value, true
}

func parseChangeLimit(c *gin.Context) (int, bool) {
	raw := strings.TrimSpace(c.Query("limit"))
	if raw == "" {
		return nodeChangeDefaultLimit, true
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 1 || value > nodeChangeMaxLimit {
		fail(c, http.StatusBadRequest, "limit must be between 1 and 1000")
		return 0, false
	}
	return value, true
}
