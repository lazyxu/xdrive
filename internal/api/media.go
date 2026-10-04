package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/mediagroup"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photoasset"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	mediaIndexBatchSize       = 64
	mediaRequestIndexBatch    = 16
	mediaThumbnailEdge        = 512
	mediaIndexerIdleInterval  = 30 * time.Second
	mediaIndexerBusyInterval  = 100 * time.Millisecond
	mediaIndexerErrorInterval = time.Minute
)

type mediaMetadataDTO struct {
	MediaKind                string         `json:"media_kind"`
	MIMEType                 string         `json:"mime_type,omitempty"`
	ContainerKind            string         `json:"container_kind,omitempty"`
	LivePhotoAssetIdentifier string         `json:"live_photo_asset_identifier,omitempty"`
	Width                    int            `json:"width,omitempty"`
	Height                   int            `json:"height,omitempty"`
	Orientation              int            `json:"orientation,omitempty"`
	RotationDegrees          int            `json:"rotation_degrees,omitempty"`
	DurationMS               int64          `json:"duration_ms,omitempty"`
	FrameRate                float64        `json:"frame_rate,omitempty"`
	BitRate                  int64          `json:"bit_rate,omitempty"`
	VideoCodec               string         `json:"video_codec,omitempty"`
	AudioCodec               string         `json:"audio_codec,omitempty"`
	CapturedAt               *time.Time     `json:"captured_at,omitempty"`
	Latitude                 *float64       `json:"latitude,omitempty"`
	Longitude                *float64       `json:"longitude,omitempty"`
	AltitudeM                *float64       `json:"altitude_m,omitempty"`
	CameraMake               string         `json:"camera_make,omitempty"`
	CameraModel              string         `json:"camera_model,omitempty"`
	LensModel                string         `json:"lens_model,omitempty"`
	EXIF                     map[string]any `json:"exif,omitempty"`
	Video                    map[string]any `json:"video,omitempty"`
	IndexState               string         `json:"index_state"`
	IndexError               string         `json:"index_error,omitempty"`
	HasThumbnail             bool           `json:"has_thumbnail"`
	ThumbnailMIME            string         `json:"thumbnail_mime_type,omitempty"`
	ThumbnailWidth           int            `json:"thumbnail_width,omitempty"`
	ThumbnailHeight          int            `json:"thumbnail_height,omitempty"`
}

type mediaDerivedResourceDTO struct {
	Role      string `json:"role"`
	Name      string `json:"name"`
	MediaKind string `json:"media_kind"`
	MIMEType  string `json:"mime_type"`
	Size      int64  `json:"size"`
}

type mediaResourceDTO struct {
	Kind      string `json:"kind"`
	NodeID    uint64 `json:"node_id"`
	Role      string `json:"role"`
	Name      string `json:"name"`
	MediaKind string `json:"media_kind"`
	MIMEType  string `json:"mime_type,omitempty"`
	Size      int64  `json:"size"`
}

type mediaItemDTO struct {
	Node             nodeDTO                   `json:"node"`
	Metadata         mediaMetadataDTO          `json:"metadata"`
	AssetKind        string                    `json:"asset_kind,omitempty"`
	Favorite         bool                      `json:"favorite"`
	Resources        []mediaResourceDTO        `json:"resources,omitempty"`
	DerivedResources []mediaDerivedResourceDTO `json:"derived_resources,omitempty"`
	LivePhoto        bool                      `json:"live_photo,omitempty"`
}

type mediaAlbumDTO struct {
	ID          string                `json:"id"`
	Kind        string                `json:"kind"`
	Name        string                `json:"name"`
	Revision    uint64                `json:"revision,omitempty"`
	ItemCount   int64                 `json:"item_count"`
	CoverNodeID *uint64               `json:"cover_node_id,omitempty"`
	UpdatedAt   *time.Time            `json:"updated_at,omitempty"`
	Query       *mediaSmartAlbumQuery `json:"query,omitempty"`
}

func toMediaMetadataDTO(row meta.MediaMetadata) mediaMetadataDTO {
	out := mediaMetadataDTO{
		MediaKind:                row.MediaKind,
		MIMEType:                 row.MIMEType,
		ContainerKind:            row.ContainerKind,
		LivePhotoAssetIdentifier: row.LivePhotoAssetIdentifier,
		Width:                    row.Width,
		Height:                   row.Height,
		Orientation:              row.Orientation,
		RotationDegrees:          row.RotationDegrees,
		DurationMS:               row.DurationMS,
		FrameRate:                row.FrameRate,
		BitRate:                  row.BitRate,
		VideoCodec:               row.VideoCodec,
		AudioCodec:               row.AudioCodec,
		CapturedAt:               row.CapturedAt,
		Latitude:                 row.Latitude,
		Longitude:                row.Longitude,
		AltitudeM:                row.AltitudeM,
		CameraMake:               row.CameraMake,
		CameraModel:              row.CameraModel,
		LensModel:                row.LensModel,
		IndexState:               row.IndexState,
		IndexError:               row.IndexError,
		HasThumbnail:             mediaThumbnailSupported(row),
		ThumbnailMIME:            row.ThumbnailMIMEType,
		ThumbnailWidth:           row.ThumbnailWidth,
		ThumbnailHeight:          row.ThumbnailHeight,
	}
	if strings.TrimSpace(row.EXIFJSON) != "" {
		_ = json.Unmarshal([]byte(row.EXIFJSON), &out.EXIF)
	}
	if strings.TrimSpace(row.VideoJSON) != "" {
		_ = json.Unmarshal([]byte(row.VideoJSON), &out.Video)
	}
	return out
}

