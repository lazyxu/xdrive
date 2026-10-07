package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
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

type searchRangeDTO struct {
	Items      []searchResultDTO           `json:"items"`
	TotalCount int64                       `json:"total_count"`
	Offset     int                         `json:"offset"`
	Limit      int                         `json:"limit"`
	Sort       string                      `json:"sort"`
	Order      string                      `json:"order"`
	Groups     []fileExplorerGroupIndexDTO `json:"groups,omitempty"`
}

type searchCursor struct {
	Query   string `json:"q"`
	Type    string `json:"type,omitempty"`
	Filters string `json:"filters,omitempty"`
	Sort    string `json:"sort"`
	Order   string `json:"order"`
	Rank    int    `json:"rank"`
	Value   string `json:"value"`
	Path    string `json:"path"`
	ID      uint64 `json:"id"`
}

type searchFilters struct {
	Kind         string
	ModifiedFrom *time.Time
	ModifiedTo   *time.Time
	MinSize      *int64
	MaxSize      *int64
	SourceID     uint64
}

func (filters searchFilters) active() bool {
	return filters.Kind != "" ||
		filters.ModifiedFrom != nil ||
		filters.ModifiedTo != nil ||
		filters.MinSize != nil ||
		filters.MaxSize != nil ||
		filters.SourceID != 0
}

func (filters searchFilters) signature() string {
	modifiedFrom := ""
	if filters.ModifiedFrom != nil {
		modifiedFrom = filters.ModifiedFrom.UTC().Format(time.RFC3339Nano)
	}
	modifiedTo := ""
	if filters.ModifiedTo != nil {
		modifiedTo = filters.ModifiedTo.UTC().Format(time.RFC3339Nano)
	}
	minSize := ""
	if filters.MinSize != nil {
		minSize = strconv.FormatInt(*filters.MinSize, 10)
	}
	maxSize := ""
	if filters.MaxSize != nil {
		maxSize = strconv.FormatInt(*filters.MaxSize, 10)
	}
	return strings.Join([]string{
		filters.Kind,
		modifiedFrom,
		modifiedTo,
		minSize,
		maxSize,
		strconv.FormatUint(filters.SourceID, 10),
	}, "|")
}

func parseSearchFilters(c *gin.Context) (searchFilters, bool) {
	filters := searchFilters{Kind: strings.TrimSpace(strings.ToLower(c.Query("kind")))}
	switch filters.Kind {
	case "", "folder", "file", "image", "video", "audio", "pdf", "document",
		"spreadsheet", "presentation", "archive", "code", "text", "other":
	default:
		fail(c, http.StatusBadRequest, "kind is invalid")
		return searchFilters{}, false
	}

	parseTime := func(name string) (*time.Time, bool) {
		raw := strings.TrimSpace(c.Query(name))
		if raw == "" {
			return nil, true
		}
		value, err := time.Parse(time.RFC3339, raw)
		if err != nil {
			fail(c, http.StatusBadRequest, name+" must be RFC3339")
			return nil, false
		}
		value = value.UTC()
		return &value, true
	}
	var ok bool
	if filters.ModifiedFrom, ok = parseTime("modified_from"); !ok {
		return searchFilters{}, false
	}
	if filters.ModifiedTo, ok = parseTime("modified_to"); !ok {
		return searchFilters{}, false
	}
	if filters.ModifiedFrom != nil && filters.ModifiedTo != nil &&
		filters.ModifiedFrom.After(*filters.ModifiedTo) {
		fail(c, http.StatusBadRequest, "modified_from must not be after modified_to")
		return searchFilters{}, false
	}

	parseSize := func(name string) (*int64, bool) {
		raw := strings.TrimSpace(c.Query(name))
		if raw == "" {
			return nil, true
		}
		value, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || value < 0 {
			fail(c, http.StatusBadRequest, name+" must be zero or greater")
			return nil, false
		}
		return &value, true
	}
	if filters.MinSize, ok = parseSize("min_size"); !ok {
		return searchFilters{}, false
	}
	if filters.MaxSize, ok = parseSize("max_size"); !ok {
		return searchFilters{}, false
	}
	if filters.MinSize != nil && filters.MaxSize != nil &&
		*filters.MinSize > *filters.MaxSize {
		fail(c, http.StatusBadRequest, "min_size must not exceed max_size")
		return searchFilters{}, false
	}

	if raw := strings.TrimSpace(c.Query("source_id")); raw != "" {
		sourceID, err := strconv.ParseUint(raw, 10, 64)
		if err != nil || sourceID == 0 {
			fail(c, http.StatusBadRequest, "source_id must be a positive integer")
			return searchFilters{}, false
		}
		filters.SourceID = sourceID
	}
	return filters, true
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
	TotalCount      int64
}

