package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	mediaAlbumMaxNameRunes  = 200
	mediaAlbumMaxBatchItems = 500
)

func normalizeMediaAlbumName(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", fmt.Errorf("album name is required")
	}
	if !utf8.ValidString(value) || len([]rune(value)) > mediaAlbumMaxNameRunes {
		return "", fmt.Errorf("album name is invalid")
	}
	for _, r := range value {
		if r == 0 || unicode.IsControl(r) {
			return "", fmt.Errorf("album name is invalid")
		}
	}
	return value, nil
}

func mediaAlbumKindForDTO(kind string) string {
	if kind == meta.PhotoCollectionKindSource {
		return "imported"
	}
	return kind
}

func (s *Server) mediaAlbumDTOByKey(
	ctx context.Context,
	ownerID uint64,
	key string,
) (mediaAlbumDTO, error) {
	thumbnailMIMEs := []string{
		"image/jpeg",
		"image/png",
		"image/gif",
		"image/webp",
		"image/avif",
		"image/tiff",
		"image/bmp",
		"image/heic",
		"image/heif",
		"image/x-adobe-dng",
	}
	type row struct {
		AlbumFolderID uint64
		ExternalKey   string
		Kind          string
		Name          string
		Revision      uint64
		QueryJSON     string
		ItemCount     int64
		CoverNodeID   *uint64
		UpdatedAt     *time.Time
	}
	var result row
	err := s.DB.WithContext(ctx).
		Table("xd_photo_collections AS pc").
		Select(
			"pc.album_folder_id, pc.external_key, pc.kind, pc.name, pc.revision, pc.query_json, "+
				"COUNT(DISTINCT album_n.id) AS item_count, "+
				"COALESCE(MAX(CASE WHEN album_n.id = pc.preferred_cover_node_id AND mm.media_kind IN ? THEN album_n.id END), MIN(CASE WHEN album_n.id IS NOT NULL AND lower(mm.mime_type) IN ? THEN pa.primary_node_id END)) AS cover_node_id, "+
				"MAX(CASE WHEN album_n.id IS NOT NULL THEN COALESCE(pm.captured_at, pc.updated_at) ELSE pc.updated_at END) AS updated_at",
			[]string{meta.MediaKindImage, meta.MediaKindVideo},
			thumbnailMIMEs,
		).
		Joins("LEFT JOIN xd_photo_collection_assets AS pca ON pca.collection_id = pc.id").
		Joins("LEFT JOIN xd_photo_assets AS pa ON pa.id = pca.asset_id AND pa.owner_id = pc.owner_id").
		Joins("LEFT JOIN xd_nodes AS album_n ON album_n.id = pa.primary_node_id AND album_n.owner_id = pc.owner_id AND album_n.deleted_at IS NULL").
		Joins("LEFT JOIN xd_photo_metadata AS pm ON pm.asset_id = pa.id").
		Joins("LEFT JOIN xd_media_metadata AS mm ON mm.node_id = pa.primary_node_id").
		Where(
			"pc.owner_id = ? AND pc.external_key = ? AND pc.state = ?",
			ownerID,
			key,
			meta.PhotoCollectionStateActive,
		).
		Group("pc.id, pc.album_folder_id, pc.external_key, pc.kind, pc.name, pc.revision, pc.query_json").
		Scan(&result).Error
	if err != nil {
		return mediaAlbumDTO{}, err
	}
	if result.ExternalKey == "" {
		return mediaAlbumDTO{}, gorm.ErrRecordNotFound
	}
	if result.Kind == meta.PhotoCollectionKindSmart {
		query, err := decodeMediaSmartAlbumQuery(result.QueryJSON)
		if err != nil {
			return mediaAlbumDTO{}, err
		}
		count, coverNodeID, err := s.smartMediaAlbumStats(ctx, ownerID, query)
		if err != nil {
			return mediaAlbumDTO{}, err
		}
		return mediaAlbumDTO{
			ID:            result.ExternalKey,
			AlbumFolderID: result.AlbumFolderID,
			Kind:          result.Kind,
			Name:          result.Name,
			Revision:      result.Revision,
			ItemCount:     count,
			CoverNodeID:   coverNodeID,
			UpdatedAt:     result.UpdatedAt,
			Query:         &query,
		}, nil
	}
	return mediaAlbumDTO{
		ID:            result.ExternalKey,
		AlbumFolderID: result.AlbumFolderID,
		Kind:          mediaAlbumKindForDTO(result.Kind),
		Name:          result.Name,
		Revision:      result.Revision,
		ItemCount:     result.ItemCount,
		CoverNodeID:   result.CoverNodeID,
		UpdatedAt:     result.UpdatedAt,
	}, nil
}

