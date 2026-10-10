package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image/jpeg"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/background"
	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/mediagroup"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photoasset"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	mediaRequestIndexBatch   = 16
	mediaThumbnailEdge       = mediapkg.DefaultThumbnailEdge
	mediaVideoPosterMaxBytes = 4 << 20
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

type mediaEditRecipeDTO struct {
	Version         int        `json:"version"`
	Revision        uint64     `json:"revision"`
	SourceCurrent   bool       `json:"source_current"`
	MediaKind       string     `json:"media_kind"`
	RotationDegrees int        `json:"rotation_degrees"`
	FlipHorizontal  bool       `json:"flip_horizontal"`
	FlipVertical    bool       `json:"flip_vertical"`
	CropX           float64    `json:"crop_x"`
	CropY           float64    `json:"crop_y"`
	CropWidth       float64    `json:"crop_width"`
	CropHeight      float64    `json:"crop_height"`
	ExposureEV      float64    `json:"exposure_ev"`
	Contrast        float64    `json:"contrast"`
	Saturation      float64    `json:"saturation"`
	TrimStartMS     int64      `json:"trim_start_ms"`
	TrimEndMS       int64      `json:"trim_end_ms"`
	UpdatedAt       *time.Time `json:"updated_at,omitempty"`
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
	Tags             []string                  `json:"tags,omitempty"`
	People           []string                  `json:"people,omitempty"`
	Description      string                    `json:"description,omitempty"`
	EditRecipe       *mediaEditRecipeDTO       `json:"edit_recipe,omitempty"`
	Resources        []mediaResourceDTO        `json:"resources,omitempty"`
	FoldMemberIDs    []uint64                  `json:"fold_member_ids,omitempty"`
	DerivedResources []mediaDerivedResourceDTO `json:"derived_resources,omitempty"`
	LivePhoto        bool                      `json:"live_photo,omitempty"`
	TrashRoot        *nodeDTO                  `json:"trash_root,omitempty"`
}

type mediaTimelineGroupDTO struct {
	Key        string `json:"key"`
	ItemCount  int64  `json:"item_count"`
	StartIndex int64  `json:"start_index"`
}

type mediaTimelineGroupSetsDTO struct {
	Year  []mediaTimelineGroupDTO `json:"year"`
	Month []mediaTimelineGroupDTO `json:"month"`
	Day   []mediaTimelineGroupDTO `json:"day"`
}

type mediaItemRangeDTO struct {
	AnchorIndex       *int64                     `json:"anchor_index,omitempty"`
	Items             []mediaItemDTO             `json:"items"`
	TotalCount        int64                      `json:"total_count"`
	Offset            int                        `json:"offset"`
	Limit             int                        `json:"limit"`
	SearchOrder       string                     `json:"search_order,omitempty"`
	TimelineGroups    []mediaTimelineGroupDTO    `json:"timeline_groups,omitempty"`
	TimelineGroupSets *mediaTimelineGroupSetsDTO `json:"timeline_group_sets,omitempty"`
}

type mediaAlbumDTO struct {
	AlbumFolderID uint64                `json:"album_folder_id"`
	ID            string                `json:"id"`
	Kind          string                `json:"kind"`
	Name          string                `json:"name"`
	Revision      uint64                `json:"revision,omitempty"`
	ItemCount     int64                 `json:"item_count"`
	CoverNodeID   *uint64               `json:"cover_node_id,omitempty"`
	UpdatedAt     *time.Time            `json:"updated_at,omitempty"`
	Query         *mediaSmartAlbumQuery `json:"query,omitempty"`
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
	rangeRequested, ok := mediaRangeRequested(c)
	if !ok {
		return
	}
	if err := s.refreshMediaIndexForGalleryRead(
		c.Request.Context(),
		userID(c),
		mediaRequestIndexBatch,
	); err != nil {
		fail(c, http.StatusInternalServerError, "refresh media projection failed")
		return
	}
	if rangeRequested {
		page, err := s.queryMediaItemRange(
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
		c.JSON(http.StatusOK, page)
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
		Tags:             presentation.Tags,
		People:           presentation.People,
		Description:      presentation.Description,
		EditRecipe:       presentation.EditRecipe,
		Resources:        presentation.Resources,
		DerivedResources: resources,
		LivePhoto:        livePhoto,
	})
}