func (s *Server) listMediaItems(c *gin.Context) {
	options, ok := mediaQueryFromRequest(c)
	if !ok {
		return
	}
	limit, offset, ok := mediaListWindow(c)
	if !ok {
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
	items, err := s.queryMediaItems(
		c.Request.Context(),
		userID(c),
		options,
		"",
		limit,
		offset,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "list media failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, items)
}

func (s *Server) getMediaItem(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid media id")
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
	resources, err := s.listMediaDerivedResources(c.Request.Context(), node)
	if err != nil {
		fail(c, http.StatusInternalServerError, "list media resources failed")
		return
	}
	livePhoto, err := s.mediaNodeIsLivePhoto(c.Request.Context(), node.ID, node.OwnerID, metadata)
	if err != nil {
		fail(c, http.StatusInternalServerError, "resolve live photo failed")
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
	presentation, err := s.photoAssetPresentation(
		c.Request.Context(),
		node.OwnerID,
		node.ID,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "resolve photo asset failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, mediaItemDTO{
		Node:             toNodeDTO(node),
		Metadata:         toMediaMetadataDTO(metadata),
		AssetKind:        presentation.Kind,
		Favorite:         presentation.Favorite,
		Resources:        presentation.Resources,
		DerivedResources: resources,
		LivePhoto:        livePhoto,
	})
}

func (s *Server) listMediaAlbums(c *gin.Context) {
	if err := s.refreshMediaIndexForOwner(
		c.Request.Context(),
		userID(c),
		mediaRequestIndexBatch,
	); err != nil {
		fail(c, http.StatusInternalServerError, "refresh media projection failed")
		return
	}
	uid := userID(c)
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

	type albumRow struct {
		ExternalKey string
		Kind        string
		Name        string
		Revision    uint64
		QueryJSON   string
		ItemCount   int64
		CoverNodeID *uint64
		UpdatedAt   *time.Time
	}
	var rows []albumRow
	if err := s.DB.WithContext(c.Request.Context()).
		Table("xd_photo_collections AS pc").
		Select(
			"pc.external_key, pc.kind, pc.name, pc.revision, pc.query_json, COUNT(DISTINCT pca.asset_id) AS item_count, "+
				"MIN(CASE WHEN lower(mm.mime_type) IN ? THEN pa.primary_node_id ELSE NULL END) AS cover_node_id, "+
				"MAX(COALESCE(pm.captured_at, pc.updated_at)) AS updated_at",
			thumbnailMIMEs,
		).
		Joins("LEFT JOIN xd_photo_collection_assets AS pca ON pca.collection_id = pc.id").
		Joins("LEFT JOIN xd_photo_assets AS pa ON pa.id = pca.asset_id AND pa.owner_id = pc.owner_id").
		Joins("LEFT JOIN xd_photo_metadata AS pm ON pm.asset_id = pa.id").
		Joins("LEFT JOIN xd_media_metadata AS mm ON mm.node_id = pa.primary_node_id").
		Where("pc.owner_id = ? AND pc.state = ?", uid, meta.PhotoCollectionStateActive).
		Group("pc.id, pc.external_key, pc.kind, pc.name, pc.revision, pc.query_json").
		Order("updated_at DESC, lower(pc.name) ASC").
		Scan(&rows).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list media albums failed")
		return
	}

	result := make([]mediaAlbumDTO, 0, len(rows))
	for _, row := range rows {
		if row.Kind == meta.PhotoCollectionKindSmart {
			query, err := decodeMediaSmartAlbumQuery(row.QueryJSON)
			if err != nil {
				continue
			}
			count, coverNodeID, err := s.smartMediaAlbumStats(
				c.Request.Context(),
				uid,
				query,
			)
			if err != nil {
				fail(c, http.StatusInternalServerError, "list smart media albums failed")
				return
			}
			result = append(result, mediaAlbumDTO{
				ID:          row.ExternalKey,
				Kind:        row.Kind,
				Name:        row.Name,
				Revision:    row.Revision,
				ItemCount:   count,
				CoverNodeID: coverNodeID,
				UpdatedAt:   row.UpdatedAt,
				Query:       &query,
			})
			continue
		}
		kind := row.Kind
		if kind == meta.PhotoCollectionKindSource {
			kind = "imported"
		}
		result = append(result, mediaAlbumDTO{
			ID:          row.ExternalKey,
			Kind:        kind,
			Name:        row.Name,
			Revision:    row.Revision,
			ItemCount:   row.ItemCount,
			CoverNodeID: row.CoverNodeID,
			UpdatedAt:   row.UpdatedAt,
		})
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, result)
}

func (s *Server) listMediaAlbumItems(c *gin.Context) {
	if err := s.refreshMediaIndexForOwner(
		c.Request.Context(),
		userID(c),
		mediaRequestIndexBatch,
	); err != nil {
		fail(c, http.StatusInternalServerError, "refresh media projection failed")
		return
	}
	raw := strings.TrimSpace(c.Param("albumID"))
	if !validMediaAlbumKey(raw) {
		fail(c, http.StatusBadRequest, "invalid media album id")
		return
	}
	options, ok := mediaQueryFromRequest(c)
	if !ok {
		return
	}
	limit, offset, ok := mediaListWindow(c)
	if !ok {
		return
	}
	items, err := s.queryMediaItems(
		c.Request.Context(),
		userID(c),
		options,
		raw,
		limit,
		offset,
	)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "media album not found")
		} else {
			fail(c, http.StatusInternalServerError, "list media album items failed")
		}
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, items)
}

func validMediaAlbumKey(value string) bool {
	value = strings.TrimSpace(value)
	for _, prefix := range []string{
		meta.PhotoCollectionKindFolder + ":",
		meta.PhotoCollectionKindSource + ":",
		meta.PhotoCollectionKindManual + ":",
		meta.PhotoCollectionKindSmart + ":",
	} {
		if strings.HasPrefix(value, prefix) && len(value) > len(prefix) {
			return true
		}
	}
	return false
}

func mediaListWindow(c *gin.Context) (int, int, bool) {
	limit := 100
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 500 {
			fail(c, http.StatusBadRequest, "limit must be between 1 and 500")
			return 0, 0, false
		}
		limit = value
	}
	offset := 0
	if raw := strings.TrimSpace(c.Query("offset")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			fail(c, http.StatusBadRequest, "offset must be zero or greater")
			return 0, 0, false
		}
		offset = value
	}
	return limit, offset, true
}

