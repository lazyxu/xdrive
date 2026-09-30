package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
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
	MediaKind       string         `json:"media_kind"`
	MIMEType        string         `json:"mime_type,omitempty"`
	Width           int            `json:"width,omitempty"`
	Height          int            `json:"height,omitempty"`
	Orientation     int            `json:"orientation,omitempty"`
	RotationDegrees int            `json:"rotation_degrees,omitempty"`
	DurationMS      int64          `json:"duration_ms,omitempty"`
	FrameRate       float64        `json:"frame_rate,omitempty"`
	BitRate         int64          `json:"bit_rate,omitempty"`
	VideoCodec      string         `json:"video_codec,omitempty"`
	AudioCodec      string         `json:"audio_codec,omitempty"`
	CapturedAt      *time.Time     `json:"captured_at,omitempty"`
	Latitude        *float64       `json:"latitude,omitempty"`
	Longitude       *float64       `json:"longitude,omitempty"`
	AltitudeM       *float64       `json:"altitude_m,omitempty"`
	CameraMake      string         `json:"camera_make,omitempty"`
	CameraModel     string         `json:"camera_model,omitempty"`
	LensModel       string         `json:"lens_model,omitempty"`
	EXIF            map[string]any `json:"exif,omitempty"`
	Video           map[string]any `json:"video,omitempty"`
	IndexState      string         `json:"index_state"`
	IndexError      string         `json:"index_error,omitempty"`
	HasThumbnail    bool           `json:"has_thumbnail"`
	ThumbnailMIME   string         `json:"thumbnail_mime_type,omitempty"`
	ThumbnailWidth  int            `json:"thumbnail_width,omitempty"`
	ThumbnailHeight int            `json:"thumbnail_height,omitempty"`
}

type mediaItemDTO struct {
	Node     nodeDTO          `json:"node"`
	Metadata mediaMetadataDTO `json:"metadata"`
}

type mediaAlbumDTO struct {
	ID          string     `json:"id"`
	Kind        string     `json:"kind"`
	Name        string     `json:"name"`
	ItemCount   int64      `json:"item_count"`
	CoverNodeID *uint64    `json:"cover_node_id,omitempty"`
	UpdatedAt   *time.Time `json:"updated_at,omitempty"`
}