func (s *Server) createMediaAlbum(c *gin.Context) {
	var input struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	name, err := normalizeMediaAlbumName(input.Name)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	now := time.Now().UTC()
	collection := meta.PhotoCollection{
		OwnerID:     userID(c),
		ExternalKey: "manual:" + uuid.NewString(),
		Kind:        meta.PhotoCollectionKindManual,
		Name:        name,
		State:       meta.PhotoCollectionStateActive,
		Revision:    1,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := s.DB.WithContext(c.Request.Context()).Create(&collection).Error; err != nil {
		fail(c, http.StatusInternalServerError, "create media album failed")
		return
	}
	album, err := s.mediaAlbumDTOByKey(
		c.Request.Context(),
		collection.OwnerID,
		collection.ExternalKey,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "load media album failed")
		return
	}
	c.Header("ETag", fmt.Sprintf("\"%d\"", album.Revision))
	c.JSON(http.StatusCreated, album)
}

func (s *Server) renameMediaAlbum(c *gin.Context) {
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	key := strings.TrimSpace(c.Param("albumID"))
	if !strings.HasPrefix(key, "manual:") {
		fail(c, http.StatusConflict, "only manual albums can be renamed")
		return
	}
	var input struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	name, err := normalizeMediaAlbumName(input.Name)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}

	var currentRevision uint64
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var collection meta.PhotoCollection
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"owner_id = ? AND external_key = ? AND kind = ? AND state = ?",
				userID(c),
				key,
				meta.PhotoCollectionKindManual,
				meta.PhotoCollectionStateActive,
			).
			First(&collection).Error; err != nil {
			return err
		}
		currentRevision = collection.Revision
		if collection.Revision != expected {
			return errRevisionConflict
		}
		if collection.Name == name {
			return nil
		}
		return tx.Model(&meta.PhotoCollection{}).
			Where("id = ? AND revision = ?", collection.ID, expected).
			Updates(map[string]any{
				"name":       name,
				"revision":   gorm.Expr("revision + 1"),
				"updated_at": time.Now().UTC(),
			}).Error
	})
	if err != nil {
		if err == errRevisionConflict {
			revisionConflict(c, expected, currentRevision)
			return
		}
		if err == gorm.ErrRecordNotFound {
			fail(c, http.StatusNotFound, "media album not found")
			return
		}
		fail(c, http.StatusInternalServerError, "rename media album failed")
		return
	}
	album, err := s.mediaAlbumDTOByKey(c.Request.Context(), userID(c), key)
	if err != nil {
		fail(c, http.StatusInternalServerError, "load media album failed")
		return
	}
	c.Header("ETag", fmt.Sprintf("\"%d\"", album.Revision))
	c.JSON(http.StatusOK, album)
}

func (s *Server) deleteMediaAlbum(c *gin.Context) {
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	key := strings.TrimSpace(c.Param("albumID"))
	if !strings.HasPrefix(key, "manual:") {
		fail(c, http.StatusConflict, "only manual albums can be deleted")
		return
	}
	var currentRevision uint64
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var collection meta.PhotoCollection
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"owner_id = ? AND external_key = ? AND kind = ?",
				userID(c),
				key,
				meta.PhotoCollectionKindManual,
			).
			First(&collection).Error; err != nil {
			return err
		}
		currentRevision = collection.Revision
		if collection.Revision != expected {
			return errRevisionConflict
		}
		return tx.Delete(&collection).Error
	})
	if err != nil {
		if err == errRevisionConflict {
			revisionConflict(c, expected, currentRevision)
			return
		}
		if err == gorm.ErrRecordNotFound {
			fail(c, http.StatusNotFound, "media album not found")
			return
		}
		fail(c, http.StatusInternalServerError, "delete media album failed")
		return
	}
	c.Status(http.StatusNoContent)
}