func (s *Server) listMediaAlbums(c *gin.Context) {
	if err := s.refreshMediaIndexForGalleryRead(
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
	var rows []albumRow
	if err := s.DB.WithContext(c.Request.Context()).
		Table("xd_photo_collections AS pc").
		Select(
			"pc.album_folder_id, pc.external_key, pc.kind, pc.name, pc.revision, pc.query_json, COUNT(DISTINCT album_n.id) AS item_count, "+
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
		Where("pc.owner_id = ? AND pc.state = ?", uid, meta.PhotoCollectionStateActive).
		Group("pc.id, pc.album_folder_id, pc.external_key, pc.kind, pc.name, pc.revision, pc.query_json").
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
				ID:            row.ExternalKey,
				AlbumFolderID: row.AlbumFolderID,
				Kind:          row.Kind,
				Name:          row.Name,
				Revision:      row.Revision,
				ItemCount:     count,
				CoverNodeID:   coverNodeID,
				UpdatedAt:     row.UpdatedAt,
				Query:         &query,
			})
			continue
		}
		kind := row.Kind
		if kind == meta.PhotoCollectionKindSource {
			kind = "imported"
		}
		result = append(result, mediaAlbumDTO{
			ID:            row.ExternalKey,
			AlbumFolderID: row.AlbumFolderID,
			Kind:          kind,
			Name:          row.Name,
			Revision:      row.Revision,
			ItemCount:     row.ItemCount,
			CoverNodeID:   row.CoverNodeID,
			UpdatedAt:     row.UpdatedAt,
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
	rangeRequested, ok := mediaRangeRequested(c)
	if !ok {
		return
	}
	if rangeRequested {
		page, err := s.queryMediaItemRange(
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
		c.JSON(http.StatusOK, page)
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

func mediaRangeRequested(c *gin.Context) (bool, bool) {
	raw, exists := c.GetQuery("range")
	if !exists {
		return false, true
	}
	value, err := strconv.ParseBool(strings.TrimSpace(raw))
	if err != nil {
		fail(c, http.StatusBadRequest, "range must be true or false")
		return false, false
	}
	return value, true
}

func (s *Server) mediaItemsBaseQuery(
	ctx context.Context,
	uid uint64,
	options mediaQueryOptions,
	albumKey string,
) (*gorm.DB, error) {
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
	query = applyMediaQueryFilters(query, options, uid)

	if albumKey == "" {
		return s.applyVerifiedMediaFolding(ctx, query, options), nil
	}
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
		return s.applyVerifiedMediaFolding(ctx, applyMediaQueryFilters(query, saved.options(), uid), options), nil
	}

	membership := s.DB.WithContext(ctx).
		Table("xd_photo_collection_assets AS pca_media").
		Select("pa_media.primary_node_id").
		Joins("JOIN xd_photo_assets AS pa_media ON pa_media.id = pca_media.asset_id").
		Where("pca_media.collection_id = ? AND pa_media.owner_id = ?", collection.ID, uid)
	return s.applyVerifiedMediaFolding(ctx, query.Where("n.id IN (?)", membership), options), nil
}

func mediaGallerySortClauses(options mediaQueryOptions) []string {
	direction := "DESC"
	if options.SortDir == "asc" {
		direction = "ASC"
	}
	if options.SortBy == "added" {
		return []string{"n.created_at " + direction, "n.id " + direction}
	}
	unknownOrder := "ASC"
	if options.UnknownFirst && options.SortDir == "asc" {
		unknownOrder = "DESC"
	}
	return []string{
		"CASE WHEN xd_media_metadata.captured_at IS NULL THEN 1 ELSE 0 END " + unknownOrder,
		"xd_media_metadata.captured_at " + direction,
		"n.created_at " + direction,
		"n.id " + direction,
	}
}

func (s *Server) materializeMediaItems(
	ctx context.Context,
	uid uint64,
	query *gorm.DB,
	limit, offset int,
	sorts ...mediaQueryOptions,
) ([]mediaItemDTO, error) {
	var options mediaQueryOptions
	if len(sorts) > 0 {
		options = sorts[0]
	}
	var metadata []meta.MediaMetadata
	for _, clause := range mediaGallerySortClauses(options) {
		query = query.Order(clause)
	}
	if err := query.
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
			var memberIDs []uint64
			if options.foldIndex != nil {
				memberIDs = options.foldIndex.members(row.NodeID)
			}
			out = append(out, mediaItemDTO{
				FoldMemberIDs: memberIDs,
				Node:          toNodeDTO(node),
				Metadata:      toMediaMetadataDTO(row),
				AssetKind:     presentation.Kind,
				Favorite:      presentation.Favorite,
				Tags:          presentation.Tags,
				People:        presentation.People,
				Description:   presentation.Description,
				EditRecipe:    presentation.EditRecipe,
				Resources:     presentation.Resources,
				LivePhoto:     standaloneLivePhoto || row.ContainerKind == mediapkg.ContainerKindLIVP,
			})
		}
	}
	return out, nil
}

func (s *Server) materializeMediaItemsByNodeIDs(
	ctx context.Context,
	uid uint64,
	options mediaQueryOptions,
	albumKey string,
	nodeIDs []uint64,
) ([]mediaItemDTO, error) {
	if len(nodeIDs) == 0 {
		return []mediaItemDTO{}, nil
	}
	// Semantic search ranks all in-scope matching copies before choosing
	// the best-relevance representative. Do not independently choose a
	// time-sorted SQL keeper for this already-ranked explicit Node list.
	// Retain options.foldIndex for metadata materialization and fold badges.
	queryOptions := options.withoutSearch()
	queryOptions.foldIndex = nil
	query, err := s.mediaItemsBaseQuery(
		ctx,
		uid,
		queryOptions,
		albumKey,
	)
	if err != nil {
		return nil, err
	}
	query = query.Where("n.id IN ?", nodeIDs)
	items, err := s.materializeMediaItems(ctx, uid, query, len(nodeIDs), 0, options)
	if err != nil {
		return nil, err
	}
	byID := make(map[uint64]mediaItemDTO, len(items))
	for _, item := range items {
		byID[item.Node.ID] = item
	}
	out := make([]mediaItemDTO, 0, len(nodeIDs))
	for _, nodeID := range nodeIDs {
		if item, ok := byID[nodeID]; ok {
			out = append(out, item)
		}
	}
	return out, nil
}

func (s *Server) queryMediaItems(
	ctx context.Context,
	uid uint64,
	options mediaQueryOptions,
	albumKey string,
	limit, offset int,
) ([]mediaItemDTO, error) {
	var err error
	options, err = s.prepareVerifiedMediaFolding(ctx, uid, options)
	if err != nil {
		return nil, err
	}
	if ranked, handled, err := s.semanticRankedMediaNodeIDs(
		ctx,
		uid,
		options,
		albumKey,
	); err != nil {
		return nil, err
	} else if handled {
		return s.materializeMediaItemsByNodeIDs(
			ctx,
			uid,
			options,
			albumKey,
			semanticPage(ranked, limit, offset),
		)
	}
	query, err := s.mediaItemsBaseQuery(ctx, uid, options, albumKey)
	if err != nil {
		return nil, err
	}
	return s.materializeMediaItems(ctx, uid, query, limit, offset, options)
}

const mediaTimelineDayGroupExpression = "CASE WHEN xd_media_metadata.captured_at IS NULL THEN 'unknown' ELSE TO_CHAR(xd_media_metadata.captured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') END"
const mediaAddedDayGroupExpression = "TO_CHAR(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')"

func collapseMediaTimelineGroups(
	groups []mediaTimelineGroupDTO,
	prefixLength int,
) []mediaTimelineGroupDTO {
	out := make([]mediaTimelineGroupDTO, 0, len(groups))
	for _, group := range groups {
		key := group.Key
		if key != "unknown" && len(key) >= prefixLength {
			key = key[:prefixLength]
		}
		if len(out) > 0 && out[len(out)-1].Key == key {
			out[len(out)-1].ItemCount += group.ItemCount
			continue
		}
		out = append(out, mediaTimelineGroupDTO{
			Key:        key,
			ItemCount:  group.ItemCount,
			StartIndex: group.StartIndex,
		})
	}
	return out
}

func mediaTimelineUnknownOrder(options mediaQueryOptions) string {
	if options.SortBy != "added" && options.SortDir == "asc" && options.UnknownFirst {
		return "unknown_rank DESC"
	}
	return "unknown_rank ASC"
}

func queryMediaTimelineGroupSets(query *gorm.DB, sorts ...mediaQueryOptions) (mediaTimelineGroupSetsDTO, error) {
	var options mediaQueryOptions
	if len(sorts) > 0 {
		options = sorts[0]
	}
	expression := mediaTimelineDayGroupExpression
	if options.SortBy == "added" {
		expression = mediaAddedDayGroupExpression
	}
	expression = mediaIANAZoneExpression(expression, options.TimeZone)
	direction := "group_key DESC"
	if options.SortDir == "asc" {
		direction = "group_key ASC"
	}
	unknownRankSQL := "MAX(CASE WHEN xd_media_metadata.captured_at IS NULL THEN 1 ELSE 0 END)"
	// Added-date groups have no unknown date: avoid re-ordering them by
	// unrelated missing capture EXIF from one member.
	if options.SortBy == "added" {
		unknownRankSQL = "0"
	}
	type groupRow struct {
		Key         string `gorm:"column:group_key"`
		ItemCount   int64  `gorm:"column:item_count"`
		UnknownRank int    `gorm:"column:unknown_rank"`
	}

	var rows []groupRow
	if err := query.
		Session(&gorm.Session{}).
		Select(
			expression +
				" AS group_key, COUNT(DISTINCT xd_media_metadata.node_id) AS item_count, " +
				unknownRankSQL + " AS unknown_rank",
		).
		Group(expression).
		Order(mediaTimelineUnknownOrder(options)).
		Order(direction).
		Scan(&rows).Error; err != nil {
		return mediaTimelineGroupSetsDTO{}, err
	}

	day := make([]mediaTimelineGroupDTO, 0, len(rows))
	var startIndex int64
	for _, row := range rows {
		if row.ItemCount <= 0 {
			continue
		}
		day = append(day, mediaTimelineGroupDTO{
			Key:        row.Key,
			ItemCount:  row.ItemCount,
			StartIndex: startIndex,
		})
		startIndex += row.ItemCount
	}
	return mediaTimelineGroupSetsDTO{
		Year:  collapseMediaTimelineGroups(day, 4),
		Month: collapseMediaTimelineGroups(day, 7),
		Day:   day,
	}, nil
}

func (s *Server) queryMediaItemRange(
	ctx context.Context,
	uid uint64,
	options mediaQueryOptions,
	albumKey string,
	limit, offset int,
) (mediaItemRangeDTO, error) {
	var err error
	options, err = s.prepareVerifiedMediaFolding(ctx, uid, options)
	if err != nil {
		return mediaItemRangeDTO{}, err
	}
	if ranked, handled, err := s.semanticRankedMediaNodeIDs(
		ctx,
		uid,
		options,
		albumKey,
	); err != nil {
		return mediaItemRangeDTO{}, err
	} else if handled {
		pageIDs := semanticPage(ranked, limit, offset)
		items, itemErr := s.materializeMediaItemsByNodeIDs(
			ctx,
			uid,
			options,
			albumKey,
			pageIDs,
		)
		if itemErr != nil {
			return mediaItemRangeDTO{}, itemErr
		}
		var anchorIndex *int64
		if options.AnchorNodeID > 0 && offset == 0 {
			for i, nodeID := range ranked {
				if nodeID == options.AnchorNodeID {
					position := int64(i)
					anchorIndex = &position
					break
				}
			}
		}
		return mediaItemRangeDTO{
			AnchorIndex: anchorIndex,
			Items:       items,
			TotalCount:  int64(len(ranked)),
			Offset:      offset,
			Limit:       limit,
			SearchOrder: "relevance",
		}, nil
	}

	query, err := s.mediaItemsBaseQuery(ctx, uid, options, albumKey)
	if err != nil {
		return mediaItemRangeDTO{}, err
	}
	var totalCount int64
	if err := query.
		Session(&gorm.Session{}).
		Distinct("xd_media_metadata.node_id").
		Count(&totalCount).Error; err != nil {
		return mediaItemRangeDTO{}, err
	}

	var timelineGroups []mediaTimelineGroupDTO
	var timelineGroupSets *mediaTimelineGroupSetsDTO
	var anchorIndex *int64
	if offset == 0 {
		var anchorErr error
		anchorIndex, anchorErr = mediaItemAnchorIndex(query, options)
		if anchorErr != nil {
			return mediaItemRangeDTO{}, anchorErr
		}
		sets, groupErr := queryMediaTimelineGroupSets(query, options)
		if groupErr != nil {
			return mediaItemRangeDTO{}, groupErr
		}
		timelineGroups = sets.Month
		timelineGroupSets = &sets
	}

	// Mobile chronological first-open: fetch the last sparse page in reverse
	// index order instead of walking from offset 0 or scanning 100k in Go.
	// The returned offset is aligned to the requested pageSize so primePage()
	// and later viewport ranges share the same sparse-page identity.
	if options.InitialPosition == "latest" && offset == 0 &&
		options.AnchorNodeID == 0 && options.SortDir == "asc" &&
		(options.SortBy == "added" || options.UnknownFirst) && totalCount > 0 {
		reverseOptions := options
		reverseOptions.SortDir = "desc"
		reverseOptions.UnknownFirst = false
		tailCount := int(totalCount % int64(limit))
		if tailCount == 0 {
			tailCount = limit
		}
		items, tailErr := s.materializeMediaItems(ctx, uid, query, tailCount, 0, reverseOptions)
		if tailErr != nil {
			return mediaItemRangeDTO{}, tailErr
		}
		for i, j := 0, len(items)-1; i < j; i, j = i+1, j-1 {
			items[i], items[j] = items[j], items[i]
		}
		tailOffset := int(totalCount) - len(items)
		lastIndex := totalCount - 1
		return mediaItemRangeDTO{
			AnchorIndex:       &lastIndex,
			Items:             items,
			TotalCount:        totalCount,
			Offset:            tailOffset,
			Limit:             limit,
			TimelineGroups:    timelineGroups,
			TimelineGroupSets: timelineGroupSets,
		}, nil
	}
	items, err := s.materializeMediaItems(ctx, uid, query, limit, offset, options)
	if err != nil {
		return mediaItemRangeDTO{}, err
	}
	return mediaItemRangeDTO{
		AnchorIndex:       anchorIndex,
		Items:             items,
		TotalCount:        totalCount,
		Offset:            offset,
		Limit:             limit,
		TimelineGroups:    timelineGroups,
		TimelineGroupSets: timelineGroupSets,
	}, nil
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

func (s *Server) ownedThumbnailNode(
	ctx context.Context,
	uid, id uint64,
) (meta.Node, error) {
	var node meta.Node
	err := s.DB.WithContext(ctx).
		Preload("File").
		Where("id = ? AND owner_id = ?", id, uid).
		First(&node).Error
	return node, err
}

// requireMediaSourceRevision prevents an old or future source revision
// from poisoning a version-scoped browser thumbnail/RAW preview cache.
// Unknown-revision clients continue to use ETag-based revalidation.
func requireMediaSourceRevision(c *gin.Context, current uint64) bool {
	raw, provided := c.GetQuery("revision")
	if !provided {
		return true
	}
	expected, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || expected == 0 {
		c.Header("Cache-Control", "private, no-store")
		fail(c, http.StatusBadRequest, "invalid media source revision")
		return false
	}
	if expected != current {
		c.Header("Cache-Control", "private, no-store")
		revisionConflict(c, expected, current)
		return false
	}
	return true
}

func (s *Server) mediaThumbnail(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid media id")
		return
	}
	node, err := s.ownedThumbnailNode(c.Request.Context(), userID(c), id)
	if err != nil || node.Type != meta.NodeTypeFile || node.File == nil {
		fail(c, http.StatusNotFound, "file not found")
		return
	}
	if !requireMediaSourceRevision(c, node.Revision) {
		return
	}
	metadata, err := s.ensureMediaMetadata(c.Request.Context(), node)
	if err != nil {
		fail(c, http.StatusInternalServerError, "media indexing failed")
		return
	}
	if metadata.MediaKind == meta.MediaKindVideo {
		c.Header("ETag", mediapkg.VideoPosterETag(node.ID, node.Revision, metadata.SHA256))
		c.Header("Cache-Control", "private, max-age=3600")
		if s.tryServeMediaDerivative(
			c,
			mediapkg.VideoPosterStorageKey(node.ID, node.Revision, metadata.SHA256),
			node.Name+".jpg",
			"image/jpeg",
			metadata.UpdatedAt,
		) {
			return
		}
		fail(c, http.StatusNotFound, "video poster is not cached")
		return
	}
	if metadata.MediaKind != meta.MediaKindImage ||
		!mediaThumbnailSupported(metadata) {
		fail(c, http.StatusUnsupportedMediaType, "thumbnail format is not supported")
		return
	}

	c.Header("ETag", mediaThumbnailETag(node, metadata))
	c.Header("Cache-Control", "private, max-age=3600")

	key := mediaThumbnailStorageKey(node, metadata)
	if s.tryServeMediaDerivative(
		c,
		key,
		node.Name+".jpg",
		"image/jpeg",
		metadata.UpdatedAt,
	) {
		return
	}

	key, err = s.ensureMediaDerivative(
		c.Request.Context(),
		node,
		metadata,
		mediaDerivativeRequest{
			Kind:        mediaDerivativeThumbnail,
			Priority:    background.PriorityP0,
			Trigger:     background.TriggerUserAction,
			Initiator:   background.InitiatorUser,
			InitiatorID: node.OwnerID,
			TraceID:     requestIDFromContext(c),
		},
	)
	if err != nil {
		writeMediaDerivativeError(
			c,
			err,
			"thumbnail format is not supported",
		)
		return
	}
	if !s.tryServeMediaDerivative(
		c,
		key,
		node.Name+".jpg",
		"image/jpeg",
		metadata.UpdatedAt,
	) {
		fail(c, http.StatusInternalServerError, "generated thumbnail is unavailable")
	}
}

func (s *Server) putMediaVideoPoster(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid media id")
		return
	}
	expected, ok := expectedRevision(c)
	if !ok {
		return
	}
	node, err := s.ownedThumbnailNode(c.Request.Context(), userID(c), id)
	if err != nil || node.Type != meta.NodeTypeFile || node.File == nil {
		fail(c, http.StatusNotFound, "file not found")
		return
	}
	if node.Revision != expected {
		revisionConflict(c, expected, node.Revision)
		return
	}
	metadata, err := s.ensureMediaMetadata(c.Request.Context(), node)
	if err != nil {
		fail(c, http.StatusInternalServerError, "media indexing failed")
		return
	}
	if metadata.MediaKind != meta.MediaKindVideo {
		fail(c, http.StatusUnsupportedMediaType, "video poster is only supported for video media")
		return
	}
	contentType := strings.ToLower(strings.TrimSpace(strings.SplitN(c.GetHeader("Content-Type"), ";", 2)[0]))
	if contentType != "image/jpeg" {
		fail(c, http.StatusUnsupportedMediaType, "video poster must be image/jpeg")
		return
	}
	data, err := io.ReadAll(io.LimitReader(c.Request.Body, mediaVideoPosterMaxBytes+1))
	if err != nil {
		fail(c, http.StatusBadRequest, "read video poster failed")
		return
	}
	if len(data) == 0 {
		fail(c, http.StatusBadRequest, "video poster is empty")
		return
	}
	if len(data) > mediaVideoPosterMaxBytes {
		fail(c, http.StatusRequestEntityTooLarge, "video poster is too large")
		return
	}
	config, err := jpeg.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		fail(c, http.StatusBadRequest, "video poster is not a valid JPEG")
		return
	}
	if config.Width < 1 || config.Height < 1 ||
		config.Width > mediapkg.VideoPosterEdge ||
		config.Height > mediapkg.VideoPosterEdge {
		fail(c, http.StatusBadRequest, "video poster dimensions exceed the cache contract")
		return
	}

	current, err := s.ownedThumbnailNode(c.Request.Context(), userID(c), id)
	if err != nil || current.Type != meta.NodeTypeFile || current.File == nil {
		fail(c, http.StatusNotFound, "file not found")
		return
	}
	if current.Revision != node.Revision ||
		current.File.SHA256 != node.File.SHA256 ||
		current.File.StorageKey != node.File.StorageKey {
		revisionConflict(c, expected, current.Revision)
		return
	}

	key := mediapkg.VideoPosterStorageKey(node.ID, node.Revision, metadata.SHA256)
	if _, err := s.Store.Put(c.Request.Context(), key, bytes.NewReader(data)); err != nil {
		fail(c, http.StatusInternalServerError, "store video poster failed")
		return
	}
	c.Header("ETag", mediapkg.VideoPosterETag(node.ID, node.Revision, metadata.SHA256))
	c.Status(http.StatusNoContent)
}

