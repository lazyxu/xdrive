package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
)

const (
	defaultSearchLimit = 50
	maxSearchLimit     = 200
	maxSearchQuerySize = 256
)

type searchBreadcrumbDTO struct {
	ID   uint64 `json:"id"`
	Name string `json:"name"`
}

type searchResultDTO struct {
	Node        nodeDTO               `json:"node"`
	Path        string                `json:"path"`
	Breadcrumbs []searchBreadcrumbDTO `json:"breadcrumbs"`
}

type searchPageDTO struct {
	Items      []searchResultDTO `json:"items"`
	NextCursor string            `json:"next_cursor,omitempty"`
}

type searchCursor struct {
	Query string `json:"q"`
	Type  string `json:"type,omitempty"`
	Rank  int    `json:"rank"`
	Path  string `json:"path"`
	ID    uint64 `json:"id"`
}

type searchRow struct {
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
}

func (s *Server) searchNodes(c *gin.Context) {
	query := strings.TrimSpace(c.Query("q"))
	if !utf8.ValidString(query) || utf8.RuneCountInString(query) < 2 || len([]byte(query)) > maxSearchQuerySize {
		fail(c, http.StatusBadRequest, "q must contain at least 2 characters and at most 256 UTF-8 bytes")
		return
	}

	nodeType := strings.TrimSpace(strings.ToLower(c.Query("type")))
	if nodeType == "all" {
		nodeType = ""
	}
	if nodeType != "" && nodeType != meta.NodeTypeFile && nodeType != meta.NodeTypeDir {
		fail(c, http.StatusBadRequest, "type must be file or dir")
		return
	}

	limit := defaultSearchLimit
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > maxSearchLimit {
			fail(c, http.StatusBadRequest, "limit must be between 1 and 200")
			return
		}
		limit = value
	}

	var cursor searchCursor
	if raw := strings.TrimSpace(c.Query("cursor")); raw != "" {
		decoded, err := decodeSearchCursor(raw)
		if err != nil {
			fail(c, http.StatusBadRequest, "invalid cursor")
			return
		}
		if decoded.Query != query || decoded.Type != nodeType {
			fail(c, http.StatusBadRequest, "cursor does not match q/type")
			return
		}
		cursor = decoded
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 8*time.Second)
	defer cancel()

	page, err := s.searchNodePage(ctx, userID(c), query, nodeType, limit, cursor)
	if err != nil {
		fail(c, http.StatusInternalServerError, "search failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, page)
}

func (s *Server) searchNodePage(ctx context.Context, ownerID uint64, query, nodeType string, limit int, cursor searchCursor) (searchPageDTO, error) {
	const recursiveTree = `WITH RECURSIVE tree AS (
  SELECT
    n.id, n.parent_id, n.name, n.type, n.revision, n.created_at, n.updated_at,
    ''::text AS path,
    jsonb_build_array(jsonb_build_object('id', n.id, 'name', n.name)) AS breadcrumbs
  FROM xd_nodes n
  WHERE n.owner_id = ? AND n.parent_id IS NULL AND n.deleted_at IS NULL
  UNION ALL
  SELECT
    n.id, n.parent_id, n.name, n.type, n.revision, n.created_at, n.updated_at,
    CASE WHEN tree.path = '' THEN n.name ELSE tree.path || '/' || n.name END,
    CASE
      WHEN n.type = 'dir'
        THEN tree.breadcrumbs || jsonb_build_array(jsonb_build_object('id', n.id, 'name', n.name))
      ELSE tree.breadcrumbs
    END
  FROM xd_nodes n
  JOIN tree ON n.parent_id = tree.id
  WHERE n.owner_id = ? AND n.deleted_at IS NULL
)
SELECT
  tree.id,
  tree.parent_id,
  tree.name,
  tree.type,
  tree.revision,
  tree.created_at,
  tree.updated_at,
  COALESCE(f.size, 0) AS size,
  COALESCE(f.sha256, '') AS sha256,
  tree.path,
  tree.breadcrumbs::text AS breadcrumbs_json
FROM tree
LEFT JOIN xd_files f ON f.node_id = tree.id
WHERE tree.parent_id IS NOT NULL
  AND strpos(lower(tree.path), lower(?)) > 0
  AND (? = '' OR tree.type = ?)
`

	sqlText := recursiveTree
	args := []any{ownerID, ownerID, query, nodeType, nodeType}
	if cursor.ID != 0 {
		sqlText += `  AND (
    (CASE WHEN tree.type = 'dir' THEN 0 ELSE 1 END) > ?
    OR ((CASE WHEN tree.type = 'dir' THEN 0 ELSE 1 END) = ? AND lower(tree.path) > lower(?))
    OR ((CASE WHEN tree.type = 'dir' THEN 0 ELSE 1 END) = ? AND lower(tree.path) = lower(?) AND tree.id > ?)
  )
`
		args = append(args, cursor.Rank, cursor.Rank, cursor.Path, cursor.Rank, cursor.Path, cursor.ID)
	}
	sqlText += "ORDER BY (CASE WHEN tree.type = 'dir' THEN 0 ELSE 1 END) ASC, lower(tree.path) ASC, tree.id ASC\nLIMIT ?"
	args = append(args, limit+1)

	var rows []searchRow
	if err := s.DB.WithContext(ctx).Raw(sqlText, args...).Scan(&rows).Error; err != nil {
		return searchPageDTO{}, err
	}

	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	items := make([]searchResultDTO, 0, len(rows))
	for _, row := range rows {
		var breadcrumbs []searchBreadcrumbDTO
		if err := json.Unmarshal([]byte(row.BreadcrumbsJSON), &breadcrumbs); err != nil {
			return searchPageDTO{}, err
		}
		items = append(items, searchResultDTO{
			Node: nodeDTO{
				ID: row.ID, ParentID: row.ParentID, Name: row.Name, Type: row.Type,
				Size: row.Size, Revision: row.Revision, SHA256: row.SHA256,
				CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
			},
			Path:        row.Path,
			Breadcrumbs: breadcrumbs,
		})
	}

	page := searchPageDTO{Items: items}
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		rank := 1
		if last.Type == meta.NodeTypeDir {
			rank = 0
		}
		page.NextCursor = encodeSearchCursor(searchCursor{Query: query, Type: nodeType, Rank: rank, Path: last.Path, ID: last.ID})
	}
	return page, nil
}

func encodeSearchCursor(cursor searchCursor) string {
	raw, _ := json.Marshal(cursor)
	return base64.RawURLEncoding.EncodeToString(raw)
}

func decodeSearchCursor(raw string) (searchCursor, error) {
	var cursor searchCursor
	data, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return searchCursor{}, err
	}
	if err := json.Unmarshal(data, &cursor); err != nil {
		return searchCursor{}, err
	}
	if cursor.ID == 0 || (cursor.Rank != 0 && cursor.Rank != 1) ||
		strings.TrimSpace(cursor.Query) == "" || strings.TrimSpace(cursor.Path) == "" {
		return searchCursor{}, errors.New("invalid search cursor")
	}
	return cursor, nil
}