func (s *Server) queryMediaItems(
	ctx context.Context,
	uid uint64,
	options mediaQueryOptions,
	albumKey string,
	limit, offset int,
) ([]mediaItemDTO, error) {
	query := s.DB.WithContext(ctx).
		Model(&meta.MediaMetadata{}).
		Joins(
			"JOIN xd_photo_assets AS pa ON pa.primary_node_id = xd_media_metadata.node_id AND pa.owner_id = ?",
			uid,
		).
		Joins(
			"JOIN xd_nodes AS n ON n.id = xd_media_metadata.node_id AND n.deleted_at IS NULL",
		).
		Joins("JOIN xd_photo_metadata AS pm ON pm.asset_id = pa.id").
		Where(
			"xd_media_metadata.owner_id = ? AND xd_media_metadata.media_kind IN ?",
			uid,
			[]string{meta.MediaKindImage, meta.MediaKindVideo},
		)
	query = applyMediaQueryFilters(query, options)

	if albumKey != "" {
		if !validMediaAlbumKey(albumKey) {
			return nil, gorm.ErrRecordNotFound
		}
		var collection meta.PhotoCollection
		if err := s.DB.WithContext(ctx).
			Where(
				"owner_id = ? AND external_key = ? AND state = ?",
				uid,
				albumKey,
				meta.PhotoCollectionStateActive,
			).
			First(&collection).Error; err != nil {
			return nil, err
		}
		if collection.Kind == meta.PhotoCollectionKindSmart {
			saved, err := decodeMediaSmartAlbumQuery(collection.QueryJSON)
			if err != nil {
				return nil, err
			}
			query = applyMediaQueryFilters(query, saved.options())
		} else {
			membership := s.DB.WithContext(ctx).
				Table("xd_photo_collection_assets AS pca_media").
				Select("pa_media.primary_node_id").
				Joins("JOIN xd_photo_assets AS pa_media ON pa_media.id = pca_media.asset_id").
				Where("pca_media.collection_id = ? AND pa_media.owner_id = ?", collection.ID, uid)
			query = query.Where("n.id IN (?)", membership)
		}
	}

	var metadata []meta.MediaMetadata
	if err := query.
		Order("COALESCE(xd_media_metadata.captured_at, n.created_at) DESC, n.id DESC").
		Limit(limit).
		Offset(offset).
		Find(&metadata).Error; err != nil {
		return nil, err
	}
	if len(metadata) == 0 {
		return []mediaItemDTO{}, nil
	}

	ids := make([]uint64, 0, len(metadata))
	for _, row := range metadata {
		ids = append(ids, row.NodeID)
	}
	var nodes []meta.Node
	if err := s.DB.WithContext(ctx).
		Preload("File").
		Where("id IN ? AND owner_id = ? AND deleted_at IS NULL", ids, uid).
		Find(&nodes).Error; err != nil {
		return nil, err
	}
	byID := make(map[uint64]meta.Node, len(nodes))
	for _, node := range nodes {
		byID[node.ID] = node
	}
	livePhotoIDs, err := s.validLivePhotoStillNodeIDs(ctx, uid, ids)
	if err != nil {
		return nil, err
	}
	assetPresentations, err := s.photoAssetPresentations(ctx, uid, ids)
	if err != nil {
		return nil, err
	}

	out := make([]mediaItemDTO, 0, len(metadata))
	for _, row := range metadata {
		if node, ok := byID[row.NodeID]; ok {
			_, standaloneLivePhoto := livePhotoIDs[row.NodeID]
			presentation := assetPresentations[row.NodeID]
			out = append(out, mediaItemDTO{
				Node:      toNodeDTO(node),
				Metadata:  toMediaMetadataDTO(row),
				AssetKind: presentation.Kind,
				Favorite:  presentation.Favorite,
				Resources: presentation.Resources,
				LivePhoto: standaloneLivePhoto || row.ContainerKind == mediapkg.ContainerKindLIVP,
			})
		}
	}
	return out, nil
}

func mediaGalleryVisibleNodeSQL(nodeExpr string) string {
	return "NOT EXISTS (" +
		"SELECT 1 FROM xd_media_group_items AS gallery_motion " +
		"JOIN xd_media_groups AS gallery_mg ON gallery_mg.id = gallery_motion.group_id " +
		"JOIN xd_nodes AS gallery_motion_n ON gallery_motion_n.id = gallery_motion.node_id AND gallery_motion_n.deleted_at IS NULL " +
		"JOIN xd_media_metadata AS gallery_motion_mm ON gallery_motion_mm.node_id = gallery_motion_n.id " +
		"WHERE gallery_motion.node_id = " + nodeExpr + " " +
		"AND gallery_motion.role = 'motion' " +
		"AND gallery_mg.kind = 'live_photo' " +
		"AND gallery_mg.owner_id = ? " +
		"AND gallery_motion_n.owner_id = gallery_mg.owner_id " +
		"AND gallery_motion_mm.owner_id = gallery_mg.owner_id " +
		"AND gallery_motion_mm.media_kind = 'video' " +
		"AND gallery_motion_mm.index_state = 'ready' " +
		"AND (SELECT COUNT(*) FROM xd_media_group_items AS gallery_all " +
		"WHERE gallery_all.group_id = gallery_mg.id) = 2 " +
		"AND EXISTS (" +
		"SELECT 1 FROM xd_media_group_items AS gallery_still " +
		"JOIN xd_nodes AS gallery_still_n ON gallery_still_n.id = gallery_still.node_id AND gallery_still_n.deleted_at IS NULL " +
		"JOIN xd_media_metadata AS gallery_still_mm ON gallery_still_mm.node_id = gallery_still_n.id " +
		"WHERE gallery_still.group_id = gallery_mg.id " +
		"AND gallery_still.role = 'still' " +
		"AND gallery_still_n.owner_id = gallery_mg.owner_id " +
		"AND gallery_still_mm.owner_id = gallery_mg.owner_id " +
		"AND gallery_still_mm.media_kind = 'image' " +
		"AND gallery_still_mm.index_state = 'ready'" +
		") " +
		"AND (SELECT COUNT(*) FROM xd_media_group_items AS gallery_valid " +
		"JOIN xd_nodes AS gallery_valid_n ON gallery_valid_n.id = gallery_valid.node_id AND gallery_valid_n.deleted_at IS NULL " +
		"JOIN xd_media_metadata AS gallery_valid_mm ON gallery_valid_mm.node_id = gallery_valid_n.id " +
		"WHERE gallery_valid.group_id = gallery_mg.id " +
		"AND gallery_valid_n.owner_id = gallery_mg.owner_id " +
		"AND gallery_valid_mm.owner_id = gallery_mg.owner_id " +
		"AND gallery_valid_mm.index_state = 'ready' " +
		"AND ((gallery_valid.role = 'still' AND gallery_valid_mm.media_kind = 'image') " +
		"OR (gallery_valid.role = 'motion' AND gallery_valid_mm.media_kind = 'video'))) = 2" +
		")"
}