const mediaAnalysisPreviewTicketKind = "analysis"

func (s *Server) mediaAnalysisPreview(c *gin.Context) {
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
	if !requireMediaSourceRevision(c, node.Revision) {
		return
	}
	metadata, err := s.ensureMediaMetadata(c.Request.Context(), node)
	if err != nil {
		fail(c, http.StatusInternalServerError, "media indexing failed")
		return
	}
	if metadata.MediaKind != meta.MediaKindImage ||
		!mediaThumbnailSupported(metadata) {
		fail(c, http.StatusUnsupportedMediaType, "analysis preview format is not supported")
		return
	}
	s.serveMediaAnalysisPreview(
		c,
		node,
		metadata,
		"private, max-age=3600",
		mediaDerivativeRequest{
			Kind:        mediaDerivativeAnalysis,
			Priority:    background.PriorityP1,
			Trigger:     background.TriggerUserAction,
			Initiator:   background.InitiatorUser,
			InitiatorID: node.OwnerID,
			TraceID:     requestIDFromContext(c),
		},
	)
}

func (s *Server) mediaAnalysisPreviewTicketStream(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid media id")
		return
	}
	claims, err := s.Auth.ParsePreviewStream(
		strings.TrimSpace(c.Query("ticket")),
	)
	if err != nil ||
		claims.NodeID != id ||
		claims.PreviewKind != mediaAnalysisPreviewTicketKind {
		fail(c, http.StatusUnauthorized, "invalid analysis preview ticket")
		return
	}

	var user meta.User
	if err := s.DB.WithContext(c.Request.Context()).
		First(&user, claims.UserID).Error; err != nil {
		fail(c, http.StatusUnauthorized, "invalid analysis preview ticket")
		return
	}
	if user.DisabledAt != nil ||
		user.MustChangePassword ||
		claims.SessionVersion != user.SessionVersion {
		fail(c, http.StatusUnauthorized, "analysis preview ticket is no longer valid")
		return
	}

	node, err := s.ownedNode(claims.UserID, id, true)
	if err != nil || node.Type != meta.NodeTypeFile || node.File == nil {
		fail(c, http.StatusNotFound, "file not found")
		return
	}
	if node.Revision != claims.NodeRevision {
		fail(c, http.StatusGone, "analysis preview ticket is stale")
		return
	}
	metadata, err := s.ensureMediaMetadata(c.Request.Context(), node)
	if err != nil {
		fail(c, http.StatusInternalServerError, "media indexing failed")
		return
	}
	if metadata.MediaKind != meta.MediaKindImage ||
		!mediaThumbnailSupported(metadata) {
		fail(c, http.StatusUnsupportedMediaType, "analysis preview format is not supported")
		return
	}
	s.serveMediaAnalysisPreview(
		c,
		node,
		metadata,
		"private, no-store",
		mediaDerivativeRequest{
			Kind:      mediaDerivativeAnalysis,
			Priority:  background.PriorityP1,
			Trigger:   background.TriggerSystemEvent,
			Initiator: background.InitiatorService,
			TraceID:   requestIDFromContext(c),
		},
	)
}

