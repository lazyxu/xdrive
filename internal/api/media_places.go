package api

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
	"gorm.io/gorm"
)

const (
	mediaPlaceCellScale    int64 = 100
	mediaPlaceDefaultLimit       = 24
	mediaPlaceMaxLimit           = 1000
)

type mediaPlaceCell struct {
	Latitude  int64
	Longitude int64
}

type mediaPlaceDTO struct {
	ID             string     `json:"id"`
	Name           string     `json:"name"`
	Latitude       float64    `json:"latitude"`
	Longitude      float64    `json:"longitude"`
	ItemCount      int64      `json:"item_count"`
	CoverNodeID    *uint64    `json:"cover_node_id,omitempty"`
	UpdatedAt      *time.Time `json:"updated_at,omitempty"`
	Attribution    string     `json:"attribution,omitempty"`
	AttributionURL string     `json:"attribution_url,omitempty"`
}

func mediaPlaceKey(cell mediaPlaceCell) string {
	return fmt.Sprintf("place:%d:%d", cell.Latitude, cell.Longitude)
}

func parseMediaPlaceKey(value string) (mediaPlaceCell, bool) {
	parts := strings.Split(strings.TrimSpace(value), ":")
	if len(parts) != 3 || parts[0] != "place" {
		return mediaPlaceCell{}, false
	}
	latitude, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || latitude < -90*mediaPlaceCellScale || latitude > 90*mediaPlaceCellScale {
		return mediaPlaceCell{}, false
	}
	longitude, err := strconv.ParseInt(parts[2], 10, 64)
	if err != nil || longitude < -180*mediaPlaceCellScale || longitude > 180*mediaPlaceCellScale {
		return mediaPlaceCell{}, false
	}
	return mediaPlaceCell{Latitude: latitude, Longitude: longitude}, true
}

func mediaPlaceBounds(cell mediaPlaceCell) (float64, float64, float64, float64) {
	scale := float64(mediaPlaceCellScale)
	return float64(cell.Latitude) / scale,
		float64(cell.Latitude+1) / scale,
		float64(cell.Longitude) / scale,
		float64(cell.Longitude+1) / scale
}

func mediaPlaceCenter(cell mediaPlaceCell) (float64, float64) {
	latMin, latMax, lonMin, lonMax := mediaPlaceBounds(cell)
	return math.Max(-90, math.Min(90, (latMin+latMax)/2)),
		math.Max(-180, math.Min(180, (lonMin+lonMax)/2))
}

func mediaPlaceName(cell mediaPlaceCell) string {
	latitude, longitude := mediaPlaceCenter(cell)
	return fmt.Sprintf("约 %.3f°, %.3f°", latitude, longitude)
}

