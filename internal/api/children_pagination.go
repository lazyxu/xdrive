package api

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
)

const (
	childrenDefaultLimit = 200
	childrenMaxLimit     = 500
)

type childrenPageDTO struct {
	Items      []nodeDTO `json:"items"`
	NextCursor string    `json:"next_cursor,omitempty"`
	HasMore    bool      `json:"has_more"`
	Sort       string    `json:"sort"`
	Order      string    `json:"order"`
}

type childrenRangeDTO struct {
	Items      []nodeDTO `json:"items"`
	TotalCount int64     `json:"total_count"`
	Offset     int       `json:"offset"`
	Limit      int       `json:"limit"`
	Sort       string    `json:"sort"`
	Order      string    `json:"order"`
}

type childrenPageOptions struct {
	Limit  int
	Cursor string
	Offset *int
	Sort   string
	Order  string
	Name   string
	NameCI string
}

type childrenPageRow struct {
	ID         uint64    `gorm:"column:id"`
	ParentID   *uint64   `gorm:"column:parent_id"`
	Name       string    `gorm:"column:name"`
	Type       string    `gorm:"column:type"`
	Revision   uint64    `gorm:"column:revision"`
	CreatedAt  time.Time `gorm:"column:created_at"`
	UpdatedAt  time.Time `gorm:"column:updated_at"`
	FileSize   int64     `gorm:"column:file_size"`
	FileSHA256 string    `gorm:"column:file_sha256"`
	TotalCount int64     `gorm:"column:total_count"`
}

func (row childrenPageRow) dto() nodeDTO {
	return nodeDTO{
		ID: row.ID, ParentID: row.ParentID, Name: row.Name, Type: row.Type,
		Size: row.FileSize, Revision: row.Revision, SHA256: row.FileSHA256,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}

type childrenCursor struct {
	Sort  string `json:"sort"`
	Order string `json:"order"`
	Rank  int    `json:"rank"`
	Value string `json:"value"`
	Name  string `json:"name"`
	ID    uint64 `json:"id"`
}

func childrenPaginationRequested(c *gin.Context) bool {
	query := c.Request.URL.Query()
	for _, key := range []string{"limit", "cursor", "offset", "sort", "order", "name", "name_ci"} {
		if _, ok := query[key]; ok {
			return true
		}
	}
	return false
}

func parseChildrenPageOptions(c *gin.Context) (childrenPageOptions, bool) {
	options := childrenPageOptions{
		Limit:  childrenDefaultLimit,
		Cursor: strings.TrimSpace(c.Query("cursor")),
		Sort:   strings.TrimSpace(strings.ToLower(c.Query("sort"))),
		Order:  strings.TrimSpace(strings.ToLower(c.Query("order"))),
		Name:   c.Query("name"),
		NameCI: c.Query("name_ci"),
	}
	if options.Sort == "" {
		options.Sort = "name"
	}
	if options.Sort == "updated_at" {
		options.Sort = "updated"
	}
	switch options.Sort {
	case "name", "updated", "size", "type":
	default:
		fail(c, http.StatusBadRequest, "sort must be name, updated, size, or type")
		return childrenPageOptions{}, false
	}
	if options.Order == "" {
		options.Order = "asc"
	}
	if options.Order != "asc" && options.Order != "desc" {
		fail(c, http.StatusBadRequest, "order must be asc or desc")
		return childrenPageOptions{}, false
	}
	if rawValues, exists := c.Request.URL.Query()["offset"]; exists {
		raw := ""
		if len(rawValues) > 0 {
			raw = strings.TrimSpace(rawValues[0])
		}
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			fail(c, http.StatusBadRequest, "offset must be zero or greater")
			return childrenPageOptions{}, false
		}
		options.Offset = &value
	}
	if options.Name != "" && options.NameCI != "" {
		fail(c, http.StatusBadRequest, "name and name_ci are mutually exclusive")
		return childrenPageOptions{}, false
	}
	if (options.Name != "" || options.NameCI != "") && options.Cursor != "" {
		fail(c, http.StatusBadRequest, "name filters do not accept cursor")
		return childrenPageOptions{}, false
	}
	if options.Offset != nil && options.Cursor != "" {
		fail(c, http.StatusBadRequest, "offset does not accept cursor")
		return childrenPageOptions{}, false
	}
	if options.Offset != nil && (options.Name != "" || options.NameCI != "") {
		fail(c, http.StatusBadRequest, "name filters do not accept offset")
		return childrenPageOptions{}, false
	}
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > childrenMaxLimit {
			fail(c, http.StatusBadRequest, "limit must be between 1 and 500")
			return childrenPageOptions{}, false
		}
		options.Limit = value
	}
	return options, true
}

