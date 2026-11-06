package api

import (
	"context"
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photoasset"
	"gorm.io/gorm"
)

func normalizeMediaContentSelection(nodeIDs []uint64, keys []string, limit int) ([]uint64, []string, error) {
	if len(nodeIDs) > 0 && len(keys) > 0 {
		return nil, nil, fmt.Errorf("choose content_keys or node_ids, not both")
	}
	if len(nodeIDs)+len(keys) == 0 || len(nodeIDs)+len(keys) > limit {
		return nil, nil, fmt.Errorf("select between 1 and %d photos", limit)
	}
	if len(keys) == 0 {
		ids, err := normalizeMediaBatchNodeIDs(nodeIDs)
		return ids, nil, err
	}
	seen := make(map[string]bool)
	out := make([]string, 0, len(keys))
	for _, key := range keys {
		if !photoasset.ValidContentKey(key) {
			return nil, nil, fmt.Errorf("invalid photo content key")
		}
		if !seen[key] {
			seen[key] = true
			out = append(out, key)
		}
	}
	return nil, out, nil
}

func mediaAssetsForSelection(ctx context.Context, db *gorm.DB, ownerID uint64, nodeIDs []uint64, keys []string) ([]meta.PhotoAsset, error) {
	var assets []meta.PhotoAsset
	base := db.WithContext(ctx).Table("xd_photo_assets AS pa").Select("pa.*").
		Joins("JOIN xd_nodes n ON n.id = pa.primary_node_id AND n.owner_id = pa.owner_id AND n.deleted_at IS NULL").
		Where("pa.owner_id = ?", ownerID).Where(photoasset.CurrentContentBindingSQL("pa"))
	if len(keys) != 0 {
		if len(nodeIDs) != 0 {
			return nil, fmt.Errorf("ambiguous media selection")
		}
		if err := base.Where("pa.content_key IN ?", keys).Find(&assets).Error; err != nil {
			return nil, err
		}
		if len(assets) != len(keys) {
			return nil, gorm.ErrRecordNotFound
		}
		return assets, nil
	}
	if len(nodeIDs) == 0 {
		return nil, gorm.ErrRecordNotFound
	}
	direct := db.WithContext(ctx).Table("xd_photo_assets").Select("id").Where("owner_id = ? AND primary_node_id IN ?", ownerID, nodeIDs)
	occurrences := db.WithContext(ctx).Table("xd_photo_asset_occurrences AS po").Select("po.asset_id").
		Where("po.owner_id = ? AND po.primary_node_id IN ?", ownerID, nodeIDs).Where(photoasset.CurrentOccurrenceBindingSQL("po"))
	if err := base.Where("pa.id IN (?) OR pa.id IN (?)", direct, occurrences).Find(&assets).Error; err != nil {
		return nil, err
	}
	covered := make(map[uint64]bool)
	for _, asset := range assets {
		covered[asset.PrimaryNodeID] = true
	}
	if len(assets) != 0 {
		var aliases []uint64
		if err := db.WithContext(ctx).Table("xd_photo_asset_occurrences AS po").Where("po.owner_id = ? AND po.asset_id IN ? AND po.primary_node_id IN ?", ownerID, photoAssetIDs(assets), nodeIDs).
			Where(photoasset.CurrentOccurrenceBindingSQL("po")).Pluck("po.primary_node_id", &aliases).Error; err != nil {
			return nil, err
		}
		for _, id := range aliases {
			covered[id] = true
		}
	}
	for _, id := range nodeIDs {
		if !covered[id] {
			return nil, gorm.ErrRecordNotFound
		}
	}
	return assets, nil
}

