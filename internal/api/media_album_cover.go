package api

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
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
		NodeID *uint64 `json:"node_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || input.NodeID == nil {
		fail(c, http.StatusBadRequest, "node_id is required (0 restores automatic cover)")
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
		if *input.NodeID != 0 {
			var count int64
			err := tx.Table("xd_photo_collection_assets AS pca").
				Joins("JOIN xd_photo_assets AS pa ON pa.id = pca.asset_id AND pa.owner_id = ?", userID(c)).
				Joins("JOIN xd_nodes AS n ON n.id = pa.primary_node_id AND n.owner_id = ? AND n.deleted_at IS NULL", userID(c)).
				Joins("JOIN xd_media_metadata AS mm ON mm.node_id = pa.primary_node_id").
				Where(
					"pca.collection_id = ? AND pa.primary_node_id = ? AND mm.media_kind IN ?",
					collection.ID, *input.NodeID, []string{meta.MediaKindImage, meta.MediaKindVideo},
				).
				Count(&count).Error
			if err != nil {
				return err
			}
			if count == 0 {
				return errMediaAlbumCoverNotMember
			}
			nodeID = input.NodeID
		}
		if (nodeID == nil && collection.PreferredCoverNodeID == nil) ||
			(nodeID != nil && collection.PreferredCoverNodeID != nil && *nodeID == *collection.PreferredCoverNodeID) {
			return nil
		}
		result := tx.Model(&meta.PhotoCollection{}).
			Where("id = ? AND revision = ?", collection.ID, expected).
			Updates(map[string]any{
				"preferred_cover_node_id": nodeID,
				"revision":                gorm.Expr("revision + 1"),
				"updated_at":              time.Now().UTC(),
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