func (s *Server) searchNodes(c *gin.Context) {
	query := strings.TrimSpace(c.Query("q"))
	if !utf8.ValidString(query) || len([]byte(query)) > maxSearchQuerySize ||
		(query != "" && utf8.RuneCountInString(query) < 2) {
		fail(c, http.StatusBadRequest, "q must be empty or contain at least 2 characters and at most 256 UTF-8 bytes")
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
	filters, ok := parseSearchFilters(c)
	if !ok {
		return
	}
	if query == "" && nodeType == "" && !filters.active() {
		fail(c, http.StatusBadRequest, "q or at least one structured filter is required")
		return
	}

	sortKey := strings.TrimSpace(strings.ToLower(c.Query("sort")))
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
	order := strings.TrimSpace(strings.ToLower(c.Query("order")))
	if order == "" {
		order = "asc"
	}
	if order != "asc" && order != "desc" {
		fail(c, http.StatusBadRequest, "order must be asc or desc")
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

	rawOffset, rangeRequested := c.GetQuery("offset")
	offset := 0
	if rangeRequested {
		rawOffset = strings.TrimSpace(rawOffset)
		value, err := strconv.Atoi(rawOffset)
		if rawOffset == "" || err != nil || value < 0 {
			fail(c, http.StatusBadRequest, "offset must be zero or greater")
			return
		}
		offset = value
		if strings.TrimSpace(c.Query("cursor")) != "" {
			fail(c, http.StatusBadRequest, "offset does not accept cursor")
			return
		}
	}

	grouping, ok := parseFileExplorerGrouping(c, rangeRequested)
	if !ok {
		return
	}

	var cursor searchCursor
	if !rangeRequested {
		if raw := strings.TrimSpace(c.Query("cursor")); raw != "" {
			decoded, err := decodeSearchCursor(raw)
			if err != nil {
				fail(c, http.StatusBadRequest, "invalid cursor")
				return
			}
			if decoded.Query != query || decoded.Type != nodeType ||
				decoded.Filters != filters.signature() ||
				decoded.Sort != sortKey || decoded.Order != order {
				fail(c, http.StatusBadRequest, "cursor does not match q/type/filters/sort/order")
				return
			}
			cursor = decoded
		}
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 8*time.Second)
	defer cancel()

	c.Header("Cache-Control", "no-store")
	if rangeRequested {
		page, err := s.searchNodeRange(ctx, userID(c), query, nodeType, filters, grouping, offset, limit, sortKey, order)
		if err != nil {
			fail(c, http.StatusInternalServerError, "search failed")
			return
		}
		c.JSON(http.StatusOK, page)
		return
	}

	page, err := s.searchNodePage(ctx, userID(c), query, nodeType, filters, limit, sortKey, order, cursor)
	if err != nil {
		fail(c, http.StatusInternalServerError, "search failed")
		return
	}
	c.JSON(http.StatusOK, page)
}
func searchNodeBaseQuery(
	ownerID uint64,
	query, nodeType string,
	filters searchFilters,
) (string, []any) {
	const recursivePathSearch = `WITH RECURSIVE tree AS (
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
),
search_rows AS (
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
    AND (? = '' OR strpos(lower(tree.path), lower(?)) > 0)
)
SELECT *
FROM search_rows
WHERE (? = '' OR search_rows.type = ?)
`

	const componentSearch = `WITH RECURSIVE matching_nodes AS (
  SELECT n.id, n.parent_id, n.type
  FROM xd_nodes n
  WHERE n.owner_id = ?
    AND n.parent_id IS NOT NULL
    AND n.deleted_at IS NULL
    AND (? = '' OR strpos(lower(n.name), lower(?)) > 0)
),
descendant_tree AS (
  SELECT n.id, n.parent_id, n.type
  FROM xd_nodes n
  JOIN matching_nodes matched
    ON matched.type = 'dir' AND n.parent_id = matched.id
  WHERE n.owner_id = ? AND n.deleted_at IS NULL
  UNION
  SELECT n.id, n.parent_id, n.type
  FROM xd_nodes n
  JOIN descendant_tree parent
    ON parent.type = 'dir' AND n.parent_id = parent.id
  WHERE n.owner_id = ? AND n.deleted_at IS NULL
),
candidate_tree AS (
  SELECT id, parent_id, type FROM matching_nodes
  UNION
  SELECT id, parent_id, type FROM descendant_tree
),
required_dirs AS (
  SELECT DISTINCT
    CASE WHEN candidate.type = 'dir' THEN candidate.id ELSE candidate.parent_id END AS id
  FROM candidate_tree candidate
  WHERE candidate.type = 'dir' OR candidate.parent_id IS NOT NULL
  UNION
  SELECT parent.parent_id AS id
  FROM xd_nodes parent
  JOIN required_dirs required ON required.id = parent.id
  WHERE parent.owner_id = ?
    AND parent.deleted_at IS NULL
    AND parent.parent_id IS NOT NULL
),
directory_tree AS (
  SELECT
    n.id,
    n.parent_id,
    n.name,
    ''::text AS path,
    jsonb_build_array(jsonb_build_object('id', n.id, 'name', n.name)) AS breadcrumbs
  FROM xd_nodes n
  JOIN required_dirs required ON required.id = n.id
  WHERE n.owner_id = ?
    AND n.parent_id IS NULL
    AND n.deleted_at IS NULL
    AND n.type = 'dir'
  UNION ALL
  SELECT
    n.id,
    n.parent_id,
    n.name,
    CASE
      WHEN directory_tree.path = '' THEN n.name
      ELSE directory_tree.path || '/' || n.name
    END,
    directory_tree.breadcrumbs || jsonb_build_array(jsonb_build_object('id', n.id, 'name', n.name))
  FROM xd_nodes n
  JOIN directory_tree ON n.parent_id = directory_tree.id
  JOIN required_dirs required ON required.id = n.id
  WHERE n.owner_id = ?
    AND n.deleted_at IS NULL
    AND n.type = 'dir'
),
search_rows AS (
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
    CASE
      WHEN n.type = 'dir' THEN self_dir.path
      WHEN parent_dir.path = '' THEN n.name
      ELSE parent_dir.path || '/' || n.name
    END AS path,
    CASE
      WHEN n.type = 'dir' THEN self_dir.breadcrumbs::text
      ELSE parent_dir.breadcrumbs::text
    END AS breadcrumbs_json
  FROM candidate_tree candidate
  JOIN xd_nodes n
    ON n.id = candidate.id
    AND n.owner_id = ?
    AND n.deleted_at IS NULL
  LEFT JOIN directory_tree self_dir
    ON n.type = 'dir' AND self_dir.id = n.id
  LEFT JOIN directory_tree parent_dir
    ON n.type = 'file' AND parent_dir.id = n.parent_id
  LEFT JOIN xd_files f ON f.node_id = n.id
  WHERE
    (n.type = 'dir' AND self_dir.id IS NOT NULL)
    OR (n.type = 'file' AND parent_dir.id IS NOT NULL)
)
SELECT *
FROM search_rows
WHERE (? = '' OR search_rows.type = ?)
`

	filterSQL, filterArgs := searchNodeStructuredFilterSQL(ownerID, filters)
	if query == "" || strings.Contains(query, "/") {
		args := []any{ownerID, ownerID, query, query, nodeType, nodeType}
		return recursivePathSearch + filterSQL, append(args, filterArgs...)
	}
	args := []any{
		ownerID, query, query, ownerID,
		ownerID, ownerID,
		ownerID, ownerID,
		ownerID, nodeType, nodeType,
	}
	return componentSearch + filterSQL, append(args, filterArgs...)
}

func searchNodeStructuredFilterSQL(ownerID uint64, filters searchFilters) (string, []any) {
	extensionExpr := `(CASE
		WHEN strpos(search_rows.name, '.') > 1 AND right(search_rows.name, 1) <> '.'
			THEN lower(reverse(split_part(reverse(search_rows.name), '.', 1)))
		ELSE ''
	END)`
	kindExpr := fmt.Sprintf(`(CASE
		WHEN search_rows.type = 'dir' THEN 'folder'
		WHEN %s IN ('avif','bmp','gif','heic','heif','jpeg','jpg','png','tif','tiff','webp') THEN 'image'
		WHEN %s IN ('avi','m4v','mkv','mov','mp4','mpeg','mpg','webm') THEN 'video'
		WHEN %s IN ('aac','flac','m4a','mp3','ogg','wav','wma') THEN 'audio'
		WHEN %s = 'pdf' THEN 'pdf'
		WHEN %s IN ('doc','docx','odt','rtf') THEN 'document'
		WHEN %s IN ('csv','ods','xls','xlsx') THEN 'spreadsheet'
		WHEN %s IN ('odp','ppt','pptx') THEN 'presentation'
		WHEN %s IN ('7z','bz2','gz','rar','tar','tgz','xz','zip') THEN 'archive'
		WHEN %s IN ('c','cc','cpp','css','go','h','hpp','html','java','js','json','jsx','kt','md','php','py','rb','rs','sh','sql','swift','toml','ts','tsx','xml','yaml','yml') THEN 'code'
		WHEN %s IN ('ini','log','text','txt') THEN 'text'
		ELSE 'other'
	END)`,
		extensionExpr, extensionExpr, extensionExpr, extensionExpr, extensionExpr,
		extensionExpr, extensionExpr, extensionExpr, extensionExpr, extensionExpr,
	)
	modifiedFrom := time.Time{}
	if filters.ModifiedFrom != nil {
		modifiedFrom = *filters.ModifiedFrom
	}
	modifiedTo := time.Time{}
	if filters.ModifiedTo != nil {
		modifiedTo = *filters.ModifiedTo
	}
	minSize := int64(0)
	if filters.MinSize != nil {
		minSize = *filters.MinSize
	}
	maxSize := int64(0)
	if filters.MaxSize != nil {
		maxSize = *filters.MaxSize
	}
	sqlText := fmt.Sprintf(`
  AND (
    ? = ''
    OR (? = 'folder' AND search_rows.type = 'dir')
    OR (? = 'file' AND search_rows.type = 'file')
    OR (search_rows.type = 'file' AND ? NOT IN ('folder', 'file') AND %s = ?)
  )
  AND (? = FALSE OR search_rows.updated_at >= ?)
  AND (? = FALSE OR search_rows.updated_at < ?)
  AND (? = FALSE OR (search_rows.type = 'file' AND search_rows.size >= ?))
  AND (? = FALSE OR (search_rows.type = 'file' AND search_rows.size <= ?))
`, kindExpr)
	args := []any{
		filters.Kind, filters.Kind, filters.Kind, filters.Kind, filters.Kind,
		filters.ModifiedFrom != nil, modifiedFrom,
		filters.ModifiedTo != nil, modifiedTo,
		filters.MinSize != nil, minSize,
		filters.MaxSize != nil, maxSize,
	}
	if filters.SourceID != 0 {
		sqlText += `
  AND EXISTS (
    SELECT 1
    FROM xd_source_items source_item
    JOIN xd_sources source
      ON source.id = source_item.source_id
     AND source.owner_id = ?
    WHERE source_item.node_id = search_rows.id
      AND source_item.source_id = ?
  )
`
		args = append(args, ownerID, filters.SourceID)
	}
	return sqlText, args
}
func searchNodeOrderExpressions(alias, sortKey, order string) (
	rankExpr, sortExpr, pathExpr, direction string,
) {
	rankExpr = fmt.Sprintf("(CASE WHEN %s.type = 'dir' THEN 0 ELSE 1 END)", alias)
	pathExpr = fmt.Sprintf("lower(%s.path)", alias)
	sortExpr = fmt.Sprintf("lower(%s.name)", alias)
	switch sortKey {
	case "updated":
		sortExpr = fmt.Sprintf("%s.updated_at", alias)
	case "size":
		sortExpr = fmt.Sprintf("%s.size", alias)
	case "type":
		sortExpr = fmt.Sprintf(
			"(CASE WHEN %s.type = 'dir' THEN '' WHEN strpos(%s.name, '.') > 1 AND right(%s.name, 1) <> '.' THEN lower(regexp_replace(%s.name, '^.*\\.', '')) ELSE '' END)",
			alias, alias, alias, alias,
		)
	}
	direction = "ASC"
	if order == "desc" {
		direction = "DESC"
	}
	return
}

func searchRowsToResults(rows []searchRow) ([]searchResultDTO, error) {
	items := make([]searchResultDTO, 0, len(rows))
	for _, row := range rows {
		var breadcrumbs []searchBreadcrumbDTO
		if err := json.Unmarshal([]byte(row.BreadcrumbsJSON), &breadcrumbs); err != nil {
			return nil, err
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
	return items, nil
}

func (s *Server) searchNodePage(
	ctx context.Context,
	ownerID uint64,
	query, nodeType string,
	filters searchFilters,
	limit int,
	sortKey, order string,
	cursor searchCursor,
) (searchPageDTO, error) {
	sqlText, args := searchNodeBaseQuery(ownerID, query, nodeType, filters)
	rankExpr, sortExpr, pathExpr, direction := searchNodeOrderExpressions(
		"search_rows",
		sortKey,
		order,
	)

	if cursor.ID != 0 {
		value, err := searchCursorQueryValue(cursor, sortKey)
		if err != nil {
			return searchPageDTO{}, err
		}
		compare := ">"
		if order == "desc" {
			compare = "<"
		}
		sqlText += fmt.Sprintf(`  AND (
    %s > ?
    OR (%s = ? AND (
      %s %s ?
      OR (%s = ? AND (
        %s > lower(?)
        OR (%s = lower(?) AND search_rows.id > ?)
      ))
    ))
  )
`, rankExpr, rankExpr, sortExpr, compare, sortExpr, pathExpr, pathExpr)
		args = append(args,
			cursor.Rank,
			cursor.Rank,
			value,
			value,
			cursor.Path,
			cursor.Path,
			cursor.ID,
		)
	}

	sqlText += fmt.Sprintf(
		"ORDER BY %s ASC, %s %s, %s ASC, search_rows.id ASC\nLIMIT ?",
		rankExpr,
		sortExpr,
		direction,
		pathExpr,
	)
	args = append(args, limit+1)

	var rows []searchRow
	if err := s.DB.WithContext(ctx).Raw(sqlText, args...).Scan(&rows).Error; err != nil {
		return searchPageDTO{}, err
	}

	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	items, err := searchRowsToResults(rows)
	if err != nil {
		return searchPageDTO{}, err
	}

	page := searchPageDTO{Items: items}
	if hasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		rank := 1
		if last.Type == meta.NodeTypeDir {
			rank = 0
		}
		page.NextCursor = encodeSearchCursor(searchCursor{
			Query:   query,
			Type:    nodeType,
			Filters: filters.signature(),
			Sort:    sortKey,
			Order:   order,
			Rank:    rank,
			Value:   searchRowCursorValue(last, sortKey),
			Path:    last.Path,
			ID:      last.ID,
		})
	}
	return page, nil
}

func (s *Server) searchNodeRange(
	ctx context.Context,
	ownerID uint64,
	query, nodeType string,
	filters searchFilters,
	grouping fileExplorerGrouping,
	offset, limit int,
	sortKey, order string,
) (searchRangeDTO, error) {
	baseSQL, baseArgs := searchNodeBaseQuery(ownerID, query, nodeType, filters)
	_, sortExpr, pathExpr, direction := searchNodeOrderExpressions(
		"search_page",
		sortKey,
		order,
	)
	groupFields := fileExplorerGroupFields{
		Type:    "search_page.type",
		Name:    "search_page.name",
		Updated: "search_page.updated_at",
		Size:    "search_page.size",
	}
	orderBy := fmt.Sprintf(
		"%s%s %s, %s ASC, search_page.id ASC",
		fileExplorerItemOrderPrefix(groupFields, grouping),
		sortExpr,
		direction,
		pathExpr,
	)
	sqlText := fmt.Sprintf(`SELECT search_page.*, COUNT(*) OVER() AS total_count
FROM (
%s
) AS search_page
ORDER BY %s
OFFSET ? LIMIT ?`,
		baseSQL,
		orderBy,
	)
	args := append(append([]any{}, baseArgs...), offset, limit)

	var rows []searchRow
	if err := s.DB.WithContext(ctx).Raw(sqlText, args...).Scan(&rows).Error; err != nil {
		return searchRangeDTO{}, err
	}

	totalCount := int64(0)
	if len(rows) > 0 {
		totalCount = rows[0].TotalCount
	} else if offset > 0 {
		countSQL := fmt.Sprintf(
			"SELECT COUNT(*) AS total_count FROM (\n%s\n) AS search_count",
			baseSQL,
		)
		var count struct {
			TotalCount int64 `gorm:"column:total_count"`
		}
		if err := s.DB.WithContext(ctx).Raw(countSQL, baseArgs...).Scan(&count).Error; err != nil {
			return searchRangeDTO{}, err
		}
		totalCount = count.TotalCount
	}

	var groups []fileExplorerGroupIndexDTO
	if offset == 0 && grouping.Group != "none" {
		groupFields := fileExplorerGroupFields{
			Type:    "search_group.type",
			Name:    "search_group.name",
			Updated: "search_group.updated_at",
			Size:    "search_group.size",
		}
		groupKey := fileExplorerGroupKeyExpr(groupFields, grouping)
		groupSQL := fmt.Sprintf(`SELECT %s AS group_key, COUNT(*) AS item_count
FROM (
%s
) AS search_group
GROUP BY %s
ORDER BY %s`,
			groupKey,
			baseSQL,
			groupKey,
			fileExplorerGroupOrder(groupFields, grouping),
		)
		var groupRows []fileExplorerGroupRow
		if err := s.DB.WithContext(ctx).Raw(groupSQL, baseArgs...).Scan(&groupRows).Error; err != nil {
			return searchRangeDTO{}, err
		}
		groups = fileExplorerGroupIndexes(groupRows)
	}

	items, err := searchRowsToResults(rows)
	if err != nil {
		return searchRangeDTO{}, err
	}
	return searchRangeDTO{
		Items:      items,
		TotalCount: totalCount,
		Offset:     offset,
		Limit:      limit,
		Sort:       sortKey,
		Order:      order,
		Groups:     groups,
	}, nil
}

func searchRowCursorValue(row searchRow, sortKey string) string {
	switch sortKey {
	case "updated":
		return row.UpdatedAt.UTC().Format(time.RFC3339Nano)
	case "size":
		return strconv.FormatInt(row.Size, 10)
	case "type":
		dot := strings.LastIndex(row.Name, ".")
		if row.Type == meta.NodeTypeDir || dot <= 0 || dot == len(row.Name)-1 {
			return ""
		}
		return strings.ToLower(row.Name[dot+1:])
	default:
		return strings.ToLower(row.Name)
	}
}

func searchCursorQueryValue(cursor searchCursor, sortKey string) (any, error) {
	switch sortKey {
	case "updated":
		return time.Parse(time.RFC3339Nano, cursor.Value)
	case "size":
		return strconv.ParseInt(cursor.Value, 10, 64)
	default:
		return cursor.Value, nil
	}
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
		(strings.TrimSpace(cursor.Query) == "" && strings.TrimSpace(cursor.Type) == "" && strings.TrimSpace(cursor.Filters) == "") ||
		strings.TrimSpace(cursor.Path) == "" ||
		(cursor.Sort != "name" && cursor.Sort != "updated" && cursor.Sort != "size" && cursor.Sort != "type") ||
		(cursor.Order != "asc" && cursor.Order != "desc") {
		return searchCursor{}, errors.New("invalid search cursor")
	}
	if _, err := searchCursorQueryValue(cursor, cursor.Sort); err != nil {
		return searchCursor{}, errors.New("invalid search cursor")
	}
	return cursor, nil
}