func (s *Server) serveMediaAnalysisPreview(
	c *gin.Context,
	node meta.Node,
	metadata meta.MediaMetadata,
	cacheControl string,
	req mediaDerivativeRequest,
) {
	key := mediaAnalysisPreviewStorageKey(node, metadata)
	c.Header("ETag", mediaAnalysisPreviewETag(node, metadata))
	c.Header("Cache-Control", cacheControl)
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header(
		"X-XDrive-Analysis-Preview-Version",
		strconv.Itoa(mediapkg.AnalysisPreviewVersion),
	)
	c.Header(
		"X-XDrive-Analysis-Preview-Edge",
		strconv.Itoa(mediapkg.AnalysisPreviewEdge),
	)

	if s.tryServeMediaDerivative(
		c,
		key,
		node.Name+".analysis.jpg",
		"image/jpeg",
		metadata.UpdatedAt,
	) {
		return
	}

	key, err := s.ensureMediaDerivative(
		c.Request.Context(),
		node,
		metadata,
		req,
	)
	if err != nil {
		writeMediaDerivativeError(
			c,
			err,
			"analysis preview format is not supported",
		)
		return
	}
	if !s.tryServeMediaDerivative(
		c,
		key,
		node.Name+".analysis.jpg",
		"image/jpeg",
		metadata.UpdatedAt,
	) {
		fail(c, http.StatusInternalServerError, "generated analysis preview is unavailable")
	}
}