func (s *Server) listMediaPlaces(c *gin.Context) {
	if err := s.refreshMediaIndexForGalleryRead(
		c.Request.Context(),
		userID(c),
		mediaRequestIndexBatch,
	); err != nil {
		fail(c, http.StatusInternalServerError, "refresh media projection failed")
		return
	}

	limit := mediaPlaceDefaultLimit
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > mediaPlaceMaxLimit {
			fail(c, http.StatusBadRequest, "limit must be between 1 and 1000")
			return
		}
		limit = value
	}

	items, err := queryMediaPlaces(
		c.Request.Context(),
		s.DB,
		userID(c),
		limit,
	)
	if err != nil {
		fail(c, http.StatusInternalServerError, "list media places failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, items)
}

func queryMediaPlaces(
	ctx context.Context,
	db *gorm.DB,
	ownerID uint64,
	limit int,
) ([]mediaPlaceDTO, error) {
	if db == nil || ownerID == 0 {
		return nil, fmt.Errorf("media place query is not configured")
	}
	if limit <= 0 || limit > mediaPlaceMaxLimit {
		limit = mediaPlaceDefaultLimit
	}

	thumbnailMIMEs := []string{
		"image/jpeg", "image/png", "image/gif", "image/webp", "image/avif",
		"image/tiff", "image/bmp", "image/heic", "image/heif", "image/x-adobe-dng",
	}
	latExpr := fmt.Sprintf(
		"FLOOR(xd_media_metadata.latitude * %d)::bigint",
		mediaPlaceCellScale,
	)
	lonExpr := fmt.Sprintf(
		"FLOOR(xd_media_metadata.longitude * %d)::bigint",
		mediaPlaceCellScale,
	)

	type row struct {
		LatitudeCell  int64
		LongitudeCell int64
		ItemCount     int64
		CoverNodeID   *uint64
		UpdatedAt     *time.Time
		ResolvedName  string
		Resolver      string
	}
	var rows []row
	if err := db.WithContext(ctx).
		Model(&meta.MediaMetadata{}).
		Select(
			latExpr+" AS latitude_cell, "+
				lonExpr+" AS longitude_cell, "+
				"COUNT(DISTINCT pa.id) AS item_count, "+
				"MIN(CASE WHEN lower(xd_media_metadata.mime_type) IN ? THEN pa.primary_node_id ELSE NULL END) AS cover_node_id, "+
				"MAX(COALESCE(xd_media_metadata.captured_at, n.created_at)) AS updated_at, "+
				"MIN(NULLIF(ppl.formatted, '')) AS resolved_name, "+
				"MIN(NULLIF(ppl.resolver, '')) AS resolver",
			thumbnailMIMEs,
		).
		Joins(
			"JOIN xd_photo_assets AS pa ON pa.primary_node_id = xd_media_metadata.node_id AND pa.owner_id = ?",
			ownerID,
		).
		Joins("JOIN xd_nodes AS n ON n.id = xd_media_metadata.node_id AND n.deleted_at IS NULL").
		Joins(
			"LEFT JOIN xd_photo_place_labels AS ppl ON ppl.asset_id = pa.id "+
				"AND ppl.latitude = xd_media_metadata.latitude "+
				"AND ppl.longitude = xd_media_metadata.longitude",
		).
		Where(
			"xd_media_metadata.owner_id = ? AND xd_media_metadata.index_state = ? AND "+
				"xd_media_metadata.media_kind IN ? AND "+
				"xd_media_metadata.latitude IS NOT NULL AND xd_media_metadata.longitude IS NOT NULL AND "+
				"xd_media_metadata.latitude BETWEEN -90 AND 90 AND "+
				"xd_media_metadata.longitude BETWEEN -180 AND 180",
			ownerID,
			meta.MediaIndexStateReady,
			[]string{meta.MediaKindImage, meta.MediaKindVideo},
		).
		Group(latExpr + ", " + lonExpr).
		Order("item_count DESC, updated_at DESC NULLS LAST, latitude_cell ASC, longitude_cell ASC").
		Limit(limit).
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	out := make([]mediaPlaceDTO, 0, len(rows))
	for _, row := range rows {
		cell := mediaPlaceCell{
			Latitude:  row.LatitudeCell,
			Longitude: row.LongitudeCell,
		}
		latitude, longitude := mediaPlaceCenter(cell)
		name := strings.TrimSpace(row.ResolvedName)
		if name == "" {
			name = mediaPlaceName(cell)
		}
		item := mediaPlaceDTO{
			ID:          mediaPlaceKey(cell),
			Name:        name,
			Latitude:    latitude,
			Longitude:   longitude,
			ItemCount:   row.ItemCount,
			CoverNodeID: row.CoverNodeID,
			UpdatedAt:   row.UpdatedAt,
		}
		if strings.TrimSpace(row.ResolvedName) != "" &&
			strings.TrimSpace(row.Resolver) == photointelligence.GeoNamesResolverName {
			item.Attribution = photointelligence.GeoNamesAttribution
			item.AttributionURL = "https://www.geonames.org/"
		}
		out = append(out, item)
	}
	return out, nil
}
