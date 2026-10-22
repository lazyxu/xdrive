package api

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Native map frames contain at most 64 real Owner GPS representatives.
// Baidu, not xDrive, still owns the actual on-screen clustering/projection.
const mediaMapOverviewAxis = 8
const mediaMapOverviewMaxPoints = mediaMapOverviewAxis * mediaMapOverviewAxis

type mediaPlacesMapOverviewDTO struct {
	Items           []mediaPlaceDTO `json:"items"`
	TotalPhotoCount int64           `json:"total_photo_count"`
	Aggregated      bool            `json:"aggregated"`
}

func parseMediaMapOverviewQuery(raw string) (mediaPlaceViewportBounds, bool, error) {
	var empty mediaPlaceViewportBounds
	values, err := url.ParseQuery(raw)
	if err != nil {
		return empty, false, fmt.Errorf("invalid map overview query")
	}
	for key := range values {
		if key != "west" && key != "south" && key != "east" && key != "north" && key != "detail" {
			return empty, false, fmt.Errorf("unknown map overview query")
		}
	}
	detail := false
	if rawDetail, found := values["detail"]; found {
		if len(rawDetail) != 1 || (rawDetail[0] != "0" && rawDetail[0] != "1") {
			return empty, false, fmt.Errorf("invalid map detail")
		}
		detail = rawDetail[0] == "1"
		values.Del("detail")
	}
	values.Set("limit", strconv.Itoa(mediaMapOverviewMaxPoints))
	values.Set("offset", "0")
	bounds, _, _, err := parseMediaPlaceViewport(values.Encode())
	if err != nil {
		return empty, false, err
	}
	return bounds, detail, nil
}

// Only finite, parsed WGS84 viewport values become numeric SQL constants.
// Eight longitudinal buckets handle west > east at the date line.
func mediaMapOverviewBuckets(bounds mediaPlaceViewportBounds) (string, string) {
	format := func(n float64) string { return strconv.FormatFloat(n, 'f', -1, 64) }
	latSpan := bounds.North - bounds.South
	lonSpan := bounds.East - bounds.West
	lonExpr := "xd_media_metadata.longitude"
	if bounds.West > bounds.East {
		lonSpan += 360
		lonExpr = fmt.Sprintf("(CASE WHEN xd_media_metadata.longitude < %s THEN xd_media_metadata.longitude + 360 ELSE xd_media_metadata.longitude END)", format(bounds.West))
	}
	row := fmt.Sprintf("LEAST(7, GREATEST(0, FLOOR((xd_media_metadata.latitude - %s) / %s * 8)))::int", format(bounds.South), format(latSpan))
	col := fmt.Sprintf("LEAST(7, GREATEST(0, FLOOR((%s - %s) / %s * 8)))::int", lonExpr, format(bounds.West), format(lonSpan))
	return row, col
}