func (s *Server) mediaImagePreviewSource(
	ctx context.Context,
	node meta.Node,
	metadata meta.MediaMetadata,
	file *os.File,
) (io.ReadSeeker, error) {
	if file == nil {
		return nil, errors.New("stored content is unavailable")
	}
	if metadata.ContainerKind == mediapkg.ContainerKindLIVP {
		resource, err := s.currentMediaDerivedResource(
			ctx,
			node,
			meta.MediaDerivedResourceRoleStill,
		)
		if err != nil {
			return nil, errors.New("live photo still resource is unavailable")
		}
		return io.NewSectionReader(
			file,
			resource.ByteOffset,
			resource.ByteSize,
		), nil
	}
	if strings.EqualFold(
		strings.TrimSpace(metadata.MIMEType),
		"image/x-canon-cr3",
	) {
		preview, err := mediapkg.CR3EmbeddedJPEGPreview(file)
		if err != nil {
			return nil, errors.New("cr3 embedded preview is unavailable")
		}
		return bytes.NewReader(preview), nil
	}
	if mediaUsesTIFFEmbeddedPreview(metadata.MIMEType) {
		preview, err := mediapkg.TIFFEmbeddedJPEGPreview(file)
		if err != nil {
			return nil, errors.New("raw embedded preview is unavailable")
		}
		return bytes.NewReader(preview), nil
	}
	return file, nil
}

func mediaAnalysisPreviewStorageKey(
	node meta.Node,
	row meta.MediaMetadata,
) string {
	return mediapkg.AnalysisPreviewStorageKey(
		node.ID,
		node.Revision,
		row.SHA256,
	)
}

