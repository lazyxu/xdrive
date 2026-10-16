package api

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
)

// Shared by the canonical paged Range and the U09-D Server position query.
// Its inputs are exclusively validated sort/group choices, never raw SQL.
func childrenSortExpression(sort string) string {
	switch sort {
	case "updated":
		return "xd_nodes.updated_at"
	case "size":
		return "COALESCE(child_file.size, 0)"
	case "type":
		return "(CASE WHEN xd_nodes.type = 'dir' THEN '' WHEN strpos(xd_nodes.name, '.') > 1 AND right(xd_nodes.name, 1) <> '.' THEN lower(regexp_replace(xd_nodes.name, '^.*\\.', '')) ELSE '' END)"
	default:
		return "lower(xd_nodes.name)"
	}
}

func childrenRangeOrderBy(sortExpr, direction string, fields fileExplorerGroupFields, grouping fileExplorerGrouping) string {
	return fmt.Sprintf("%s%s %s, lower(xd_nodes.name) %s, xd_nodes.id %s",
		fileExplorerItemOrderPrefix(fields, grouping), sortExpr, direction, direction, direction)
}

type childrenPositionDTO struct {
	NodeID       uint64 `json:"node_id"`
	Revision     uint64 `json:"revision"`
	Index        int64  `json:"index"`
	Sort         string `json:"sort"`
	Order        string `json:"order"`
	Group        string `json:"group"`
	FoldersFirst bool   `json:"folders_first"`
}

// childrenPosition projects one original Node's ordinal into the identical
// Owner-scoped current directory Range. It never transfers 100k child rows.
func (s *Server) childrenPosition(c *gin.Context) {
	parentID, valid := parseID(c.Param("id"))
	if !valid || parentID > uint64(1<<63-1) {
		fail(c, http.StatusBadRequest, "invalid parent directory")
		return
	}
	for key, values := range c.Request.URL.Query() {
		switch key {
		case "node_id", "sort", "order", "group", "folders_first":
		default:
			fail(c, http.StatusBadRequest, "unsupported position query parameter")
			return
		}
		if len(values) != 1 {
			fail(c, http.StatusBadRequest, "duplicate position query parameter")
			return
		}
	}
	nodeID, err := strconv.ParseUint(strings.TrimSpace(c.Query("node_id")), 10, 64)
	if err != nil || nodeID == 0 || nodeID > uint64(1<<63-1) {
		fail(c, http.StatusBadRequest, "invalid node_id")
		return
	}
	sortKey := strings.ToLower(strings.TrimSpace(c.Query("sort")))
	if sortKey == "" {
		sortKey = "name"
	}
	if sortKey == "updated_at" {
		sortKey = "updated"
	}
	switch sortKey {
	case "name", "updated", "size", "type":
	default:
		fail(c, http.StatusBadRequest, "sort must be name, updated, size, or type")
		return
	}
	order := strings.ToLower(strings.TrimSpace(c.Query("order")))
	if order == "" {
		order = "asc"
	}
	if order != "asc" && order != "desc" {
		fail(c, http.StatusBadRequest, "order must be asc or desc")
		return
	}
	grouping, valid := parseFileExplorerGrouping(c, true)
	if !valid {
		return
	}
	direction := "ASC"
	if order == "desc" {
		direction = "DESC"
	}
	fields := fileExplorerGroupFields{
		Type: "xd_nodes.type", Name: "xd_nodes.name",
		Updated: "xd_nodes.updated_at", Size: "COALESCE(child_file.size, 0)",
	}
	orderBy := childrenRangeOrderBy(childrenSortExpression(sortKey), direction, fields, grouping)
	// Use one PostgreSQL statement for an internally consistent authorization
	// and ordering snapshot. The response is one row, not an unbounded Range.
	query := fmt.Sprintf(`
SELECT positioned.logical_index, positioned.revision
FROM (
 SELECT xd_nodes.id, xd_nodes.revision,
   ROW_NUMBER() OVER (ORDER BY %s) - 1 AS logical_index
 FROM xd_nodes
 LEFT JOIN xd_files AS child_file ON child_file.node_id = xd_nodes.id
 JOIN xd_nodes AS parent_node ON parent_node.id = ?
   AND parent_node.owner_id = ? AND parent_node.type = ?
   AND parent_node.deleted_at IS NULL
 WHERE xd_nodes.owner_id = ? AND xd_nodes.parent_id = ?
   AND xd_nodes.deleted_at IS NULL
) AS positioned
WHERE positioned.id = ?
LIMIT 1`, orderBy)
	var row struct {
		Index    int64  `gorm:"column:logical_index"`
		Revision uint64 `gorm:"column:revision"`
	}
	uid := userID(c)
	result := s.DB.WithContext(c.Request.Context()).Raw(
		query, parentID, uid, meta.NodeTypeDir, uid, parentID, nodeID,
	).Scan(&row)
	if result.Error != nil {
		fail(c, http.StatusInternalServerError, "locate directory item failed")
		return
	}
	if result.RowsAffected != 1 {
		fail(c, http.StatusNotFound, "node not found in directory")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, childrenPositionDTO{
		NodeID: nodeID, Revision: row.Revision, Index: row.Index,
		Sort: sortKey, Order: order, Group: grouping.Group,
		FoldersFirst: grouping.FoldersFirst,
	})
}
