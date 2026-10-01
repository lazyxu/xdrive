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

type childrenPageOptions struct {
	Limit  int
	Cursor string
	Sort   string
	Order  string
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
	for _, key := range []string{"limit", "cursor", "sort", "order"} {
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

	query := s.DB.
		Model(&meta.Node{}).
		Select("xd_nodes.*").
		Joins("LEFT JOIN xd_files AS child_file ON child_file.node_id = xd_nodes.id").
		Preload("File").
		Where("xd_nodes.owner_id = ? AND xd_nodes.parent_id = ? AND xd_nodes.deleted_at IS NULL", userID(c), parentID)

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
	orderBy := fmt.Sprintf(
		"%s ASC, %s %s, %s %s, xd_nodes.id %s",
		rankExpr,
		sortExpr,
		direction,
		nameExpr,
		direction,
		direction,
	)

	var nodes []meta.Node
	if err := query.Order(orderBy).Limit(options.Limit + 1).Find(&nodes).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list failed")
		return
	}

	hasMore := len(nodes) > options.Limit
	if hasMore {
		nodes = nodes[:options.Limit]
	}
	out := make([]nodeDTO, 0, len(nodes))
	for _, node := range nodes {
		out = append(out, toNodeDTO(node))
	}

	nextCursor := ""
	if hasMore && len(nodes) > 0 {
		last := nodes[len(nodes)-1]
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

func childrenNodeRank(node meta.Node) int {
	if node.Type == meta.NodeTypeDir {
		return 0
	}
	return 1
}

func childrenNodeCursorValue(node meta.Node, sortKey string) string {
	switch sortKey {
	case "updated":
		return node.UpdatedAt.UTC().Format(time.RFC3339Nano)
	case "size":
		if node.File == nil {
			return "0"
		}
		return strconv.FormatInt(node.File.Size, 10)
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
	if cursor.ID == 0 ||
		(cursor.Rank != 0 && cursor.Rank != 1) ||
		cursor.Sort == "" ||
		cursor.Order == "" {
		return childrenCursor{}, fmt.Errorf("invalid cursor")
	}
	return cursor, nil
}