func mediaAnalysisPreviewETag(
	node meta.Node,
	row meta.MediaMetadata,
) string {
	return mediapkg.AnalysisPreviewETag(
		node.ID,
		node.Revision,
		row.SHA256,
	)
}

func mediaUsesTIFFEmbeddedPreview(mimeType string) bool {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/x-adobe-dng", "image/x-nikon-nef", "image/x-sony-arw":
		return true
	default:
		return false
	}
}

func mediaThumbnailSupported(row meta.MediaMetadata) bool {
	if row.ThumbnailKey != "" {
		return true
	}
	mimeType := strings.ToLower(strings.TrimSpace(row.MIMEType))
	if mimeType == "image/x-canon-cr3" || mediaUsesTIFFEmbeddedPreview(mimeType) {
		return true
	}
	if row.ContainerKind == mediapkg.ContainerKindLIVP {
		if descriptor, err := mediapkg.ParseLIVPContainerDescriptor(row.ContainerJSON); err == nil {
			mimeType = strings.ToLower(strings.TrimSpace(descriptor.Still.MIMEType))
		}
	}
	switch mimeType {
	case "image/jpeg", "image/png", "image/gif", "image/webp", "image/avif",
		"image/tiff", "image/bmp", "image/heic", "image/heif":
		return true
	default:
		return false
	}
}

func mediaThumbnailETag(node meta.Node, row meta.MediaMetadata) string {
	if sha := strings.ToLower(strings.TrimSpace(row.SHA256)); sha != "" {
		return fmt.Sprintf(
			"\"media-%s-v%d-%d\"",
			sha,
			mediapkg.ThumbnailVersionForSource(row.MIMEType),
			mediaThumbnailEdge,
		)
	}
	return fmt.Sprintf(
		"\"media-node-%d-%d-v%d-%d\"",
		node.ID,
		node.Revision,
		mediapkg.ThumbnailVersionForSource(row.MIMEType),
		mediaThumbnailEdge,
	)
}

func mediaThumbnailStorageKey(
	node meta.Node,
	row meta.MediaMetadata,
) string {
	return mediapkg.ThumbnailStorageKeyForSource(
		node.ID,
		node.Revision,
		row.SHA256,
		mediaThumbnailEdge,
		row.MIMEType,
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
		(strings.TrimSpace(row.ContainerKind) == "" ||
			row.DerivedResourceVersion < mediapkg.LIVPDerivedResourceVersion)
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
				return mediapkg.LIVPDerivedResourceVersion
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

func (s *Server) refreshMediaIndexForGalleryRead(
	ctx context.Context,
	uid uint64,
	limit int,
) error {
	probe, err := s.staleMediaNodes(ctx, &uid, 1)
	if err != nil {
		return err
	}
	if len(probe) == 0 {
		return nil
	}
	return s.refreshMediaIndexForOwner(ctx, uid, limit)
}

func (s *Server) refreshMediaIndexForOwner(
	ctx context.Context,
	uid uint64,
	limit int,
) error {
	_, _, err := s.refreshMediaIndexOwnerBatch(ctx, uid, limit)
	return err
}

func (s *Server) refreshMediaIndexOwnerBatch(
	ctx context.Context,
	uid uint64,
	limit int,
) (seen, indexed int, err error) {
	if limit <= 0 {
		limit = mediaRequestIndexBatch
	}
	nodes, err := s.staleMediaNodes(ctx, &uid, limit)
	if err != nil {
		return 0, 0, err
	}
	background.ReportProgress(ctx, background.TaskProgress{
		Phase: "indexing",
		Total: int64(len(nodes)),
		Unit:  "item",
	})
	for index := range nodes {
		if err := s.DB.WithContext(ctx).
			Where("node_id = ?", nodes[index].ID).
			First(&nodes[index].File).Error; err != nil {
			continue
		}
		if _, err := s.indexMediaNode(ctx, nodes[index]); err == nil {
			indexed++
		}
		background.ReportProgress(ctx, background.TaskProgress{
			Phase:   "indexing",
			Current: int64(index + 1),
			Total:   int64(len(nodes)),
			Unit:    "item",
		})
	}
	if err := mediagroup.ReconcileLocalEvidenceGroups(ctx, s.DB, uid); err != nil {
		return len(nodes), indexed, err
	}
	if _, err := photoasset.ReconcileOwner(ctx, s.DB, uid); err != nil {
		return len(nodes), indexed, err
	}
	return len(nodes), indexed, nil
}

func (s *Server) staleMediaQuery(
	ctx context.Context,
) *gorm.DB {
	return s.DB.WithContext(ctx).
		Table("xd_nodes AS n").
		Joins("JOIN xd_files AS f ON f.node_id = n.id").
		Joins("LEFT JOIN xd_media_metadata AS mm ON mm.node_id = n.id").
		Where(
			"n.type = ? AND n.deleted_at IS NULL AND "+
				"(mm.node_id IS NULL OR mm.node_revision <> n.revision OR mm.sha256 <> f.sha256 OR "+
				"COALESCE(mm.relation_evidence_version, 0) < ? OR "+
				"(lower(n.name) LIKE '%.livp' AND (COALESCE(mm.container_kind, '') = '' OR "+
				"COALESCE(mm.derived_resource_version, 0) < ?)))",
			meta.NodeTypeFile,
			mediapkg.RelationEvidenceVersion,
			mediapkg.LIVPDerivedResourceVersion,
		)
}

func (s *Server) staleMediaNodes(
	ctx context.Context,
	uid *uint64,
	limit int,
) ([]meta.Node, error) {
	query := s.staleMediaQuery(ctx).
		Select("n.*")
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

func mediaDerivedResourcesFromLIVPContainer(
	raw string,
) ([]meta.MediaDerivedResource, error) {
	descriptor, err := mediapkg.ParseLIVPContainerDescriptor(raw)
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

const mediaLivePhotoStillPreviewKind = "live_still"

type mediaLivePhotoStillDescriptor struct {
	Resource    meta.MediaDerivedResource
	Name        string
	MIMEType    string
	ModifiedAt  time.Time
	Fingerprint string
	ETag        string
}

func mediaLivePhotoStillEmbeddedFingerprint(
	node meta.Node,
	resource meta.MediaDerivedResource,
) string {
	return fmt.Sprintf(
		"livp-still:%d:%d:%s:%d:%d",
		node.ID,
		node.Revision,
		strings.ToLower(strings.TrimSpace(node.File.SHA256)),
		resource.ByteOffset,
		resource.ByteSize,
	)
}

func (s *Server) resolveMediaLivePhotoStill(
	ctx context.Context,
	node meta.Node,
) (mediaLivePhotoStillDescriptor, error) {
	metadata, err := s.ensureMediaMetadata(ctx, node)
	if err != nil {
		return mediaLivePhotoStillDescriptor{}, err
	}
	if metadata.ContainerKind != mediapkg.ContainerKindLIVP {
		return mediaLivePhotoStillDescriptor{}, gorm.ErrRecordNotFound
	}
	resource, err := s.currentMediaDerivedResource(
		ctx,
		node,
		meta.MediaDerivedResourceRoleStill,
	)
	if err != nil {
		return mediaLivePhotoStillDescriptor{}, err
	}
	contentType := strings.TrimSpace(resource.MIMEType)
	if contentType == "" {
		contentType = "image/jpeg"
	}
	return mediaLivePhotoStillDescriptor{
		Resource:    resource,
		Name:        resource.Name,
		MIMEType:    contentType,
		ModifiedAt:  metadata.UpdatedAt,
		Fingerprint: mediaLivePhotoStillEmbeddedFingerprint(node, resource),
		ETag: fmt.Sprintf(
			"\"live-photo-still-%s-%d-%d\"",
			strings.ToLower(strings.TrimSpace(node.File.SHA256)),
			resource.ByteOffset,
			resource.ByteSize,
		),
	}, nil
}

func (s *Server) mediaLivePhotoStillTicket(c *gin.Context) {
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
	descriptor, err := s.resolveMediaLivePhotoStill(c.Request.Context(), node)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "live photo still not found")
		} else {
			fail(c, http.StatusInternalServerError, "resolve live photo still failed")
		}
		return
	}
	user, ok := currentUser(c)
	if !ok {
		fail(c, http.StatusUnauthorized, "user not found")
		return
	}
	ticket, expiresAt, err := s.Auth.IssuePreviewResourceStream(
		user.ID,
		user.SessionVersion,
		node.ID,
		node.Revision,
		mediaLivePhotoStillPreviewKind,
		descriptor.Fingerprint,
		filePreviewTicketTTL,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "create live photo still ticket failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, filePreviewTicketDTO{
		URL: fmt.Sprintf(
			"/api/v1/media-live-photo-still/%d?ticket=%s",
			node.ID,
			url.QueryEscape(ticket),
		),
		ExpiresAt: expiresAt.UTC(),
		Kind:      "image",
		MIMEType:  descriptor.MIMEType,
	})
}