func queryMediaPlacesMapOverview(
	ctx context.Context, db *gorm.DB, ownerID uint64,
	bounds mediaPlaceViewportBounds, detail bool,
) (mediaPlacesMapOverviewDTO, error) {
	if ctx == nil || ctx.Err() != nil || db == nil || ownerID == 0 || !bounds.valid() {
		return mediaPlacesMapOverviewDTO{}, fmt.Errorf("invalid map overview")
	}
	if detail {
		page, err := queryMediaPlacesViewport(ctx, db, ownerID, bounds, mediaMapOverviewMaxPoints, 0)
		if err != nil {
			return mediaPlacesMapOverviewDTO{}, err
		}
		// Exact historical place IDs are allowed ONLY when the returned page
		// covers the whole selection; never turn a partial top-N into a map.
		if !page.HasMore && page.TotalCount <= mediaMapOverviewMaxPoints {
			return mediaPlacesMapOverviewDTO{
				Items: page.Items, TotalPhotoCount: page.TotalPhotoCount, Aggregated: false,
			}, nil
		}
	}
	rowExpr, colExpr := mediaMapOverviewBuckets(bounds)
	type row struct {
		BucketRow       int
		BucketCol       int
		SampleLatitude  float64
		SampleLongitude float64
		ItemCount       int64
		CoverNodeID     *uint64
	}
	thumbnailMIMEs := []string{
		"image/jpeg", "image/png", "image/gif", "image/webp", "image/avif",
		"image/tiff", "image/bmp", "image/heic", "image/heif", "image/x-adobe-dng",
	}
	var rows []row
	err := mediaPlacesWithinViewport(mediaPlacesBaseQuery(ctx, db, ownerID), bounds).
		Select(rowExpr+" AS bucket_row, "+colExpr+" AS bucket_col, "+
			"(ARRAY_AGG(xd_media_metadata.latitude ORDER BY pa.primary_node_id))[1] AS sample_latitude, "+
			"(ARRAY_AGG(xd_media_metadata.longitude ORDER BY pa.primary_node_id))[1] AS sample_longitude, "+
			"COUNT(DISTINCT pa.id) AS item_count, "+
			"MIN(CASE WHEN lower(xd_media_metadata.mime_type) IN ? THEN pa.primary_node_id ELSE NULL END) AS cover_node_id",
			thumbnailMIMEs).
		Group(rowExpr + ", " + colExpr).
		Order("item_count DESC, bucket_row ASC, bucket_col ASC").
		Limit(mediaMapOverviewMaxPoints + 1).
		Scan(&rows).Error
	if err != nil {
		return mediaPlacesMapOverviewDTO{}, err
	}
	if len(rows) > mediaMapOverviewMaxPoints {
		return mediaPlacesMapOverviewDTO{}, fmt.Errorf("map overview exceeds spatial budget")
	}
	out := mediaPlacesMapOverviewDTO{Items: make([]mediaPlaceDTO, 0, len(rows)), Aggregated: true}
	for _, item := range rows {
		if item.BucketRow < 0 || item.BucketRow >= mediaMapOverviewAxis ||
			item.BucketCol < 0 || item.BucketCol >= mediaMapOverviewAxis ||
			item.ItemCount < 1 || math.Abs(item.SampleLatitude) > 90 ||
			math.Abs(item.SampleLongitude) > 180 {
			return mediaPlacesMapOverviewDTO{}, fmt.Errorf("invalid spatial summary")
		}
		out.TotalPhotoCount += item.ItemCount
		out.Items = append(out.Items, mediaPlaceDTO{
			ID: fmt.Sprintf("map-region:%s:%s:%s:%s:%d:%d",
				strconv.FormatFloat(bounds.West, 'f', -1, 64),
				strconv.FormatFloat(bounds.South, 'f', -1, 64),
				strconv.FormatFloat(bounds.East, 'f', -1, 64),
				strconv.FormatFloat(bounds.North, 'f', -1, 64),
				item.BucketRow, item.BucketCol),
			Name:            fmt.Sprintf("照片区域 %d-%d", item.BucketRow+1, item.BucketCol+1),
			Latitude:        item.SampleLatitude,
			Longitude:       item.SampleLongitude,
			SampleLatitude:  item.SampleLatitude,
			SampleLongitude: item.SampleLongitude,
			CoordinateKind:  "map_region_sample",
			ItemCount:       item.ItemCount,
			CoverNodeID:     item.CoverNodeID,
		})
	}
	return out, nil
}

func (s *Server) listMediaPlacesMapOverview(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("X-Content-Type-Options", "nosniff")
	bounds, detail, err := parseMediaMapOverviewQuery(c.Request.URL.RawQuery)
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid map overview")
		return
	}
	if err = s.refreshMediaIndexForGalleryRead(c.Request.Context(), userID(c), mediaRequestIndexBatch); err != nil {
		fail(c, http.StatusInternalServerError, "refresh media projection failed")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), mediaPlaceViewportQueryTimeout)
	defer cancel()
	result, err := queryMediaPlacesMapOverview(ctx, s.DB, userID(c), bounds, detail)
	if err != nil {
		if ctx.Err() != nil {
			fail(c, http.StatusGatewayTimeout, "map overview query cancelled or timed out")
		} else {
			fail(c, http.StatusInternalServerError, "map overview unavailable")
		}
		return
	}
	c.JSON(http.StatusOK, result)
}