func (s *Server) validLivePhotoStillNodeIDs(
	ctx context.Context,
	uid uint64,
	nodeIDs []uint64,
) (map[uint64]struct{}, error) {
	out := make(map[uint64]struct{})
	if len(nodeIDs) == 0 {
		return out, nil
	}
	type row struct {
		NodeID uint64
	}
	var rows []row
	if err := s.DB.WithContext(ctx).
		Table("xd_media_group_items AS still_mgi").
		Select("still_mgi.node_id").
		Joins("JOIN xd_media_groups AS mg ON mg.id = still_mgi.group_id").
		Where(
			"mg.owner_id = ? AND mg.kind = ? AND still_mgi.role = ? AND still_mgi.node_id IN ? "+
				"AND (SELECT COUNT(*) FROM xd_media_group_items AS all_mgi WHERE all_mgi.group_id = mg.id) = 2 "+
				"AND (SELECT COUNT(*) FROM xd_media_group_items AS valid_mgi "+
				"JOIN xd_nodes AS valid_n ON valid_n.id = valid_mgi.node_id AND valid_n.deleted_at IS NULL "+
				"JOIN xd_media_metadata AS valid_mm ON valid_mm.node_id = valid_n.id "+
				"WHERE valid_mgi.group_id = mg.id AND valid_n.owner_id = mg.owner_id "+
				"AND valid_mm.owner_id = mg.owner_id AND valid_mm.index_state = ? "+
				"AND ((valid_mgi.role = ? AND valid_mm.media_kind = ?) "+
				"OR (valid_mgi.role = ? AND valid_mm.media_kind = ?))) = 2 "+
				"AND EXISTS (SELECT 1 FROM xd_media_group_items AS motion_mgi "+
				"JOIN xd_nodes AS motion_n ON motion_n.id = motion_mgi.node_id AND motion_n.deleted_at IS NULL "+
				"JOIN xd_media_metadata AS motion_mm ON motion_mm.node_id = motion_n.id "+
				"WHERE motion_mgi.group_id = mg.id AND motion_mgi.role = ? "+
				"AND motion_n.owner_id = mg.owner_id AND motion_mm.owner_id = mg.owner_id "+
				"AND motion_mm.media_kind = ? AND motion_mm.index_state = ?)",
			uid,
			meta.MediaGroupKindLivePhoto,
			meta.MediaGroupRoleStill,
			nodeIDs,
			meta.MediaIndexStateReady,
			meta.MediaGroupRoleStill,
			meta.MediaKindImage,
			meta.MediaGroupRoleMotion,
			meta.MediaKindVideo,
			meta.MediaGroupRoleMotion,
			meta.MediaKindVideo,
			meta.MediaIndexStateReady,
		).
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		out[row.NodeID] = struct{}{}
	}
	return out, nil
}

func (s *Server) mediaNodeIsLivePhoto(
	ctx context.Context,
	nodeID, uid uint64,
	metadata meta.MediaMetadata,
) (bool, error) {
	if metadata.ContainerKind == mediapkg.ContainerKindLIVP {
		return true, nil
	}
	ids, err := s.validLivePhotoStillNodeIDs(ctx, uid, []uint64{nodeID})
	if err != nil {
		return false, err
	}
	_, ok := ids[nodeID]
	return ok, nil
}

func (s *Server) mediaThumbnail(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid media id")
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
	if metadata.MediaKind != meta.MediaKindImage ||
		!mediaThumbnailSupported(metadata) {
		fail(c, http.StatusUnsupportedMediaType, "thumbnail format is not supported")
		return
	}

	etag := mediaThumbnailETag(node, metadata)
	c.Header("ETag", etag)
	c.Header("Cache-Control", "private, max-age=3600")

	if metadata.ThumbnailKey != "" {
		if file, openErr := s.Store.Open(
			c.Request.Context(),
			metadata.ThumbnailKey,
		); openErr == nil {
			defer file.Close()
			contentType := metadata.ThumbnailMIMEType
			if contentType == "" {
				contentType = "image/jpeg"
			}
			c.Header("Content-Type", contentType)
			http.ServeContent(
				c.Writer,
				c.Request,
				node.Name+".jpg",
				metadata.UpdatedAt,
				file,
			)
			return
		}
	}

	file, err := s.Store.Open(c.Request.Context(), node.File.StorageKey)
	if err != nil {
		fail(c, http.StatusNotFound, "stored content not found")
		return
	}
	defer file.Close()

	var thumbnailSource io.ReadSeeker = file
	if metadata.ContainerKind == mediapkg.ContainerKindLIVP {
		resource, resourceErr := s.currentMediaDerivedResource(
			c.Request.Context(),
			node,
			meta.MediaDerivedResourceRoleStill,
		)
		if resourceErr != nil {
			fail(c, http.StatusUnsupportedMediaType, "live photo still resource is unavailable")
			return
		}
		thumbnailSource = io.NewSectionReader(
			file,
			resource.ByteOffset,
			resource.ByteSize,
		)
	} else if strings.EqualFold(strings.TrimSpace(metadata.MIMEType), "image/x-adobe-dng") {
		preview, previewErr := mediapkg.DNGEmbeddedJPEGPreview(file)
		if previewErr != nil {
			fail(c, http.StatusUnsupportedMediaType, "dng embedded preview is unavailable")
			return
		}
		thumbnailSource = bytes.NewReader(preview)
	}
	thumbnail, err := mediapkg.ThumbnailJPEG(
		thumbnailSource,
		metadata.Orientation,
		mediaThumbnailEdge,
	)
	if err != nil {
		fail(c, http.StatusUnsupportedMediaType, "thumbnail format is not supported")
		return
	}

	key := mediaThumbnailStorageKey(node, metadata)
	if _, putErr := s.Store.Put(
		c.Request.Context(),
		key,
		bytes.NewReader(thumbnail.Data),
	); putErr == nil {
		now := time.Now().UTC()
		_ = s.DB.WithContext(c.Request.Context()).
			Model(&meta.MediaMetadata{}).
			Where(
				"node_id = ? AND node_revision = ?",
				node.ID,
				node.Revision,
			).
			Updates(map[string]any{
				"thumbnail_key":       key,
				"thumbnail_mime_type": thumbnail.MIMEType,
				"thumbnail_width":     thumbnail.Width,
				"thumbnail_height":    thumbnail.Height,
				"updated_at":          now,
			}).Error
	}

	c.Header("Content-Type", thumbnail.MIMEType)
	c.Status(http.StatusOK)
	_, _ = c.Writer.Write(thumbnail.Data)
}

