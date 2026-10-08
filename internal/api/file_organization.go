package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	fileTagLimit          = 128
	fileTagNodeBatchLimit = 500
	fileSavedSearchLimit  = 64
)

var fileTagColorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

type fileTagDTO struct {
	ID        uint64    `json:"id"`
	Name      string    `json:"name"`
	Color     string    `json:"color,omitempty"`
	ItemCount int64     `json:"item_count"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type fileTagRow struct {
	ID        uint64
	Name      string
	Color     string
	ItemCount int64
	CreatedAt time.Time
	UpdatedAt time.Time
}

type fileSavedSearchFiltersDTO struct {
	Kind         string `json:"kind,omitempty"`
	ModifiedFrom string `json:"modifiedFrom,omitempty"`
	ModifiedTo   string `json:"modifiedTo,omitempty"`
	MinSize      *int64 `json:"minSize,omitempty"`
	MaxSize      *int64 `json:"maxSize,omitempty"`
	SourceID     uint64 `json:"sourceID,omitempty"`
	TagID        uint64 `json:"tagID,omitempty"`
}

func (filters fileSavedSearchFiltersDTO) active() bool {
	return strings.TrimSpace(filters.Kind) != "" ||
		strings.TrimSpace(filters.ModifiedFrom) != "" ||
		strings.TrimSpace(filters.ModifiedTo) != "" ||
		filters.MinSize != nil ||
		filters.MaxSize != nil ||
		filters.SourceID != 0 ||
		filters.TagID != 0
}

type fileSavedSearchDTO struct {
	ID        uint64                    `json:"id"`
	Name      string                    `json:"name"`
	Query     string                    `json:"query"`
	Filters   fileSavedSearchFiltersDTO `json:"filters"`
	Position  int                       `json:"position"`
	CreatedAt time.Time                 `json:"created_at"`
	UpdatedAt time.Time                 `json:"updated_at"`
}

type fileTagNodesInput struct {
	NodeIDs []uint64 `json:"node_ids"`
}

type fileNodeTagsDTO struct {
	NodeID uint64       `json:"node_id"`
	Tags   []fileTagDTO `json:"tags"`
}

type fileSavedSearchInput struct {
	Name    string                    `json:"name"`
	Query   string                    `json:"query"`
	Filters fileSavedSearchFiltersDTO `json:"filters"`
}

func normalizeFileTagName(name string) (string, bool) {
	name = strings.TrimSpace(name)
	return name, name != "" && utf8.ValidString(name) && len([]byte(name)) <= 64
}

func normalizeFileTagColor(color string) (string, bool) {
	color = strings.TrimSpace(color)
	if color == "" {
		return "", true
	}
	if !fileTagColorPattern.MatchString(color) {
		return "", false
	}
	return strings.ToUpper(color), true
}

func normalizeSavedSearchName(name string) (string, bool) {
	name = strings.TrimSpace(name)
	return name, name != "" && utf8.ValidString(name) && len([]byte(name)) <= 128
}

func validateSavedSearchFilters(filters fileSavedSearchFiltersDTO) bool {
	switch strings.ToLower(strings.TrimSpace(filters.Kind)) {
	case "", "folder", "file", "image", "video", "audio", "pdf", "document",
		"spreadsheet", "presentation", "archive", "code", "text", "other":
	default:
		return false
	}
	parseTime := func(raw string) bool {
		if strings.TrimSpace(raw) == "" {
			return true
		}
		_, err := time.Parse(time.RFC3339, strings.TrimSpace(raw))
		return err == nil
	}
	if !parseTime(filters.ModifiedFrom) || !parseTime(filters.ModifiedTo) {
		return false
	}
	if filters.MinSize != nil && *filters.MinSize < 0 {
		return false
	}
	if filters.MaxSize != nil && *filters.MaxSize < 0 {
		return false
	}
	if filters.MinSize != nil && filters.MaxSize != nil && *filters.MinSize > *filters.MaxSize {
		return false
	}
	return true
}

func validateSavedSearchInput(input fileSavedSearchInput) (fileSavedSearchInput, bool) {
	var ok bool
	if input.Name, ok = normalizeSavedSearchName(input.Name); !ok {
		return fileSavedSearchInput{}, false
	}
	input.Query = strings.TrimSpace(input.Query)
	if !utf8.ValidString(input.Query) || len([]byte(input.Query)) > maxSearchQuerySize ||
		(input.Query != "" && utf8.RuneCountInString(input.Query) < 2) {
		return fileSavedSearchInput{}, false
	}
	input.Filters.Kind = strings.ToLower(strings.TrimSpace(input.Filters.Kind))
	input.Filters.ModifiedFrom = strings.TrimSpace(input.Filters.ModifiedFrom)
	input.Filters.ModifiedTo = strings.TrimSpace(input.Filters.ModifiedTo)
	if !validateSavedSearchFilters(input.Filters) || (input.Query == "" && !input.Filters.active()) {
		return fileSavedSearchInput{}, false
	}
	return input, true
}

func (s *Server) listFileTags(c *gin.Context) {
	const query = `
SELECT
  t.id, t.name, t.color, t.created_at, t.updated_at,
  COUNT(n.id) AS item_count
FROM xd_file_tags t
LEFT JOIN xd_file_node_tags nt
  ON nt.owner_id = t.owner_id AND nt.tag_id = t.id
LEFT JOIN xd_nodes n
  ON n.id = nt.node_id AND n.owner_id = t.owner_id AND n.deleted_at IS NULL
WHERE t.owner_id = ?
GROUP BY t.id, t.name, t.color, t.created_at, t.updated_at
ORDER BY lower(t.name) ASC, t.id ASC`
	var rows []fileTagRow
	if err := s.DB.WithContext(c.Request.Context()).Raw(query, userID(c)).Scan(&rows).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list file tags failed")
		return
	}
	out := make([]fileTagDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, fileTagDTO{
			ID: row.ID, Name: row.Name, Color: row.Color, ItemCount: row.ItemCount,
			CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
		})
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, out)
}

func (s *Server) createFileTag(c *gin.Context) {
	var input struct {
		Name  string `json:"name"`
		Color string `json:"color"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid file tag body")
		return
	}
	name, ok := normalizeFileTagName(input.Name)
	if !ok {
		fail(c, http.StatusBadRequest, "tag name is invalid")
		return
	}
	color, ok := normalizeFileTagColor(input.Color)
	if !ok {
		fail(c, http.StatusBadRequest, "tag color must be empty or #RRGGBB")
		return
	}
	var tag meta.FileTag
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&meta.FileTag{}).Where("owner_id = ?", userID(c)).Count(&count).Error; err != nil {
			return err
		}
		if count >= fileTagLimit {
			return errors.New("tag limit")
		}
		var duplicate int64
		if err := tx.Model(&meta.FileTag{}).
			Where("owner_id = ? AND lower(name) = lower(?)", userID(c), name).
			Count(&duplicate).Error; err != nil {
			return err
		}
		if duplicate != 0 {
			return errors.New("duplicate tag")
		}
		tag = meta.FileTag{OwnerID: userID(c), Name: name, Color: color}
		return tx.Create(&tag).Error
	})
	if err != nil {
		if err.Error() == "tag limit" {
			fail(c, http.StatusConflict, "file tag limit reached")
			return
		}
		if err.Error() == "duplicate tag" {
			fail(c, http.StatusConflict, "tag name already exists")
			return
		}
		fail(c, http.StatusInternalServerError, "create file tag failed")
		return
	}
	c.JSON(http.StatusCreated, fileTagDTO{
		ID: tag.ID, Name: tag.Name, Color: tag.Color, CreatedAt: tag.CreatedAt, UpdatedAt: tag.UpdatedAt,
	})
}