func toMediaMetadataDTO(row meta.MediaMetadata) mediaMetadataDTO {
	out := mediaMetadataDTO{
		MediaKind:       row.MediaKind,
		MIMEType:        row.MIMEType,
		Width:           row.Width,
		Height:          row.Height,
		Orientation:     row.Orientation,
		RotationDegrees: row.RotationDegrees,
		DurationMS:      row.DurationMS,
		FrameRate:       row.FrameRate,
		BitRate:         row.BitRate,
		VideoCodec:      row.VideoCodec,
		AudioCodec:      row.AudioCodec,
		CapturedAt:      row.CapturedAt,
		Latitude:        row.Latitude,
		Longitude:       row.Longitude,
		AltitudeM:       row.AltitudeM,
		CameraMake:      row.CameraMake,
		CameraModel:     row.CameraModel,
		LensModel:       row.LensModel,
		IndexState:      row.IndexState,
		IndexError:      row.IndexError,
		HasThumbnail:    mediaThumbnailSupported(row),
		ThumbnailMIME:   row.ThumbnailMIMEType,
		ThumbnailWidth:  row.ThumbnailWidth,
		ThumbnailHeight: row.ThumbnailHeight,
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
	kind := strings.TrimSpace(c.Query("kind"))
	if kind != "" && kind != meta.MediaKindImage && kind != meta.MediaKindVideo {
		fail(c, http.StatusBadRequest, "kind must be image or video")
		return
	}
	limit, offset, ok := mediaListWindow(c)
	if !ok {
		return
	}
	_ = s.refreshMediaIndexForOwner(
		c.Request.Context(),
		userID(c),
		mediaRequestIndexBatch,
	)
	items, err := s.queryMediaItems(
		c.Request.Context(),
		userID(c),
		kind,
		"",
		0,
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
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, mediaItemDTO{
		Node:     toNodeDTO(node),
		Metadata: toMediaMetadataDTO(metadata),
	})
}

func (s *Server) listMediaAlbums(c *gin.Context) {
	_ = s.refreshMediaIndexForOwner(
		c.Request.Context(),
		userID(c),
		mediaRequestIndexBatch,
	)
	uid := userID(c)
	thumbnailMIMEs := []string{"image/jpeg", "image/png", "image/gif"}

	type albumRow struct {
		ID          uint64
		Name        string
		ItemCount   int64
		CoverNodeID *uint64
		UpdatedAt   *time.Time
	}

	var folders []albumRow
	if err := s.DB.WithContext(c.Request.Context()).
		Table("xd_media_metadata AS mm").
		Select(
			"p.id, p.name, COUNT(*) AS item_count, "+
				"MIN(CASE WHEN lower(mm.mime_type) IN ? THEN n.id ELSE NULL END) AS cover_node_id, "+
				"MAX(COALESCE(mm.captured_at, n.updated_at)) AS updated_at",
			thumbnailMIMEs,
		).
		Joins("JOIN xd_nodes AS n ON n.id = mm.node_id AND n.deleted_at IS NULL").
		Joins("JOIN xd_nodes AS p ON p.id = n.parent_id AND p.deleted_at IS NULL").
		Where(
			"mm.owner_id = ? AND mm.media_kind IN ?",
			uid,
			[]string{meta.MediaKindImage, meta.MediaKindVideo},
		).
		Group("p.id, p.name").
		Order("updated_at DESC, lower(p.name) ASC").
		Scan(&folders).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list media albums failed")
		return
	}

	result := make([]mediaAlbumDTO, 0, len(folders)+16)
	for _, row := range folders {
		result = append(result, mediaAlbumDTO{
			ID:          fmt.Sprintf("folder:%d", row.ID),
			Kind:        "folder",
			Name:        row.Name,
			ItemCount:   row.ItemCount,
			CoverNodeID: row.CoverNodeID,
			UpdatedAt:   row.UpdatedAt,
		})
	}

	var imported []albumRow
	if err := s.DB.WithContext(c.Request.Context()).
		Table("xd_source_collections AS sc").
		Select(
			"sc.id, sc.name, COUNT(DISTINCT si.node_id) AS item_count, "+
				"MIN(CASE WHEN lower(mm.mime_type) IN ? THEN n.id ELSE NULL END) AS cover_node_id, "+
				"MAX(COALESCE(mm.captured_at, n.updated_at)) AS updated_at",
			thumbnailMIMEs,
		).
		Joins("JOIN xd_sources AS src ON src.id = sc.source_id").
		Joins("JOIN xd_source_collection_items AS ci ON ci.collection_id = sc.id").
		Joins(
			"JOIN xd_source_items AS si ON si.id = ci.source_item_id AND si.node_id IS NOT NULL",
		).
		Joins("JOIN xd_nodes AS n ON n.id = si.node_id AND n.deleted_at IS NULL").
		Joins(
			"JOIN xd_media_metadata AS mm ON mm.node_id = n.id AND mm.media_kind IN ?",
			[]string{meta.MediaKindImage, meta.MediaKindVideo},
		).
		Where(
			"src.owner_id = ? AND sc.state = ? AND sc.kind = ?",
			uid,
			meta.SourceCollectionStateActive,
			"album",
		).
		Group("sc.id, sc.name").
		Order("updated_at DESC, lower(sc.name) ASC").
		Scan(&imported).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list imported media albums failed")
		return
	}
	for _, row := range imported {
		result = append(result, mediaAlbumDTO{
			ID:          fmt.Sprintf("source:%d", row.ID),
			Kind:        "imported",
			Name:        row.Name,
			ItemCount:   row.ItemCount,
			CoverNodeID: row.CoverNodeID,
			UpdatedAt:   row.UpdatedAt,
		})
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, result)
}