func mediaThumbnailSupported(row meta.MediaMetadata) bool {
	if row.ThumbnailKey != "" {
		return true
	}
	mimeType := strings.ToLower(strings.TrimSpace(row.MIMEType))
	if row.ContainerKind == mediapkg.ContainerKindLIVP {
		if descriptor, err := parseLIVPContainerDescriptor(row.ContainerJSON); err == nil {
			mimeType = strings.ToLower(strings.TrimSpace(descriptor.Still.MIMEType))
		}
	}
	switch mimeType {
	case "image/jpeg", "image/png", "image/gif", "image/webp", "image/avif",
		"image/tiff", "image/bmp", "image/heic", "image/heif",
		"image/x-adobe-dng":
		return true
	default:
		return false
	}
}

func mediaThumbnailETag(node meta.Node, row meta.MediaMetadata) string {
	if sha := strings.ToLower(strings.TrimSpace(row.SHA256)); sha != "" {
		return fmt.Sprintf(
			"\"media-%s-%d\"",
			sha,
			mediaThumbnailEdge,
		)
	}
	return fmt.Sprintf(
		"\"media-node-%d-%d-%d\"",
		node.ID,
		node.Revision,
		mediaThumbnailEdge,
	)
}

func mediaThumbnailStorageKey(
	node meta.Node,
	row meta.MediaMetadata,
) string {
	sha := strings.ToLower(strings.TrimSpace(row.SHA256))
	if len(sha) >= 2 {
		return fmt.Sprintf(
			".xdrive-media/thumbnails/%s/%s-%d.jpg",
			sha[:2],
			sha,
			mediaThumbnailEdge,
		)
	}
	return fmt.Sprintf(
		".xdrive-media/thumbnails/node/%d-%d-%d.jpg",
		node.ID,
		node.Revision,
		mediaThumbnailEdge,
	)
}

func (s *Server) ensureMediaMetadata(
	ctx context.Context,
	node meta.Node,
) (meta.MediaMetadata, error) {
	var current meta.MediaMetadata
	err := s.DB.WithContext(ctx).
		Where("node_id = ?", node.ID).
		First(&current).Error
	if err == nil &&
		node.File != nil &&
		current.NodeRevision == node.Revision &&
		current.SHA256 == node.File.SHA256 &&
		current.RelationEvidenceVersion >= mediapkg.RelationEvidenceVersion &&
		!legacyLIVPMetadata(node, current) {
		return current, nil
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return current, err
	}
	return s.indexMediaNode(ctx, node)
}

func legacyLIVPMetadata(node meta.Node, row meta.MediaMetadata) bool {
	return strings.EqualFold(filepath.Ext(node.Name), ".livp") &&
		(strings.TrimSpace(row.ContainerKind) == "" || row.DerivedResourceVersion < 1)
}

