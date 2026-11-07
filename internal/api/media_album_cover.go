package api

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photoasset"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var errMediaAlbumCoverNotMember = errors.New("album cover must be a visible media in this album")

// setMediaAlbumCover accepts only a member of an owner-scoped manual album.
// A zero node ID deliberately restores the automatically selected cover.
func (s *Server) setMediaAlbumCover(c *gin.Context) {
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	key := strings.TrimSpace(c.Param("albumID"))
	if !strings.HasPrefix(key, "manual:") || len(key) <= len("manual:") {
		fail(c, http.StatusConflict, "only manual albums support custom covers")
		return
	}
	var input struct {
		NodeID     *uint64 `json:"node_id"`
		ContentKey *string `json:"content_key"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || (input.NodeID == nil) == (input.ContentKey == nil) || (input.ContentKey != nil && *input.ContentKey != "" && !photoasset.ValidContentKey(*input.ContentKey)) {
		fail(c, http.StatusBadRequest, "choose node_id or content_key (0 or empty restores automatic cover)")
		return
	}

	var currentRevision uint64
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var collection meta.PhotoCollection
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"owner_id = ? AND external_key = ? AND kind = ? AND state = ?",
				userID(c), key, meta.PhotoCollectionKindManual, meta.PhotoCollectionStateActive,
			).First(&collection).Error; err != nil {
			return err
		}
		currentRevision = collection.Revision
		if collection.Revision != expected {
			return errRevisionConflict
		}

		var nodeID *uint64
		contentKey := ""
		if (input.NodeID != nil && *input.NodeID != 0) || (input.ContentKey != nil && *input.ContentKey != "") {
			var nodes []uint64
			var keys []string
			if input.NodeID != nil {
				nodes = []uint64{*input.NodeID}
			} else {
				keys = []string{*input.ContentKey}
			}
			assets, err := mediaAssetsForSelection(c.Request.Context(), tx, userID(c), nodes, keys)
			if err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return errMediaAlbumCoverNotMember
				}
				return err
			}
			asset := assets[0]
			var count int64
			if err := tx.Model(&meta.PhotoCollectionAsset{}).Where("collection_id = ? AND asset_id = ?", collection.ID, asset.ID).Count(&count).Error; err != nil {
				return err
			}
			if count != 1 {
				return errMediaAlbumCoverNotMember
			}
			nodeID, contentKey = &asset.PrimaryNodeID, asset.ContentKey
		}
		sameNode := (nodeID == nil && collection.PreferredCoverNodeID == nil) || (nodeID != nil && collection.PreferredCoverNodeID != nil && *nodeID == *collection.PreferredCoverNodeID)
		if sameNode && contentKey == collection.PreferredCoverContentKey {
			return nil
		}

		result := tx.Model(&meta.PhotoCollection{}).
			Where("id = ? AND revision = ?", collection.ID, expected).
			Updates(map[string]any{
				"preferred_cover_node_id":     nodeID,
				"preferred_cover_content_key": contentKey,
				"revision":                    gorm.Expr("revision + 1"),
				"updated_at":                  time.Now().UTC(),
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errRevisionConflict
		}
		return nil
	})
	if err != nil {
		switch {
		case errors.Is(err, errRevisionConflict):
			revisionConflict(c, expected, currentRevision)
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "media album not found")
		case errors.Is(err, errMediaAlbumCoverNotMember):
			fail(c, http.StatusConflict, err.Error())
		default:
			fail(c, http.StatusInternalServerError, "set media album cover failed")
		}
		return
	}
	updated, err := s.mediaAlbumDTOByKey(c.Request.Context(), userID(c), key)
	if err != nil {
		fail(c, http.StatusInternalServerError, "load media album failed")
		return
	}
	c.Header("ETag", fmt.Sprintf("\"%d\"", updated.Revision))
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, updated)
}