func (s *Server) updateFileTag(c *gin.Context) {
	tagID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid tag id")
		return
	}
	var input struct {
		Name  *string `json:"name"`
		Color *string `json:"color"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || (input.Name == nil && input.Color == nil) {
		fail(c, http.StatusBadRequest, "invalid file tag body")
		return
	}
	updates := map[string]any{}
	if input.Name != nil {
		name, valid := normalizeFileTagName(*input.Name)
		if !valid {
			fail(c, http.StatusBadRequest, "tag name is invalid")
			return
		}
		var duplicate int64
		if err := s.DB.WithContext(c.Request.Context()).Model(&meta.FileTag{}).
			Where("owner_id = ? AND id <> ? AND lower(name) = lower(?)", userID(c), tagID, name).
			Count(&duplicate).Error; err != nil {
			fail(c, http.StatusInternalServerError, "check file tag failed")
			return
		}
		if duplicate != 0 {
			fail(c, http.StatusConflict, "tag name already exists")
			return
		}
		updates["name"] = name
	}
	if input.Color != nil {
		color, valid := normalizeFileTagColor(*input.Color)
		if !valid {
			fail(c, http.StatusBadRequest, "tag color must be empty or #RRGGBB")
			return
		}
		updates["color"] = color
	}
	result := s.DB.WithContext(c.Request.Context()).Model(&meta.FileTag{}).
		Where("owner_id = ? AND id = ?", userID(c), tagID).
		Updates(updates)
	if result.Error != nil {
		fail(c, http.StatusInternalServerError, "update file tag failed")
		return
	}
	if result.RowsAffected == 0 {
		fail(c, http.StatusNotFound, "tag not found")
		return
	}
	var tag meta.FileTag
	if err := s.DB.WithContext(c.Request.Context()).
		Where("owner_id = ? AND id = ?", userID(c), tagID).First(&tag).Error; err != nil {
		fail(c, http.StatusInternalServerError, "load file tag failed")
		return
	}
	c.JSON(http.StatusOK, fileTagDTO{
		ID: tag.ID, Name: tag.Name, Color: tag.Color, CreatedAt: tag.CreatedAt, UpdatedAt: tag.UpdatedAt,
	})
}

func (s *Server) deleteFileTag(c *gin.Context) {
	tagID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid tag id")
		return
	}
	result := s.DB.WithContext(c.Request.Context()).
		Where("owner_id = ? AND id = ?", userID(c), tagID).
		Delete(&meta.FileTag{})
	if result.Error != nil {
		fail(c, http.StatusInternalServerError, "delete file tag failed")
		return
	}
	if result.RowsAffected == 0 {
		fail(c, http.StatusNotFound, "tag not found")
		return
	}
	c.Status(http.StatusNoContent)
}

func dedupeNodeIDs(ids []uint64) ([]uint64, bool) {
	if len(ids) == 0 || len(ids) > fileTagNodeBatchLimit {
		return nil, false
	}
	seen := make(map[uint64]struct{}, len(ids))
	out := make([]uint64, 0, len(ids))
	for _, id := range ids {
		if id == 0 {
			return nil, false
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out, len(out) > 0
}

func (s *Server) ownedActiveNodeIDs(c *gin.Context, ids []uint64) bool {
	var count int64
	if err := s.DB.WithContext(c.Request.Context()).Model(&meta.Node{}).
		Where("owner_id = ? AND deleted_at IS NULL AND id IN ?", userID(c), ids).
		Count(&count).Error; err != nil {
		fail(c, http.StatusInternalServerError, "validate tagged nodes failed")
		return false
	}
	if count != int64(len(ids)) {
		fail(c, http.StatusNotFound, "one or more nodes were not found")
		return false
	}
	return true
}

func (s *Server) queryFileNodeTags(c *gin.Context) {
	var input fileTagNodesInput
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid node tag query")
		return
	}
	nodeIDs, ok := dedupeNodeIDs(input.NodeIDs)
	if !ok {
		fail(c, http.StatusBadRequest, "node_ids must contain 1 to 500 node ids")
		return
	}
	if !s.ownedActiveNodeIDs(c, nodeIDs) {
		return
	}
	var rows []struct {
		NodeID    uint64
		ID        uint64
		Name      string
		Color     string
		CreatedAt time.Time
		UpdatedAt time.Time
	}
	if err := s.DB.WithContext(c.Request.Context()).Table("xd_file_node_tags nt").
		Select("nt.node_id, t.id, t.name, t.color, t.created_at, t.updated_at").
		Joins("JOIN xd_file_tags t ON t.id = nt.tag_id AND t.owner_id = nt.owner_id").
		Where("nt.owner_id = ? AND nt.node_id IN ?", userID(c), nodeIDs).
		Order("lower(t.name) ASC, t.id ASC").
		Scan(&rows).Error; err != nil {
		fail(c, http.StatusInternalServerError, "load node tags failed")
		return
	}
	byNode := make(map[uint64][]fileTagDTO, len(nodeIDs))
	for _, row := range rows {
		byNode[row.NodeID] = append(byNode[row.NodeID], fileTagDTO{
			ID: row.ID, Name: row.Name, Color: row.Color,
			CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
		})
	}
	out := make([]fileNodeTagsDTO, 0, len(nodeIDs))
	for _, id := range nodeIDs {
		out = append(out, fileNodeTagsDTO{NodeID: id, Tags: byNode[id]})
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, out)
}

func (s *Server) addFileTagNodes(c *gin.Context) {
	s.mutateFileTagNodes(c, true)
}

func (s *Server) removeFileTagNodes(c *gin.Context) {
	s.mutateFileTagNodes(c, false)
}

func (s *Server) mutateFileTagNodes(c *gin.Context, add bool) {
	tagID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid tag id")
		return
	}
	var tag meta.FileTag
	if err := s.DB.WithContext(c.Request.Context()).
		Where("owner_id = ? AND id = ?", userID(c), tagID).
		First(&tag).Error; err != nil {
		fail(c, http.StatusNotFound, "tag not found")
		return
	}
	var input fileTagNodesInput
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid node tag body")
		return
	}
	nodeIDs, valid := dedupeNodeIDs(input.NodeIDs)
	if !valid {
		fail(c, http.StatusBadRequest, "node_ids must contain 1 to 500 node ids")
		return
	}
	if !s.ownedActiveNodeIDs(c, nodeIDs) {
		return
	}
	if add {
		assignments := make([]meta.FileNodeTag, 0, len(nodeIDs))
		for _, id := range nodeIDs {
			assignments = append(assignments, meta.FileNodeTag{
				OwnerID: userID(c), NodeID: id, TagID: tagID,
			})
		}
		if err := s.DB.WithContext(c.Request.Context()).
			Clauses(clause.OnConflict{DoNothing: true}).
			Create(&assignments).Error; err != nil {
			fail(c, http.StatusInternalServerError, "assign file tag failed")
			return
		}
	} else if err := s.DB.WithContext(c.Request.Context()).
		Where("owner_id = ? AND tag_id = ? AND node_id IN ?", userID(c), tagID, nodeIDs).
		Delete(&meta.FileNodeTag{}).Error; err != nil {
		fail(c, http.StatusInternalServerError, "remove file tag failed")
		return
	}
	c.JSON(http.StatusOK, gin.H{"updated": len(nodeIDs)})
}

func savedSearchDTO(model meta.FileSavedSearch) (fileSavedSearchDTO, error) {
	var filters fileSavedSearchFiltersDTO
	if err := json.Unmarshal([]byte(model.FiltersJSON), &filters); err != nil {
		return fileSavedSearchDTO{}, err
	}
	return fileSavedSearchDTO{
		ID: model.ID, Name: model.Name, Query: model.Query, Filters: filters,
		Position: model.Position, CreatedAt: model.CreatedAt, UpdatedAt: model.UpdatedAt,
	}, nil
}

func (s *Server) listFileSavedSearches(c *gin.Context) {
	var models []meta.FileSavedSearch
	if err := s.DB.WithContext(c.Request.Context()).
		Where("owner_id = ?", userID(c)).
		Order("position ASC, created_at ASC, id ASC").
		Find(&models).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list saved searches failed")
		return
	}
	out := make([]fileSavedSearchDTO, 0, len(models))
	for _, model := range models {
		item, err := savedSearchDTO(model)
		if err != nil {
			fail(c, http.StatusInternalServerError, "decode saved search failed")
			return
		}
		out = append(out, item)
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, out)
}

func (s *Server) createFileSavedSearch(c *gin.Context) {
	var input fileSavedSearchInput
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid saved search body")
		return
	}
	var ok bool
	if input, ok = validateSavedSearchInput(input); !ok {
		fail(c, http.StatusBadRequest, "saved search is invalid")
		return
	}
	filtersJSON, _ := json.Marshal(input.Filters)
	var model meta.FileSavedSearch
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var count int64
		if err := tx.Model(&meta.FileSavedSearch{}).Where("owner_id = ?", userID(c)).Count(&count).Error; err != nil {
			return err
		}
		if count >= fileSavedSearchLimit {
			return errors.New("saved search limit")
		}
		var duplicate int64
		if err := tx.Model(&meta.FileSavedSearch{}).
			Where("owner_id = ? AND lower(name) = lower(?)", userID(c), input.Name).
			Count(&duplicate).Error; err != nil {
			return err
		}
		if duplicate != 0 {
			return errors.New("duplicate saved search")
		}
		var maxPosition int
		_ = tx.Model(&meta.FileSavedSearch{}).Where("owner_id = ?", userID(c)).
			Select("COALESCE(MAX(position), -1)").Scan(&maxPosition).Error
		model = meta.FileSavedSearch{
			OwnerID: userID(c), Name: input.Name, Query: input.Query,
			FiltersJSON: string(filtersJSON), Position: maxPosition + 1,
		}
		return tx.Create(&model).Error
	})
	if err != nil {
		if err.Error() == "saved search limit" {
			fail(c, http.StatusConflict, "saved search limit reached")
			return
		}
		if err.Error() == "duplicate saved search" {
			fail(c, http.StatusConflict, "saved search name already exists")
			return
		}
		fail(c, http.StatusInternalServerError, "create saved search failed")
		return
	}
	out, err := savedSearchDTO(model)
	if err != nil {
		fail(c, http.StatusInternalServerError, "decode saved search failed")
		return
	}
	c.JSON(http.StatusCreated, out)
}

func (s *Server) updateFileSavedSearch(c *gin.Context) {
	searchID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid saved search id")
		return
	}
	var input fileSavedSearchInput
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid saved search body")
		return
	}
	if input, ok = validateSavedSearchInput(input); !ok {
		fail(c, http.StatusBadRequest, "saved search is invalid")
		return
	}
	var duplicate int64
	if err := s.DB.WithContext(c.Request.Context()).Model(&meta.FileSavedSearch{}).
		Where("owner_id = ? AND id <> ? AND lower(name) = lower(?)", userID(c), searchID, input.Name).
		Count(&duplicate).Error; err != nil {
		fail(c, http.StatusInternalServerError, "check saved search failed")
		return
	}
	if duplicate != 0 {
		fail(c, http.StatusConflict, "saved search name already exists")
		return
	}
	filtersJSON, _ := json.Marshal(input.Filters)
	result := s.DB.WithContext(c.Request.Context()).Model(&meta.FileSavedSearch{}).
		Where("owner_id = ? AND id = ?", userID(c), searchID).
		Updates(map[string]any{
			"name": input.Name, "query": input.Query, "filters_json": string(filtersJSON),
		})
	if result.Error != nil {
		fail(c, http.StatusInternalServerError, "update saved search failed")
		return
	}
	if result.RowsAffected == 0 {
		fail(c, http.StatusNotFound, "saved search not found")
		return
	}
	var model meta.FileSavedSearch
	if err := s.DB.WithContext(c.Request.Context()).
		Where("owner_id = ? AND id = ?", userID(c), searchID).First(&model).Error; err != nil {
		fail(c, http.StatusInternalServerError, "load saved search failed")
		return
	}
	out, err := savedSearchDTO(model)
	if err != nil {
		fail(c, http.StatusInternalServerError, "decode saved search failed")
		return
	}
	c.JSON(http.StatusOK, out)
}

func (s *Server) deleteFileSavedSearch(c *gin.Context) {
	searchID, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid saved search id")
		return
	}
	result := s.DB.WithContext(c.Request.Context()).
		Where("owner_id = ? AND id = ?", userID(c), searchID).
		Delete(&meta.FileSavedSearch{})
	if result.Error != nil {
		fail(c, http.StatusInternalServerError, "delete saved search failed")
		return
	}
	if result.RowsAffected == 0 {
		fail(c, http.StatusNotFound, "saved search not found")
		return
	}
	c.Status(http.StatusNoContent)
}

func (s *Server) reorderFileSavedSearches(c *gin.Context) {
	var input struct {
		IDs []uint64 `json:"ids"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || len(input.IDs) > fileSavedSearchLimit {
		fail(c, http.StatusBadRequest, "invalid saved search order")
		return
	}
	var models []meta.FileSavedSearch
	if err := s.DB.WithContext(c.Request.Context()).Where("owner_id = ?", userID(c)).Find(&models).Error; err != nil {
		fail(c, http.StatusInternalServerError, "load saved searches failed")
		return
	}
	if len(input.IDs) != len(models) {
		fail(c, http.StatusConflict, "saved search order is stale")
		return
	}
	existing := make(map[uint64]struct{}, len(models))
	for _, model := range models {
		existing[model.ID] = struct{}{}
	}
	seen := make(map[uint64]struct{}, len(input.IDs))
	for _, id := range input.IDs {
		if _, ok := existing[id]; !ok {
			fail(c, http.StatusConflict, "saved search order is stale")
			return
		}
		if _, duplicate := seen[id]; duplicate {
			fail(c, http.StatusBadRequest, "saved search order contains duplicates")
			return
		}
		seen[id] = struct{}{}
	}
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		for position, id := range input.IDs {
			if err := tx.Model(&meta.FileSavedSearch{}).
				Where("owner_id = ? AND id = ?", userID(c), id).
				Update("position", position).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		fail(c, http.StatusInternalServerError, "reorder saved searches failed")
		return
	}
	c.Status(http.StatusNoContent)
}