func (s *Server) indexMediaNode(
	ctx context.Context,
	node meta.Node,
) (meta.MediaMetadata, error) {
	var out meta.MediaMetadata
	if node.Type != meta.NodeTypeFile || node.File == nil {
		return out, errors.New("media index requires file node")
	}

	file, err := s.Store.Open(ctx, node.File.StorageKey)
	if err != nil {
		return out, err
	}
	defer file.Close()

	extracted, extractErr := mediapkg.Extract(
		node.Name,
		file,
		node.File.Size,
	)
	var derivedResources []meta.MediaDerivedResource
	if extractErr == nil && extracted.ContainerKind == mediapkg.ContainerKindLIVP {
		derivedResources, extractErr = mediaDerivedResourcesFromLIVPContainer(
			extracted.ContainerJSON,
		)
		if extractErr != nil {
			extracted.Kind = mediapkg.KindOther
		}
	}
	kind := extracted.Kind
	if !meta.ValidMediaKind(kind) {
		kind = meta.MediaKindOther
	}
	state := meta.MediaIndexStateReady
	indexError := ""
	if kind == meta.MediaKindOther {
		state = meta.MediaIndexStateUnsupported
	}
	if extractErr != nil {
		state = meta.MediaIndexStateError
		indexError = strings.TrimSpace(extractErr.Error())
		if len(indexError) > 2000 {
			indexError = indexError[:2000]
		}
	}

	now := time.Now().UTC()
	out = meta.MediaMetadata{
		NodeID:                   node.ID,
		OwnerID:                  node.OwnerID,
		NodeRevision:             node.Revision,
		SHA256:                   node.File.SHA256,
		MediaKind:                kind,
		MIMEType:                 extracted.MIMEType,
		ContainerKind:            extracted.ContainerKind,
		ContainerJSON:            extracted.ContainerJSON,
		LivePhotoAssetIdentifier: extracted.LivePhotoAssetIdentifier,
		RelationEvidenceVersion:  mediapkg.RelationEvidenceVersion,
		RelationJSON:             extracted.RelationJSON,
		DerivedResourceVersion: func() int {
			if strings.EqualFold(filepath.Ext(node.Name), ".livp") {
				return 1
			}
			return 0
		}(),
		Width:           extracted.Width,
		Height:          extracted.Height,
		Orientation:     extracted.Orientation,
		RotationDegrees: extracted.RotationDegrees,
		DurationMS:      extracted.DurationMS,
		FrameRate:       extracted.FrameRate,
		BitRate:         extracted.BitRate,
		VideoCodec:      extracted.VideoCodec,
		AudioCodec:      extracted.AudioCodec,
		CapturedAt:      extracted.CapturedAt,
		Latitude:        extracted.Latitude,
		Longitude:       extracted.Longitude,
		AltitudeM:       extracted.AltitudeM,
		CameraMake:      extracted.CameraMake,
		CameraModel:     extracted.CameraModel,
		LensModel:       extracted.LensModel,
		EXIFJSON:        extracted.EXIFJSON,
		VideoJSON:       extracted.VideoJSON,
		IndexState:      state,
		IndexError:      indexError,
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	for index := range derivedResources {
		derivedResources[index].NodeID = node.ID
		derivedResources[index].OwnerID = node.OwnerID
		derivedResources[index].NodeRevision = node.Revision
		derivedResources[index].SHA256 = node.File.SHA256
		derivedResources[index].CreatedAt = now
		derivedResources[index].UpdatedAt = now
	}

	var previous meta.MediaMetadata
	if s.DB.WithContext(ctx).
		Where("node_id = ?", node.ID).
		First(&previous).Error == nil &&
		previous.SHA256 != "" &&
		previous.SHA256 == out.SHA256 {
		out.ThumbnailKey = previous.ThumbnailKey
		out.ThumbnailMIMEType = previous.ThumbnailMIMEType
		out.ThumbnailWidth = previous.ThumbnailWidth
		out.ThumbnailHeight = previous.ThumbnailHeight
	}

	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "node_id"}},
			DoUpdates: clause.AssignmentColumns([]string{
				"owner_id",
				"node_revision",
				"sha256",
				"media_kind",
				"mime_type",
				"container_kind",
				"container_json",
				"live_photo_asset_identifier",
				"relation_evidence_version",
				"relation_json",
				"derived_resource_version",
				"width",
				"height",
				"orientation",
				"rotation_degrees",
				"duration_ms",
				"frame_rate",
				"bit_rate",
				"video_codec",
				"audio_codec",
				"captured_at",
				"latitude",
				"longitude",
				"altitude_m",
				"camera_make",
				"camera_model",
				"lens_model",
				"exif_json",
				"video_json",
				"thumbnail_key",
				"thumbnail_mime_type",
				"thumbnail_width",
				"thumbnail_height",
				"index_state",
				"index_error",
				"updated_at",
			}),
		}).
			Create(&out).Error; err != nil {
			return err
		}
		if err := tx.Where("node_id = ?", node.ID).
			Delete(&meta.MediaDerivedResource{}).Error; err != nil {
			return err
		}
		if len(derivedResources) != 0 {
			if err := tx.Create(&derivedResources).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return out, err
	}

	identifiers := make(map[string]struct{}, 2)
	if value := strings.TrimSpace(previous.LivePhotoAssetIdentifier); value != "" {
		identifiers[value] = struct{}{}
	}
	if value := strings.TrimSpace(out.LivePhotoAssetIdentifier); value != "" {
		identifiers[value] = struct{}{}
	}
	for identifier := range identifiers {
		if _, reconcileErr := mediagroup.ReconcileAppleLivePhoto(ctx, s.DB, node.OwnerID, identifier); reconcileErr != nil {
			slog.Warn(
				"live_photo_reconcile_failed",
				"owner_id", node.OwnerID,
				"node_id", node.ID,
				"error", reconcileErr,
			)
		}
	}
	return out, nil
}

func (s *Server) refreshMediaIndexForOwner(
	ctx context.Context,
	uid uint64,
	limit int,
) error {
	if limit <= 0 {
		limit = mediaRequestIndexBatch
	}
	nodes, err := s.staleMediaNodes(ctx, &uid, limit)
	if err != nil {
		return err
	}
	for index := range nodes {
		if err := s.DB.WithContext(ctx).
			Where("node_id = ?", nodes[index].ID).
			First(&nodes[index].File).Error; err != nil {
			continue
		}
		_, _ = s.indexMediaNode(ctx, nodes[index])
	}
	if err := mediagroup.ReconcileLocalEvidenceGroups(ctx, s.DB, uid); err != nil {
		return err
	}
	_, err = photoasset.ReconcileOwner(ctx, s.DB, uid)
	return err
}

func (s *Server) refreshMediaIndexBatch(
	ctx context.Context,
	limit int,
) (int, error) {
	if limit <= 0 {
		limit = mediaIndexBatchSize
	}
	nodes, err := s.staleMediaNodes(ctx, nil, limit)
	if err != nil {
		return 0, err
	}
	owners := make(map[uint64]struct{})
	for index := range nodes {
		owners[nodes[index].OwnerID] = struct{}{}
		if err := s.DB.WithContext(ctx).
			Where("node_id = ?", nodes[index].ID).
			First(&nodes[index].File).Error; err != nil {
			continue
		}
		_, _ = s.indexMediaNode(ctx, nodes[index])
	}
	for ownerID := range owners {
		if err := mediagroup.ReconcileLocalEvidenceGroups(ctx, s.DB, ownerID); err != nil {
			return len(nodes), err
		}
		if _, err := photoasset.ReconcileOwner(ctx, s.DB, ownerID); err != nil {
			return len(nodes), err
		}
	}
	return len(nodes), nil
}

func (s *Server) staleMediaNodes(
	ctx context.Context,
	uid *uint64,
	limit int,
) ([]meta.Node, error) {
	query := s.DB.WithContext(ctx).
		Table("xd_nodes AS n").
		Select("n.*").
		Joins("JOIN xd_files AS f ON f.node_id = n.id").
		Joins("LEFT JOIN xd_media_metadata AS mm ON mm.node_id = n.id").
		Where(
			"n.type = ? AND n.deleted_at IS NULL AND "+
				"(mm.node_id IS NULL OR mm.node_revision <> n.revision OR mm.sha256 <> f.sha256 OR "+
				"COALESCE(mm.relation_evidence_version, 0) < ? OR "+
				"(lower(n.name) LIKE '%.livp' AND (COALESCE(mm.container_kind, '') = '' OR mm.derived_resource_version < 1)))",
			meta.NodeTypeFile,
			mediapkg.RelationEvidenceVersion,
		)
	if uid != nil {
		query = query.Where("n.owner_id = ?", *uid)
	}
	var nodes []meta.Node
	err := query.
		Order("n.updated_at DESC, n.id DESC").
		Limit(limit).
		Find(&nodes).Error
	return nodes, err
}

