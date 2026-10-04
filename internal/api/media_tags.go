package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/mediagroup"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photoasset"
)

const (
	mediaTagMaxCount = 32
	mediaTagMaxRunes = 64
)

type mediaTagsDTO struct {
	Tags []string `json:"tags"`
}

func normalizeMediaTag(value string) (string, error) {
	value = strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	if value == "" {
		return "", fmt.Errorf("tag must not be empty")
	}
	if !utf8.ValidString(value) || len([]rune(value)) > mediaTagMaxRunes {
		return "", fmt.Errorf("tag must be at most %d characters", mediaTagMaxRunes)
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return "", fmt.Errorf("tag contains control characters")
		}
	}
	return value, nil
}

func normalizeMediaTags(values []string) ([]string, error) {
	if len(values) > mediaTagMaxCount {
		return nil, fmt.Errorf("tags must contain at most %d items", mediaTagMaxCount)
	}
	out := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		normalized, err := normalizeMediaTag(value)
		if err != nil {
			return nil, err
		}
		key := strings.ToLower(normalized)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, normalized)
	}
	sort.Slice(out, func(i, j int) bool {
		left := strings.ToLower(out[i])
		right := strings.ToLower(out[j])
		if left != right {
			return left < right
		}
		return out[i] < out[j]
	})
	return out, nil
}

func encodeMediaTags(tags []string) (string, error) {
	normalized, err := normalizeMediaTags(tags)
	if err != nil {
		return "", err
	}
	if len(normalized) == 0 {
		return "", nil
	}
	data, err := json.Marshal(normalized)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func decodeMediaTags(raw string) ([]string, error) {
	if strings.TrimSpace(raw) == "" {
		return []string{}, nil
	}
	var tags []string
	if err := json.Unmarshal([]byte(raw), &tags); err != nil {
		return nil, fmt.Errorf("invalid stored media tags: %w", err)
	}
	return normalizeMediaTags(tags)
}

func (s *Server) setMediaTags(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid media id")
		return
	}
	var input struct {
		Tags *[]string `json:"tags"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || input.Tags == nil {
		fail(c, http.StatusBadRequest, "tags are required")
		return
	}
	encoded, err := encodeMediaTags(*input.Tags)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	normalized, _ := decodeMediaTags(encoded)

	node, err := s.ownedNode(userID(c), id, true)
	if err != nil || node.Type != meta.NodeTypeFile || node.File == nil {
		fail(c, http.StatusNotFound, "file not found")
		return
	}
	metadata, err := s.ensureMediaMetadata(c.Request.Context(), node)
	if err != nil {
		fail(c, http.StatusInternalServerError, "media indexing failed")
		return
	}
	if metadata.MediaKind == meta.MediaKindOther {
		fail(c, http.StatusNotFound, "file is not indexed media")
		return
	}
	if err := mediagroup.ReconcileLocalEvidenceGroups(
		c.Request.Context(),
		s.DB,
		node.OwnerID,
	); err != nil {
		fail(c, http.StatusInternalServerError, "resolve media relations failed")
		return
	}
	if _, err := photoasset.ReconcileOwner(
		c.Request.Context(),
		s.DB,
		node.OwnerID,
	); err != nil {
		fail(c, http.StatusInternalServerError, "resolve photo asset failed")
		return
	}

	var asset meta.PhotoAsset
	if err := s.DB.WithContext(c.Request.Context()).
		Where("owner_id = ? AND primary_node_id = ?", node.OwnerID, node.ID).
		First(&asset).Error; err != nil {
		fail(c, http.StatusNotFound, "photo asset not found")
		return
	}
	result := s.DB.WithContext(c.Request.Context()).
		Model(&meta.PhotoMetadata{}).
		Where("asset_id = ?", asset.ID).
		Update("tags_json", encoded)
	if result.Error != nil {
		fail(c, http.StatusInternalServerError, "update tags failed")
		return
	}
	if result.RowsAffected != 1 {
		fail(c, http.StatusInternalServerError, "photo metadata not found")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, mediaTagsDTO{Tags: normalized})
}