func (s *Server) mediaLivePhotoStillTicketStream(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid media id")
		return
	}
	claims, err := s.Auth.ParsePreviewStream(strings.TrimSpace(c.Query("ticket")))
	if err != nil ||
		claims.NodeID != id ||
		claims.PreviewKind != mediaLivePhotoStillPreviewKind ||
		strings.TrimSpace(claims.ResourceFingerprint) == "" {
		fail(c, http.StatusUnauthorized, "invalid live photo still ticket")
		return
	}

	var user meta.User
	if err := s.DB.WithContext(c.Request.Context()).First(&user, claims.UserID).Error; err != nil {
		fail(c, http.StatusUnauthorized, "invalid live photo still ticket")
		return
	}
	if user.DisabledAt != nil ||
		user.MustChangePassword ||
		claims.SessionVersion != user.SessionVersion {
		fail(c, http.StatusUnauthorized, "live photo still ticket is no longer valid")
		return
	}

	node, err := s.ownedNode(claims.UserID, id, true)
	if err != nil || node.Type != meta.NodeTypeFile || node.File == nil {
		fail(c, http.StatusNotFound, "file not found")
		return
	}
	if node.Revision != claims.NodeRevision {
		fail(c, http.StatusGone, "live photo still ticket is stale")
		return
	}
	descriptor, err := s.resolveMediaLivePhotoStill(c.Request.Context(), node)
	if err != nil || descriptor.Fingerprint != claims.ResourceFingerprint {
		fail(c, http.StatusGone, "live photo still ticket is stale")
		return
	}

	file, err := s.Store.Open(c.Request.Context(), node.File.StorageKey)
	if err != nil {
		fail(c, http.StatusNotFound, "stored content not found")
		return
	}
	defer file.Close()

	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("Content-Type", descriptor.MIMEType)
	c.Header("ETag", descriptor.ETag)
	http.ServeContent(
		c.Writer,
		c.Request,
		descriptor.Name,
		descriptor.ModifiedAt,
		io.NewSectionReader(
			file,
			descriptor.Resource.ByteOffset,
			descriptor.Resource.ByteSize,
		),
	)
}

const mediaLivePhotoMotionPreviewKind = "live_motion"

type mediaLivePhotoMotionDescriptor struct {
	Embedded    bool
	Resource    meta.MediaDerivedResource
	MotionNode  meta.Node
	Name        string
	MIMEType    string
	ModifiedAt  time.Time
	Fingerprint string
	ETag        string
}

func mediaLivePhotoMotionEmbeddedFingerprint(
	node meta.Node,
	resource meta.MediaDerivedResource,
) string {
	return fmt.Sprintf(
		"livp:%d:%d:%s:%d:%d",
		node.ID,
		node.Revision,
		strings.ToLower(strings.TrimSpace(node.File.SHA256)),
		resource.ByteOffset,
		resource.ByteSize,
	)
}

func mediaLivePhotoMotionNodeFingerprint(node meta.Node) string {
	if node.File == nil {
		return ""
	}
	return fmt.Sprintf(
		"node:%d:%d:%s",
		node.ID,
		node.Revision,
		strings.ToLower(strings.TrimSpace(node.File.SHA256)),
	)
}