type livpContainerDescriptor struct {
	AssetIdentifier string                          `json:"asset_identifier"`
	Still           livpContainerResourceDescriptor `json:"still"`
	Motion          livpContainerResourceDescriptor `json:"motion"`
}

type livpContainerResourceDescriptor struct {
	Name     string `json:"name"`
	Offset   int64  `json:"offset"`
	Size     int64  `json:"size"`
	MIMEType string `json:"mime_type"`
}

func parseLIVPContainerDescriptor(raw string) (livpContainerDescriptor, error) {
	var out livpContainerDescriptor
	if strings.TrimSpace(raw) == "" {
		return out, errors.New("livp container metadata is empty")
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return out, err
	}
	out.AssetIdentifier = strings.TrimSpace(out.AssetIdentifier)
	if out.AssetIdentifier == "" {
		return livpContainerDescriptor{}, errors.New("livp asset identifier is missing")
	}
	for _, resource := range []livpContainerResourceDescriptor{out.Still, out.Motion} {
		if strings.TrimSpace(resource.Name) == "" ||
			strings.TrimSpace(resource.MIMEType) == "" ||
			resource.Offset < 0 ||
			resource.Size <= 0 {
			return livpContainerDescriptor{}, errors.New("livp resource descriptor is invalid")
		}
	}
	return out, nil
}

func mediaDerivedResourcesFromLIVPContainer(
	raw string,
) ([]meta.MediaDerivedResource, error) {
	descriptor, err := parseLIVPContainerDescriptor(raw)
	if err != nil {
		return nil, err
	}
	return []meta.MediaDerivedResource{
		{
			Role:            meta.MediaDerivedResourceRoleStill,
			Name:            descriptor.Still.Name,
			MediaKind:       meta.MediaKindImage,
			MIMEType:        descriptor.Still.MIMEType,
			ByteOffset:      descriptor.Still.Offset,
			ByteSize:        descriptor.Still.Size,
			AssetIdentifier: descriptor.AssetIdentifier,
		},
		{
			Role:            meta.MediaDerivedResourceRoleMotion,
			Name:            descriptor.Motion.Name,
			MediaKind:       meta.MediaKindVideo,
			MIMEType:        descriptor.Motion.MIMEType,
			ByteOffset:      descriptor.Motion.Offset,
			ByteSize:        descriptor.Motion.Size,
			AssetIdentifier: descriptor.AssetIdentifier,
		},
	}, nil
}

func toMediaDerivedResourceDTO(row meta.MediaDerivedResource) mediaDerivedResourceDTO {
	return mediaDerivedResourceDTO{
		Role:      row.Role,
		Name:      row.Name,
		MediaKind: row.MediaKind,
		MIMEType:  row.MIMEType,
		Size:      row.ByteSize,
	}
}

func (s *Server) listMediaDerivedResources(
	ctx context.Context,
	node meta.Node,
) ([]mediaDerivedResourceDTO, error) {
	if node.File == nil {
		return nil, nil
	}
	var rows []meta.MediaDerivedResource
	if err := s.DB.WithContext(ctx).
		Where(
			"node_id = ? AND owner_id = ? AND node_revision = ? AND sha256 = ?",
			node.ID,
			node.OwnerID,
			node.Revision,
			node.File.SHA256,
		).
		Order("role ASC").
		Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]mediaDerivedResourceDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, toMediaDerivedResourceDTO(row))
	}
	return out, nil
}

func (s *Server) currentMediaDerivedResource(
	ctx context.Context,
	node meta.Node,
	role string,
) (meta.MediaDerivedResource, error) {
	var row meta.MediaDerivedResource
	if node.File == nil || !meta.ValidMediaDerivedResourceRole(role) {
		return row, gorm.ErrRecordNotFound
	}
	if err := s.DB.WithContext(ctx).
		Where(
			"node_id = ? AND role = ? AND owner_id = ? AND node_revision = ? AND sha256 = ?",
			node.ID,
			role,
			node.OwnerID,
			node.Revision,
			node.File.SHA256,
		).
		First(&row).Error; err != nil {
		return row, err
	}
	if row.ByteOffset < 0 || row.ByteSize <= 0 ||
		row.ByteOffset > node.File.Size ||
		row.ByteSize > node.File.Size-row.ByteOffset {
		return meta.MediaDerivedResource{}, errors.New("invalid media resource range")
	}
	return row, nil
}

func (s *Server) mediaLivePhotoMotion(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid media id")
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

	if metadata.ContainerKind == mediapkg.ContainerKindLIVP {
		resource, err := s.currentMediaDerivedResource(
			c.Request.Context(),
			node,
			meta.MediaDerivedResourceRoleMotion,
		)
		if err != nil {
			fail(c, http.StatusNotFound, "live photo motion not found")
			return
		}
		file, err := s.Store.Open(c.Request.Context(), node.File.StorageKey)
		if err != nil {
			fail(c, http.StatusNotFound, "stored content not found")
			return
		}
		defer file.Close()
		c.Header("ETag", fmt.Sprintf(
			"\"live-photo-motion-%s-%d-%d\"",
			strings.ToLower(strings.TrimSpace(node.File.SHA256)),
			resource.ByteOffset,
			resource.ByteSize,
		))
		c.Header("Cache-Control", "private, max-age=3600")
		c.Header("Content-Type", resource.MIMEType)
		http.ServeContent(
			c.Writer,
			c.Request,
			resource.Name,
			metadata.UpdatedAt,
			io.NewSectionReader(file, resource.ByteOffset, resource.ByteSize),
		)
		return
	}

	motionNode, motionMetadata, err := s.standaloneLivePhotoMotion(
		c.Request.Context(),
		node.ID,
		node.OwnerID,
	)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "live photo motion not found")
		} else {
			fail(c, http.StatusInternalServerError, "resolve live photo motion failed")
		}
		return
	}
	file, err := s.Store.Open(c.Request.Context(), motionNode.File.StorageKey)
	if err != nil {
		fail(c, http.StatusNotFound, "stored content not found")
		return
	}
	defer file.Close()
	contentType := strings.TrimSpace(motionMetadata.MIMEType)
	if contentType == "" {
		contentType = "video/quicktime"
	}
	c.Header("ETag", fmt.Sprintf(
		"\"live-photo-motion-%s\"",
		strings.ToLower(strings.TrimSpace(motionNode.File.SHA256)),
	))
	c.Header("Cache-Control", "private, max-age=3600")
	c.Header("Content-Type", contentType)
	http.ServeContent(
		c.Writer,
		c.Request,
		motionNode.Name,
		motionMetadata.UpdatedAt,
		file,
	)
}