func (s *Server) childrenPage(c *gin.Context, parentID uint64) {
	options, ok := parseChildrenPageOptions(c)
	if !ok {
		return
	}

	rankExpr := "(CASE WHEN xd_nodes.type = 'dir' THEN 0 ELSE 1 END)"
	nameExpr := "lower(xd_nodes.name)"
	sortExpr := nameExpr
	switch options.Sort {
	case "updated":
		sortExpr = "xd_nodes.updated_at"
	case "size":
		sortExpr = "COALESCE(child_file.size, 0)"
	case "type":
		sortExpr = "(CASE WHEN xd_nodes.type = 'dir' THEN '' WHEN strpos(xd_nodes.name, '.') > 1 AND right(xd_nodes.name, 1) <> '.' THEN lower(regexp_replace(xd_nodes.name, '^.*\\.', '')) ELSE '' END)"
	}

	uid := userID(c)
	query := s.DB.
		Table("xd_nodes").
		Select(`xd_nodes.id, xd_nodes.parent_id, xd_nodes.name, xd_nodes.type,
			xd_nodes.revision, xd_nodes.created_at, xd_nodes.updated_at,
			COALESCE(child_file.size, 0) AS file_size,
			COALESCE(child_file.sha256, '') AS file_sha256`).
		Joins("LEFT JOIN xd_files AS child_file ON child_file.node_id = xd_nodes.id").
		Joins(`JOIN xd_nodes AS parent_node
			ON parent_node.id = ?
			AND parent_node.owner_id = ?
			AND parent_node.type = ?
			AND parent_node.deleted_at IS NULL`, parentID, uid, meta.NodeTypeDir).
		Where("xd_nodes.owner_id = ? AND xd_nodes.parent_id = ? AND xd_nodes.deleted_at IS NULL", uid, parentID)

	if options.Name != "" {
		query = query.Where(
			"lower(xd_nodes.name) = lower(?) AND xd_nodes.name = ?",
			options.Name,
			options.Name,
		)
	}
	if options.NameCI != "" {
		query = query.Where("lower(xd_nodes.name) = lower(?)", options.NameCI)
	}

	if options.Cursor != "" {
		cursor, err := decodeChildrenCursor(options.Cursor)
		if err != nil || cursor.Sort != options.Sort || cursor.Order != options.Order {
			fail(c, http.StatusBadRequest, "invalid children cursor")
			return
		}
		value, err := childrenCursorQueryValue(cursor, options.Sort)
		if err != nil {
			fail(c, http.StatusBadRequest, "invalid children cursor")
			return
		}
		compare := ">"
		if options.Order == "desc" {
			compare = "<"
		}
		where := fmt.Sprintf(`(
			%s > ?
			OR (%s = ? AND (
				%s %s ?
				OR (%s = ? AND (
					%s %s ?
					OR (%s = ? AND xd_nodes.id %s ?)
				))
			))
		)`, rankExpr, rankExpr, sortExpr, compare, sortExpr, nameExpr, compare, nameExpr, compare)
		query = query.Where(
			where,
			cursor.Rank,
			cursor.Rank,
			value,
			value,
			cursor.Name,
			cursor.Name,
			cursor.ID,
		)
	}

	direction := "ASC"
	if options.Order == "desc" {
		direction = "DESC"
	}
	orderBy := fmt.Sprintf("%s ASC, %s %s, %s %s, xd_nodes.id %s", rankExpr, sortExpr, direction, nameExpr, direction, direction)

	if options.Offset != nil {
		var rows []childrenPageRow
		rangeQuery := query.Select(`xd_nodes.id, xd_nodes.parent_id, xd_nodes.name, xd_nodes.type,
			xd_nodes.revision, xd_nodes.created_at, xd_nodes.updated_at,
			COALESCE(child_file.size, 0) AS file_size,
			COALESCE(child_file.sha256, '') AS file_sha256,
			COUNT(*) OVER() AS total_count`)
		if err := rangeQuery.
			Order(orderBy).
			Offset(*options.Offset).
			Limit(options.Limit).
			Scan(&rows).Error; err != nil {
			fail(c, http.StatusInternalServerError, "list failed")
			return
		}

		var totalCount int64
		if len(rows) > 0 {
			totalCount = rows[0].TotalCount
		} else {
			countQuery := s.DB.
				Table("xd_nodes").
				Joins(`JOIN xd_nodes AS parent_node
					ON parent_node.id = ?
					AND parent_node.owner_id = ?
					AND parent_node.type = ?
					AND parent_node.deleted_at IS NULL`, parentID, uid, meta.NodeTypeDir).
				Where("xd_nodes.owner_id = ? AND xd_nodes.parent_id = ? AND xd_nodes.deleted_at IS NULL", uid, parentID)
			if err := countQuery.Count(&totalCount).Error; err != nil {
				fail(c, http.StatusInternalServerError, "count children failed")
				return
			}
			if totalCount == 0 {
				if _, err := s.ownedDirectory(uid, parentID); err != nil {
					fail(c, statusForLookup(err), "directory not found")
					return
				}
			}
		}

		out := make([]nodeDTO, 0, len(rows))
		for _, row := range rows {
			out = append(out, row.dto())
		}
		c.Header("Cache-Control", "no-store")
		c.JSON(http.StatusOK, childrenRangeDTO{
			Items:      out,
			TotalCount: totalCount,
			Offset:     *options.Offset,
			Limit:      options.Limit,
			Sort:       options.Sort,
			Order:      options.Order,
		})
		return
	}

	var rows []childrenPageRow
	if err := query.Order(orderBy).Limit(options.Limit + 1).Scan(&rows).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list failed")
		return
	}
	if len(rows) == 0 {
		if _, err := s.ownedDirectory(uid, parentID); err != nil {
			fail(c, statusForLookup(err), "directory not found")
			return
		}
	}

	hasMore := len(rows) > options.Limit
	if hasMore {
		rows = rows[:options.Limit]
	}
	out := make([]nodeDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.dto())
	}

	nextCursor := ""
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		cursor, err := encodeChildrenCursor(childrenCursor{
			Sort:  options.Sort,
			Order: options.Order,
			Rank:  childrenNodeRank(last),
			Value: childrenNodeCursorValue(last, options.Sort),
			Name:  strings.ToLower(last.Name),
			ID:    last.ID,
		})
		if err != nil {
			fail(c, http.StatusInternalServerError, "encode children cursor failed")
			return
		}
		nextCursor = cursor
	}

	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, childrenPageDTO{
		Items:      out,
		NextCursor: nextCursor,
		HasMore:    hasMore,
		Sort:       options.Sort,
		Order:      options.Order,
	})
}

