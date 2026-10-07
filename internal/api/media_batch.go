package api

import (
	"context"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const mediaBatchMaxItems = 1000

type mediaBatchFavoriteDTO struct {
	Updated  int  `json:"updated"`
	Favorite bool `json:"favorite"`
}

type mediaBatchTagsDTO struct {
	Updated int      `json:"updated"`
	Tags    []string `json:"tags"`
}

func normalizeMediaBatchNodeIDs(values []uint64) ([]uint64, error) {
	if len(values) == 0 {
		return nil, fmt.Errorf("node_ids are required")
	}
	if len(values) > mediaBatchMaxItems {
		return nil, fmt.Errorf("node_ids must contain at most %d items", mediaBatchMaxItems)
	}
	out := make([]uint64, 0, len(values))
	seen := make(map[uint64]struct{}, len(values))
	for _, value := range values {
		if value == 0 {
			return nil, fmt.Errorf("node_ids must contain valid ids")
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out, nil
}

func (s *Server) mediaBatchAssets(
	ctx context.Context,
	uid uint64,
	nodeIDs []uint64,
) ([]meta.PhotoAsset, error) {
	var assets []meta.PhotoAsset
	if err := s.DB.WithContext(ctx).
		Table("xd_photo_assets AS pa").
		Select("pa.*").
		Joins("JOIN xd_nodes AS n ON n.id = pa.primary_node_id AND n.deleted_at IS NULL").
		Where("pa.owner_id = ? AND pa.primary_node_id IN ?", uid, nodeIDs).
		Find(&assets).Error; err != nil {
		return nil, err
	}
	if len(assets) != len(nodeIDs) {
		return nil, gorm.ErrRecordNotFound
	}
	return assets, nil
}

func photoAssetIDs(assets []meta.PhotoAsset) []uint64 {
	ids := make([]uint64, 0, len(assets))
	for _, asset := range assets {
		ids = append(ids, asset.ID)
	}
	return ids
}

func (s *Server) setMediaFavoriteBatch(c *gin.Context) {
	var input struct {
		NodeIDs  []uint64 `json:"node_ids"`
		Favorite *bool    `json:"favorite"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || input.Favorite == nil {
		fail(c, http.StatusBadRequest, "node_ids and favorite are required")
		return
	}
	nodeIDs, err := normalizeMediaBatchNodeIDs(input.NodeIDs)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	assets, err := s.mediaBatchAssets(c.Request.Context(), userID(c), nodeIDs)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			fail(c, http.StatusNotFound, "one or more media items were not found")
		} else {
			fail(c, http.StatusInternalServerError, "resolve media items failed")
		}
		return
	}
	result := s.DB.WithContext(c.Request.Context()).
		Model(&meta.PhotoMetadata{}).
		Where("asset_id IN ?", photoAssetIDs(assets)).
		Update("favorite", *input.Favorite)
	if result.Error != nil {
		fail(c, http.StatusInternalServerError, "update favorites failed")
		return
	}
	if result.RowsAffected != int64(len(assets)) {
		fail(c, http.StatusInternalServerError, "photo metadata not found")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, mediaBatchFavoriteDTO{
		Updated:  len(assets),
		Favorite: *input.Favorite,
	})
}

func (s *Server) addMediaTagsBatch(c *gin.Context) {
	var input struct {
		NodeIDs []uint64 `json:"node_ids"`
		Tags    []string `json:"tags"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || input.Tags == nil {
		fail(c, http.StatusBadRequest, "node_ids and tags are required")
		return
	}
	nodeIDs, err := normalizeMediaBatchNodeIDs(input.NodeIDs)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	tags, err := normalizeMediaTags(input.Tags)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	if len(tags) == 0 {
		fail(c, http.StatusBadRequest, "at least one tag is required")
		return
	}
	assets, err := s.mediaBatchAssets(c.Request.Context(), userID(c), nodeIDs)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			fail(c, http.StatusNotFound, "one or more media items were not found")
		} else {
			fail(c, http.StatusInternalServerError, "resolve media items failed")
		}
		return
	}
	assetIDs := photoAssetIDs(assets)
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var rows []meta.PhotoMetadata
		if err := tx.Where("asset_id IN ?", assetIDs).Find(&rows).Error; err != nil {
			return err
		}
		if len(rows) != len(assetIDs) {
			return gorm.ErrRecordNotFound
		}
		for _, row := range rows {
			existing, err := decodeMediaTags(row.TagsJSON)
			if err != nil {
				return err
			}
			encoded, err := encodeMediaTags(append(existing, tags...))
			if err != nil {
				return err
			}
			if err := tx.Model(&meta.PhotoMetadata{}).
				Where("asset_id = ?", row.AssetID).
				Update("tags_json", encoded).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		fail(c, http.StatusInternalServerError, "update media tags failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, mediaBatchTagsDTO{
		Updated: len(assets),
		Tags:    tags,
	})
}