func (s *Server) standaloneLivePhotoMotion(
	ctx context.Context,
	stillNodeID, uid uint64,
) (meta.Node, meta.MediaMetadata, error) {
	var motion meta.Node
	var motionMetadata meta.MediaMetadata

	type memberRow struct {
		GroupID   uint64
		NodeID    uint64
		Role      string
		MediaKind string
	}
	var members []memberRow
	if err := s.DB.WithContext(ctx).
		Table("xd_media_group_items AS mgi").
		Select("mgi.group_id, mgi.node_id, mgi.role, mm.media_kind").
		Joins("JOIN xd_media_groups AS mg ON mg.id = mgi.group_id").
		Joins("JOIN xd_nodes AS n ON n.id = mgi.node_id AND n.deleted_at IS NULL").
		Joins("JOIN xd_media_metadata AS mm ON mm.node_id = n.id AND mm.index_state = ?", meta.MediaIndexStateReady).
		Where(
			"mg.owner_id = ? AND mg.kind = ? AND n.owner_id = ? AND mm.owner_id = ? "+
				"AND mgi.group_id IN ("+
				"SELECT still_mgi.group_id FROM xd_media_group_items AS still_mgi "+
				"JOIN xd_media_groups AS still_mg ON still_mg.id = still_mgi.group_id "+
				"WHERE still_mgi.node_id = ? AND still_mgi.role = ? "+
				"AND still_mg.owner_id = ? AND still_mg.kind = ? "+
				"AND (SELECT COUNT(*) FROM xd_media_group_items AS all_mgi WHERE all_mgi.group_id = still_mg.id) = 2) ",
			uid,
			meta.MediaGroupKindLivePhoto,
			uid,
			uid,
			stillNodeID,
			meta.MediaGroupRoleStill,
			uid,
			meta.MediaGroupKindLivePhoto,
		).
		Order("mgi.group_id ASC, mgi.ordinal ASC").
		Scan(&members).Error; err != nil {
		return motion, motionMetadata, err
	}
	if len(members) != 2 ||
		members[0].GroupID != members[1].GroupID {
		return motion, motionMetadata, gorm.ErrRecordNotFound
	}

	var stillCount, motionCount int
	var motionID uint64
	for _, member := range members {
		switch {
		case member.Role == meta.MediaGroupRoleStill &&
			member.MediaKind == meta.MediaKindImage &&
			member.NodeID == stillNodeID:
			stillCount++
		case member.Role == meta.MediaGroupRoleMotion &&
			member.MediaKind == meta.MediaKindVideo:
			motionCount++
			motionID = member.NodeID
		default:
			return motion, motionMetadata, gorm.ErrRecordNotFound
		}
	}
	if stillCount != 1 || motionCount != 1 || motionID == 0 {
		return motion, motionMetadata, gorm.ErrRecordNotFound
	}
	if err := s.DB.WithContext(ctx).
		Preload("File").
		Where(
			"id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			motionID,
			uid,
			meta.NodeTypeFile,
		).
		First(&motion).Error; err != nil {
		return motion, motionMetadata, err
	}
	if motion.File == nil {
		return motion, motionMetadata, gorm.ErrRecordNotFound
	}
	if err := s.DB.WithContext(ctx).
		Where(
			"node_id = ? AND owner_id = ? AND media_kind = ? AND index_state = ?",
			motion.ID,
			uid,
			meta.MediaKindVideo,
			meta.MediaIndexStateReady,
		).
		First(&motionMetadata).Error; err != nil {
		return motion, motionMetadata, err
	}
	return motion, motionMetadata, nil
}

func (s *Server) mediaDerivedResourceContent(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid media id")
		return
	}
	role := strings.TrimSpace(c.Param("role"))
	if !meta.ValidMediaDerivedResourceRole(role) {
		fail(c, http.StatusBadRequest, "invalid media resource role")
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
	if metadata.ContainerKind != mediapkg.ContainerKindLIVP {
		fail(c, http.StatusNotFound, "media resource not found")
		return
	}
	resource, err := s.currentMediaDerivedResource(c.Request.Context(), node, role)
	if err != nil {
		fail(c, http.StatusNotFound, "media resource not found")
		return
	}
	file, err := s.Store.Open(c.Request.Context(), node.File.StorageKey)
	if err != nil {
		fail(c, http.StatusNotFound, "stored content not found")
		return
	}
	defer file.Close()

	etag := fmt.Sprintf(
		"\"media-resource-%s-%s-%d-%d\"",
		strings.ToLower(strings.TrimSpace(node.File.SHA256)),
		role,
		resource.ByteOffset,
		resource.ByteSize,
	)
	c.Header("ETag", etag)
	c.Header("Cache-Control", "private, max-age=3600")
	c.Header("Content-Type", resource.MIMEType)
	http.ServeContent(
		c.Writer,
		c.Request,
		resource.Name,
		metadata.UpdatedAt,
		io.NewSectionReader(file, resource.ByteOffset, resource.ByteSize),
	)
}

func (s *Server) StartMediaIndexer(ctx context.Context) {
	go func() {
		delay := time.Duration(0)
		for {
			if delay > 0 {
				select {
				case <-ctx.Done():
					return
				case <-time.After(delay):
				}
			}
			if ctx.Err() != nil {
				return
			}
			count, err := s.refreshMediaIndexBatch(
				ctx,
				mediaIndexBatchSize,
			)
			switch {
			case err != nil:
				slog.Warn("media_index_batch_failed", "error", err)
				delay = mediaIndexerErrorInterval
			case count > 0:
				delay = mediaIndexerBusyInterval
			default:
				delay = mediaIndexerIdleInterval
			}
		}
	}()
}
