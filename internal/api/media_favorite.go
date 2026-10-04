package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/mediagroup"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photoasset"
)

type mediaFavoriteDTO struct {
	Favorite bool `json:"favorite"`
}

func (s *Server) setMediaFavorite(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid media id")
		return
	}

	var input struct {
		Favorite *bool `json:"favorite"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || input.Favorite == nil {
		fail(c, http.StatusBadRequest, "favorite is required")
		return
	}

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
		Update("favorite", *input.Favorite)
	if result.Error != nil {
		fail(c, http.StatusInternalServerError, "update favorite failed")
		return
	}
	if result.RowsAffected != 1 {
		fail(c, http.StatusInternalServerError, "photo metadata not found")
		return
	}

	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, mediaFavoriteDTO{Favorite: *input.Favorite})
}