// A hash is a selector, never an authorization credential or public CAS URL.
func (s *Server) currentMediaContent(c *gin.Context) (meta.PhotoAsset, bool) {
	var asset meta.PhotoAsset
	key := c.Param("contentKey")
	if !photoasset.ValidContentKey(key) {
		fail(c, http.StatusBadRequest, "invalid photo content key")
		return asset, false
	}
	if err := s.refreshMediaIndexForGalleryRead(c.Request.Context(), userID(c), mediaRequestIndexBatch); err != nil {
		fail(c, http.StatusInternalServerError, "refresh media projection failed")
		return asset, false
	}
	err := s.DB.WithContext(c.Request.Context()).Table("xd_photo_assets AS pa").Select("pa.*").
		Joins("JOIN xd_nodes AS cn ON cn.id = pa.primary_node_id AND cn.owner_id = pa.owner_id AND cn.deleted_at IS NULL").
		Where("pa.owner_id = ? AND pa.content_key = ?", userID(c), key).
		Where(photoasset.CurrentContentBindingSQL("pa")).Take(&asset).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			fail(c, http.StatusNotFound, "photo content not found")
		} else {
			fail(c, http.StatusInternalServerError, "read photo content failed")
		}
		return asset, false
	}
	return asset, true
}

// Reuse existing media handlers and scoped signed media delivery. In particular,
// do not create a second original writer or serve a global blob by bare hash.
func (s *Server) withMediaContent(handler gin.HandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		asset, ok := s.currentMediaContent(c)
		if !ok {
			return
		}
		c.Params = append(c.Params, gin.Param{Key: "id", Value: strconv.FormatUint(asset.PrimaryNodeID, 10)})
		handler(c)
	}
}

func mediaAssetForNode(ctx context.Context, db *gorm.DB, ownerID, nodeID uint64, expectedContent string) (meta.PhotoAsset, error) {
	var asset meta.PhotoAsset
	query := db.WithContext(ctx).Table("xd_photo_assets AS pa").Select("pa.*").
		Where("pa.owner_id = ?", ownerID).
		Where(`pa.primary_node_id = ? OR EXISTS (SELECT 1 FROM xd_photo_asset_occurrences po WHERE po.asset_id = pa.id AND po.owner_id = pa.owner_id AND po.primary_node_id = ? AND `+photoasset.CurrentOccurrenceBindingSQL("po")+`)`, nodeID, nodeID).
		Where(photoasset.CurrentContentBindingSQL("pa"))
	if expectedContent != "" {
		query = query.Where("pa.content_key = ?", expectedContent)
	}
	err := query.Take(&asset).Error
	return asset, err
}

type mediaContentSourcesDTO struct {
	ContentKey string    `json:"content_key"`
	Items      []nodeDTO `json:"items"`
	NextCursor *uint64   `json:"next_cursor,omitempty"`
}

func (s *Server) listMediaContentSources(c *gin.Context) {
	asset, ok := s.currentMediaContent(c)
	if !ok {
		return
	}
	var after uint64
	if raw := c.Query("cursor"); raw != "" {
		value, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			fail(c, http.StatusBadRequest, "invalid source cursor")
			return
		}
		after = value
	}
	const pageSize = 50
	var nodes []meta.Node
	query := s.DB.WithContext(c.Request.Context()).Table("xd_nodes AS n").Select("n.*").
		Joins("JOIN xd_photo_asset_occurrences po ON po.primary_node_id = n.id AND po.owner_id = n.owner_id").
		Where("po.asset_id = ? AND po.owner_id = ? AND po.primary_node_id > ?", asset.ID, userID(c), after).
		Where(photoasset.CurrentOccurrenceBindingSQL("po")).Order("po.primary_node_id ASC").Limit(pageSize + 1)
	if err := query.Find(&nodes).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list photo sources failed")
		return
	}
	out := mediaContentSourcesDTO{ContentKey: asset.ContentKey, Items: make([]nodeDTO, 0, min(len(nodes), pageSize))}
	if len(nodes) > pageSize {
		cursor := nodes[pageSize-1].ID
		out.NextCursor = &cursor
		nodes = nodes[:pageSize]
	}
	for _, node := range nodes {
		out.Items = append(out.Items, toNodeDTO(node))
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, out)
}