func normalizeMediaAlbumNodeIDs(values []uint64) ([]uint64, error) {
	if len(values) == 0 || len(values) > mediaAlbumMaxBatchItems {
		return nil, fmt.Errorf("node_ids must contain between 1 and %d items", mediaAlbumMaxBatchItems)
	}
	seen := make(map[uint64]struct{}, len(values))
	out := make([]uint64, 0, len(values))
	for _, value := range values {
		if value == 0 {
			return nil, fmt.Errorf("node_ids contains an invalid id")
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out, nil
}

func (s *Server) addMediaAlbumItems(c *gin.Context) {
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	key := strings.TrimSpace(c.Param("albumID"))
	if !strings.HasPrefix(key, "manual:") {
		fail(c, http.StatusConflict, "only manual albums can be modified")
		return
	}
	var input struct {
		NodeIDs []uint64 `json:"node_ids"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	nodeIDs, err := normalizeMediaAlbumNodeIDs(input.NodeIDs)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.refreshMediaIndexForOwner(
		c.Request.Context(),
		userID(c),
		mediaRequestIndexBatch,
	); err != nil {
		fail(c, http.StatusInternalServerError, "refresh media projection failed")
		return
	}

	var currentRevision uint64
	err = s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var collection meta.PhotoCollection
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"owner_id = ? AND external_key = ? AND kind = ? AND state = ?",
				userID(c),
				key,
				meta.PhotoCollectionKindManual,
				meta.PhotoCollectionStateActive,
			).
			First(&collection).Error; err != nil {
			return err
		}
		currentRevision = collection.Revision
		if collection.Revision != expected {
			return errRevisionConflict
		}

		var assets []meta.PhotoAsset
		if err := tx.Where(
			"owner_id = ? AND primary_node_id IN ?",
			userID(c),
			nodeIDs,
		).Find(&assets).Error; err != nil {
			return err
		}
		if len(assets) != len(nodeIDs) {
			return fmt.Errorf("one or more media nodes are not logical Gallery assets")
		}
		assetIDs := make([]uint64, 0, len(assets))
		for _, asset := range assets {
			assetIDs = append(assetIDs, asset.ID)
		}
		var existing []meta.PhotoCollectionAsset
		if err := tx.Where(
			"collection_id = ? AND asset_id IN ?",
			collection.ID,
			assetIDs,
		).Find(&existing).Error; err != nil {
			return err
		}
		existingSet := make(map[uint64]struct{}, len(existing))
		for _, row := range existing {
			existingSet[row.AssetID] = struct{}{}
		}
		var maxPosition int64
		if err := tx.Model(&meta.PhotoCollectionAsset{}).
			Where("collection_id = ?", collection.ID).
			Select("COALESCE(MAX(position), -1)").
			Scan(&maxPosition).Error; err != nil {
			return err
		}
		rows := make([]meta.PhotoCollectionAsset, 0, len(assetIDs))
		now := time.Now().UTC()
		for _, assetID := range assetIDs {
			if _, exists := existingSet[assetID]; exists {
				continue
			}
			maxPosition++
			rows = append(rows, meta.PhotoCollectionAsset{
				CollectionID: collection.ID,
				AssetID:      assetID,
				Position:     maxPosition,
				CreatedAt:    now,
				UpdatedAt:    now,
			})
		}
		if len(rows) == 0 {
			return nil
		}
		if err := tx.Create(&rows).Error; err != nil {
			return err
		}
		return tx.Model(&meta.PhotoCollection{}).
			Where("id = ? AND revision = ?", collection.ID, expected).
			Updates(map[string]any{
				"revision":   gorm.Expr("revision + 1"),
				"updated_at": now,
			}).Error
	})
	if err != nil {
		if err == errRevisionConflict {
			revisionConflict(c, expected, currentRevision)
			return
		}
		if err == gorm.ErrRecordNotFound {
			fail(c, http.StatusNotFound, "media album not found")
			return
		}
		if strings.Contains(err.Error(), "not logical Gallery assets") {
			fail(c, http.StatusBadRequest, err.Error())
			return
		}
		fail(c, http.StatusInternalServerError, "add media album items failed")
		return
	}
	album, err := s.mediaAlbumDTOByKey(c.Request.Context(), userID(c), key)
	if err != nil {
		fail(c, http.StatusInternalServerError, "load media album failed")
		return
	}
	c.Header("ETag", fmt.Sprintf("\"%d\"", album.Revision))
	c.JSON(http.StatusOK, album)
}

func (s *Server) removeMediaAlbumItem(c *gin.Context) {
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	key := strings.TrimSpace(c.Param("albumID"))
	if !strings.HasPrefix(key, "manual:") {
		fail(c, http.StatusConflict, "only manual albums can be modified")
		return
	}
	nodeID, ok := parseID(c.Param("nodeID"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid media node id")
		return
	}

	var currentRevision uint64
	err := s.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		var collection meta.PhotoCollection
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"owner_id = ? AND external_key = ? AND kind = ? AND state = ?",
				userID(c),
				key,
				meta.PhotoCollectionKindManual,
				meta.PhotoCollectionStateActive,
			).
			First(&collection).Error; err != nil {
			return err
		}
		currentRevision = collection.Revision
		if collection.Revision != expected {
			return errRevisionConflict
		}
		var asset meta.PhotoAsset
		if err := tx.Where(
			"owner_id = ? AND primary_node_id = ?",
			userID(c),
			nodeID,
		).First(&asset).Error; err != nil {
			return err
		}
		result := tx.Where(
			"collection_id = ? AND asset_id = ?",
			collection.ID,
			asset.ID,
		).Delete(&meta.PhotoCollectionAsset{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}
		return tx.Model(&meta.PhotoCollection{}).
			Where("id = ? AND revision = ?", collection.ID, expected).
			Updates(map[string]any{
				"revision":   gorm.Expr("revision + 1"),
				"updated_at": time.Now().UTC(),
			}).Error
	})
	if err != nil {
		if err == errRevisionConflict {
			revisionConflict(c, expected, currentRevision)
			return
		}
		if err == gorm.ErrRecordNotFound {
			fail(c, http.StatusNotFound, "media album or item not found")
			return
		}
		fail(c, http.StatusInternalServerError, "remove media album item failed")
		return
	}
	album, err := s.mediaAlbumDTOByKey(c.Request.Context(), userID(c), key)
	if err != nil {
		fail(c, http.StatusInternalServerError, "load media album failed")
		return
	}
	c.Header("ETag", fmt.Sprintf("\"%d\"", album.Revision))
	c.JSON(http.StatusOK, album)
}