func (s *Server) listMediaAlbumItems(c *gin.Context) {
	raw := strings.TrimSpace(c.Param("albumID"))
	parts := strings.SplitN(raw, ":", 2)
	if len(parts) != 2 {
		fail(c, http.StatusBadRequest, "invalid media album id")
		return
	}
	id, err := strconv.ParseUint(parts[1], 10, 64)
	if err != nil || id == 0 {
		fail(c, http.StatusBadRequest, "invalid media album id")
		return
	}
	limit, offset, ok := mediaListWindow(c)
	if !ok {
		return
	}
	items, err := s.queryMediaItems(
		c.Request.Context(),
		userID(c),
		"",
		parts[0],
		id,
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
	kind, albumKind string,
	albumID uint64,
	limit, offset int,
) ([]mediaItemDTO, error) {
	query := s.DB.WithContext(ctx).
		Model(&meta.MediaMetadata{}).
		Joins(
			"JOIN xd_nodes AS n ON n.id = xd_media_metadata.node_id AND n.deleted_at IS NULL",
		).
		Where(
			"xd_media_metadata.owner_id = ? AND xd_media_metadata.media_kind IN ?",
			uid,
			[]string{meta.MediaKindImage, meta.MediaKindVideo},
		)
	if kind != "" {
		query = query.Where("xd_media_metadata.media_kind = ?", kind)
	}

	switch albumKind {
	case "":
	case "folder":
		var folder meta.Node
		if err := s.DB.WithContext(ctx).
			Where(
				"id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
				albumID,
				uid,
				meta.NodeTypeDir,
			).
			First(&folder).Error; err != nil {
			return nil, err
		}
		query = query.Where("n.parent_id = ?", albumID)
	case "source":
		var count int64
		if err := s.DB.WithContext(ctx).
			Table("xd_source_collections AS sc").
			Joins("JOIN xd_sources AS src ON src.id = sc.source_id").
			Where(
				"sc.id = ? AND src.owner_id = ? AND sc.state = ? AND sc.kind = ?",
				albumID,
				uid,
				meta.SourceCollectionStateActive,
				"album",
			).
			Count(&count).Error; err != nil {
			return nil, err
		}
		if count == 0 {
			return nil, gorm.ErrRecordNotFound
		}
		membership := s.DB.WithContext(ctx).
			Table("xd_source_items AS si_media").
			Select("si_media.node_id").
			Joins(
				"JOIN xd_source_collection_items AS ci_media ON ci_media.source_item_id = si_media.id",
			).
			Where(
				"ci_media.collection_id = ? AND si_media.node_id IS NOT NULL",
				albumID,
			)
		query = query.Where("n.id IN (?)", membership)
	default:
		return nil, gorm.ErrRecordNotFound
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

	out := make([]mediaItemDTO, 0, len(metadata))
	for _, row := range metadata {
		if node, ok := byID[row.NodeID]; ok {
			out = append(out, mediaItemDTO{
				Node:     toNodeDTO(node),
				Metadata: toMediaMetadataDTO(row),
			})
		}
	}
	return out, nil
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

	thumbnail, err := mediapkg.ThumbnailJPEG(
		file,
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
	switch strings.ToLower(strings.TrimSpace(row.MIMEType)) {
	case "image/jpeg", "image/png", "image/gif":
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
		current.SHA256 == node.File.SHA256 {
		return current, nil
	}
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return current, err
	}
	return s.indexMediaNode(ctx, node)
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
		NodeID:          node.ID,
		OwnerID:         node.OwnerID,
		NodeRevision:    node.Revision,
		SHA256:          node.File.SHA256,
		MediaKind:       kind,
		MIMEType:        extracted.MIMEType,
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

	err = s.DB.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "node_id"}},
			DoUpdates: clause.AssignmentColumns([]string{
				"owner_id",
				"node_revision",
				"sha256",
				"media_kind",
				"mime_type",
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
		Create(&out).Error
	return out, err
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
	return nil
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
	for index := range nodes {
		if err := s.DB.WithContext(ctx).
			Where("node_id = ?", nodes[index].ID).
			First(&nodes[index].File).Error; err != nil {
			continue
		}
		_, _ = s.indexMediaNode(ctx, nodes[index])
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
				"(mm.node_id IS NULL OR mm.node_revision <> n.revision OR mm.sha256 <> f.sha256)",
			meta.NodeTypeFile,
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