func childrenNodeRank(node childrenPageRow) int {
	if node.Type == meta.NodeTypeDir {
		return 0
	}
	return 1
}

func childrenNodeCursorValue(node childrenPageRow, sortKey string) string {
	switch sortKey {
	case "updated":
		return node.UpdatedAt.UTC().Format(time.RFC3339Nano)
	case "size":
		return strconv.FormatInt(node.FileSize, 10)
	case "type":
		if node.Type == meta.NodeTypeDir {
			return ""
		}
		dot := strings.LastIndex(node.Name, ".")
		if dot <= 0 || dot == len(node.Name)-1 {
			return ""
		}
		return strings.ToLower(node.Name[dot+1:])
	default:
		return strings.ToLower(node.Name)
	}
}

func childrenCursorQueryValue(cursor childrenCursor, sortKey string) (any, error) {
	switch sortKey {
	case "updated":
		value, err := time.Parse(time.RFC3339Nano, cursor.Value)
		if err != nil {
			return nil, err
		}
		return value, nil
	case "size":
		value, err := strconv.ParseInt(cursor.Value, 10, 64)
		if err != nil {
			return nil, err
		}
		return value, nil
	default:
		return cursor.Value, nil
	}
}

func encodeChildrenCursor(cursor childrenCursor) (string, error) {
	raw, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func decodeChildrenCursor(raw string) (childrenCursor, error) {
	var cursor childrenCursor
	data, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return childrenCursor{}, err
	}
	if err := json.Unmarshal(data, &cursor); err != nil {
		return childrenCursor{}, err
	}
	if cursor.ID == 0 || (cursor.Rank != 0 && cursor.Rank != 1) || cursor.Sort == "" || cursor.Order == "" {
		return childrenCursor{}, fmt.Errorf("invalid cursor")
	}
	return cursor, nil
}