func (s *Server) resolveMediaLivePhotoMotion(
	ctx context.Context,
	node meta.Node,
) (mediaLivePhotoMotionDescriptor, error) {
	metadata, err := s.ensureMediaMetadata(ctx, node)
	if err != nil {
		return mediaLivePhotoMotionDescriptor{}, err
	}

	if metadata.ContainerKind == mediapkg.ContainerKindLIVP {
		resource, err := s.currentMediaDerivedResource(
			ctx,
			node,
			meta.MediaDerivedResourceRoleMotion,
		)
		if err != nil {
			return mediaLivePhotoMotionDescriptor{}, err
		}
		contentType := strings.TrimSpace(resource.MIMEType)
		if contentType == "" {
			contentType = "video/quicktime"
		}
		return mediaLivePhotoMotionDescriptor{
			Embedded:    true,
			Resource:    resource,
			Name:        resource.Name,
			MIMEType:    contentType,
			ModifiedAt:  metadata.UpdatedAt,
			Fingerprint: mediaLivePhotoMotionEmbeddedFingerprint(node, resource),
			ETag: fmt.Sprintf(
				"\"live-photo-motion-%s-%d-%d\"",
				strings.ToLower(strings.TrimSpace(node.File.SHA256)),
				resource.ByteOffset,
				resource.ByteSize,
			),
		}, nil
	}

	motionNode, motionMetadata, err := s.standaloneLivePhotoMotion(
		ctx,
		node.ID,
		node.OwnerID,
	)
	if err != nil {
		return mediaLivePhotoMotionDescriptor{}, err
	}
	contentType := strings.TrimSpace(motionMetadata.MIMEType)
	if contentType == "" {
		contentType = "video/quicktime"
	}
	return mediaLivePhotoMotionDescriptor{
		MotionNode:  motionNode,
		Name:        motionNode.Name,
		MIMEType:    contentType,
		ModifiedAt:  motionMetadata.UpdatedAt,
		Fingerprint: mediaLivePhotoMotionNodeFingerprint(motionNode),
		ETag: fmt.Sprintf(
			"\"live-photo-motion-%s\"",
			strings.ToLower(strings.TrimSpace(motionNode.File.SHA256)),
		),
	}, nil
}

func (s *Server) mediaLivePhotoMotionTicket(c *gin.Context) {
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
	descriptor, err := s.resolveMediaLivePhotoMotion(c.Request.Context(), node)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "live photo motion not found")
		} else {
			fail(c, http.StatusInternalServerError, "resolve live photo motion failed")
		}
		return
	}
	user, ok := currentUser(c)
	if !ok {
		fail(c, http.StatusUnauthorized, "user not found")
		return
	}
	ticket, expiresAt, err := s.Auth.IssuePreviewResourceStream(
		user.ID,
		user.SessionVersion,
		node.ID,
		node.Revision,
		mediaLivePhotoMotionPreviewKind,
		descriptor.Fingerprint,
		filePreviewTicketTTL,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "create live photo motion ticket failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, filePreviewTicketDTO{
		URL: fmt.Sprintf(
			"/api/v1/media-live-photo-motion/%d?ticket=%s",
			node.ID,
			url.QueryEscape(ticket),
		),
		ExpiresAt: expiresAt.UTC(),
		Kind:      "video",
		MIMEType:  descriptor.MIMEType,
	})
}

func (s *Server) mediaLivePhotoMotionTicketStream(c *gin.Context) {
	id, ok := parseID(c.Param("id"))
	if !ok {
		fail(c, http.StatusBadRequest, "invalid media id")
		return
	}
	claims, err := s.Auth.ParsePreviewStream(strings.TrimSpace(c.Query("ticket")))
	if err != nil ||
		claims.NodeID != id ||
		claims.PreviewKind != mediaLivePhotoMotionPreviewKind ||
		strings.TrimSpace(claims.ResourceFingerprint) == "" {
		fail(c, http.StatusUnauthorized, "invalid live photo motion ticket")
		return
	}

	var user meta.User
	if err := s.DB.WithContext(c.Request.Context()).First(&user, claims.UserID).Error; err != nil {
		fail(c, http.StatusUnauthorized, "invalid live photo motion ticket")
		return
	}
	if user.DisabledAt != nil ||
		user.MustChangePassword ||
		claims.SessionVersion != user.SessionVersion {
		fail(c, http.StatusUnauthorized, "live photo motion ticket is no longer valid")
		return
	}

	node, err := s.ownedNode(claims.UserID, id, true)
	if err != nil || node.Type != meta.NodeTypeFile || node.File == nil {
		fail(c, http.StatusNotFound, "file not found")
		return
	}
	if node.Revision != claims.NodeRevision {
		fail(c, http.StatusGone, "live photo motion ticket is stale")
		return
	}
	descriptor, err := s.resolveMediaLivePhotoMotion(c.Request.Context(), node)
	if err != nil || descriptor.Fingerprint != claims.ResourceFingerprint {
		fail(c, http.StatusGone, "live photo motion ticket is stale")
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Referrer-Policy", "no-referrer")
	s.serveMediaLivePhotoMotion(c, node, descriptor)
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
	descriptor, err := s.resolveMediaLivePhotoMotion(c.Request.Context(), node)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "live photo motion not found")
		} else {
			fail(c, http.StatusInternalServerError, "resolve live photo motion failed")
		}
		return
	}
	s.serveMediaLivePhotoMotion(c, node, descriptor)
}

func (s *Server) serveMediaLivePhotoMotion(
	c *gin.Context,
	stillNode meta.Node,
	descriptor mediaLivePhotoMotionDescriptor,
) {
	var storageKey string
	if descriptor.Embedded {
		storageKey = stillNode.File.StorageKey
	} else if descriptor.MotionNode.File != nil {
		storageKey = descriptor.MotionNode.File.StorageKey
	}
	if strings.TrimSpace(storageKey) == "" {
		fail(c, http.StatusNotFound, "stored content not found")
		return
	}
	file, err := s.Store.Open(c.Request.Context(), storageKey)
	if err != nil {
		fail(c, http.StatusNotFound, "stored content not found")
		return
	}
	defer file.Close()

	if c.Writer.Header().Get("Cache-Control") == "" {
		c.Header("Cache-Control", "private, max-age=3600")
	}
	c.Header("Content-Type", descriptor.MIMEType)
	c.Header("ETag", descriptor.ETag)
	if descriptor.Embedded {
		http.ServeContent(
			c.Writer,
			c.Request,
			descriptor.Name,
			descriptor.ModifiedAt,
			io.NewSectionReader(
				file,
				descriptor.Resource.ByteOffset,
				descriptor.Resource.ByteSize,
			),
		)
		return
	}
	http.ServeContent(
		c.Writer,
		c.Request,
		descriptor.Name,
		descriptor.ModifiedAt,
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
