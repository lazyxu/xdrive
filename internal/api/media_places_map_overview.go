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

// An 8x8 grid over the whole planet was NOT a useful photo overview:
// 460 different 0.01-degree places around Jinhua all fall inside the same
// 45-degree longitude / 21.25-degree latitude world bucket. The map then
// paints one sample with the entire combined photo count. Compute a bounded,
// Owner-filtered GPS envelope first, and bucket inside that REAL extent.
//
// All values below come only from the existing Owner/valid-GPS SQL predicate.
// Never read photo bytes, fabricate a center or download all places to JS.
type mediaMapOverviewExtent struct {
	MinLatitude         *float64
	MaxLatitude         *float64
	MinLongitude        *float64
	MaxLongitude        *float64
	MinShiftedLongitude *float64
	MaxShiftedLongitude *float64
}

func mediaMapOverviewPadAxis(minimum, maximum, lower, upper float64) (float64, float64) {
	padding := math.Max(0.0001, (maximum-minimum)*0.01)
	west := math.Max(lower, minimum-padding)
	east := math.Min(upper, maximum+padding)
	if west >= east {
		return lower, upper
	}
	return west, east
}

// Longitude circles around the dateline. Unlike averaging WGS84 longitude,
// this only chooses the shortest observed arc for the 8x8 partition.
func mediaMapOverviewNormalizeLongitude(value float64) float64 {
	if value > 180 {
		value -= 360
	}
	if value < -180 {
		value += 360
	}
	return value
}

// Pure, fail-closed helper; a small genuine photo envelope is NOT replaced
// by the caller's often-worldwide viewport when creating aggregate regions.
func mediaMapOverviewFittedBounds(
	requested mediaPlaceViewportBounds, extent mediaMapOverviewExtent,
) (mediaPlaceViewportBounds, bool, error) {
	values := []*float64{
		extent.MinLatitude, extent.MaxLatitude,
		extent.MinLongitude, extent.MaxLongitude,
		extent.MinShiftedLongitude, extent.MaxShiftedLongitude,
	}
	if values[0] == nil && values[1] == nil &&
		values[2] == nil && values[3] == nil &&
		values[4] == nil && values[5] == nil {
		return requested, false, nil
	}
	for _, pointer := range values {
		if pointer == nil || math.IsNaN(*pointer) || math.IsInf(*pointer, 0) {
			return mediaPlaceViewportBounds{}, false, fmt.Errorf("invalid map GPS extent")
		}
	}
	minLat, maxLat := *extent.MinLatitude, *extent.MaxLatitude
	minLon, maxLon := *extent.MinLongitude, *extent.MaxLongitude
	minShift, maxShift := *extent.MinShiftedLongitude, *extent.MaxShiftedLongitude
	if minLat < requested.South || maxLat > requested.North ||
		minLat > maxLat || minLon < -180 || maxLon > 180 || minLon > maxLon ||
		minShift < 0 || maxShift > 360 || minShift > maxShift {
		return mediaPlaceViewportBounds{}, false, fmt.Errorf("out-of-bounds map GPS extent")
	}
	fitted := requested
	fitted.South, fitted.North = mediaMapOverviewPadAxis(
		minLat, maxLat, requested.South, requested.North)
	// Only world or a genuine anti-meridian viewport may use a circular
	// longitude arc; normal finite viewports must remain inside their query.
	canWrap := requested.West > requested.East ||
		(requested.West == -180 && requested.East == 180)
	if canWrap && maxShift-minShift+1e-10 < maxLon-minLon {
		wrappedWest, wrappedEast := mediaMapOverviewPadAxis(
			minShift, maxShift, -180, 540)
		fitted.West = mediaMapOverviewNormalizeLongitude(wrappedWest)
		fitted.East = mediaMapOverviewNormalizeLongitude(wrappedEast)
	} else if requested.West < requested.East {
		fitted.West, fitted.East = mediaMapOverviewPadAxis(
			minLon, maxLon, requested.West, requested.East)
	} else {
		// An anti-meridian viewport with all points on one side may still
		// use an ordinary, narrow longitude interval.
		fitted.West, fitted.East = mediaMapOverviewPadAxis(
			minLon, maxLon, -180, 180)
	}
	if !fitted.valid() {
		return mediaPlaceViewportBounds{}, false, fmt.Errorf("invalid fitted map GPS extent")
	}
	return fitted, true, nil
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
	var extent mediaMapOverviewExtent
	// This read uses the EXACT SAME Owner, live Node, index-state, media-kind,
	// valid-WGS84 and viewport predicates as the following grouped photo query.
	// No top-N cutoff, sample download, loose Owner authorization or client
	// loop can influence the actual geographic display envelope.
	if err := mediaPlacesWithinViewport(mediaPlacesBaseQuery(ctx, db, ownerID), bounds).
		Select("MIN(xd_media_metadata.latitude) AS min_latitude, " +
			"MAX(xd_media_metadata.latitude) AS max_latitude, " +
			"MIN(xd_media_metadata.longitude) AS min_longitude, " +
			"MAX(xd_media_metadata.longitude) AS max_longitude, " +
			"MIN(CASE WHEN xd_media_metadata.longitude < 0 THEN xd_media_metadata.longitude + 360 ELSE xd_media_metadata.longitude END) AS min_shifted_longitude, " +
			"MAX(CASE WHEN xd_media_metadata.longitude < 0 THEN xd_media_metadata.longitude + 360 ELSE xd_media_metadata.longitude END) AS max_shifted_longitude").
		Scan(&extent).Error; err != nil {
		return mediaPlacesMapOverviewDTO{}, err
	}
	fitted, found, err := mediaMapOverviewFittedBounds(bounds, extent)
	if err != nil {
		return mediaPlacesMapOverviewDTO{}, err
	}
	if !found {
		return mediaPlacesMapOverviewDTO{Items: []mediaPlaceDTO{}, Aggregated: true}, nil
	}
	// Stage 1: every representative coordinate and its cover must come
	// from the SAME unique GPS record. Stage 2: rank distinct actual GPS
	// positions, rather than partitioning an entire multi-city envelope
	// into equal-angle squares. A repeated GPS remains one weighted point.
	//
	// PostgreSQL performs all grouping/ranking within the authenticated
	// selection. Only the <=64 representatives cross Server -> Client.
	// Stable rank boundary slots reserve geographically extreme samples;
	// the other six slots adapt to the true coordinate distribution.
	longitudeSort := "longitude"
	if fitted.West > fitted.East {
		longitudeSort = fmt.Sprintf(
			"(CASE WHEN longitude < %s THEN longitude + 360 ELSE longitude END)",
			strconv.FormatFloat(fitted.West, 'f', -1, 64))
	}
	ownerMedia := mediaPlacesWithinViewport(mediaPlacesBaseQuery(ctx, db, ownerID), bounds).
		Select("xd_media_metadata.latitude AS latitude, " +
			"xd_media_metadata.longitude AS longitude, " +
			"pa.id AS photo_asset_id, pa.primary_node_id AS node_id, " +
			"lower(xd_media_metadata.mime_type) AS mime_type")
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
	// A position is first deduplicated; all PhotoAssets sharing that exact
	// coordinate stay together, and its thumbnail Node belongs to THAT point.
	// The final ROW_NUMBER chooses one of these indivisible positions,
	// preferring a real image cover over a video-only representative.
	// No independent MIN(cover_node_id) / ARRAY_AGG(sample_gps) pairing.
	query := fmt.Sprintf(`WITH owner_media AS (?),
gps_positions AS (
	SELECT latitude, longitude, COUNT(DISTINCT photo_asset_id) AS photo_count,
		MIN(node_id) AS fallback_node_id,
		MIN(node_id) FILTER (WHERE mime_type IN ?) AS cover_node_id
	FROM owner_media GROUP BY latitude, longitude
),
lat_order AS (
	SELECT *, ROW_NUMBER() OVER (ORDER BY latitude, longitude) AS rank_lat,
		COUNT(*) OVER () AS total_positions
	FROM gps_positions
),
lat_buckets AS (
	SELECT *, CASE
		WHEN total_positions <= 8 THEN (rank_lat - 1)::int
		WHEN rank_lat = 1 THEN 0
		WHEN rank_lat = total_positions THEN 7
		ELSE 1 + LEAST(5, FLOOR((rank_lat - 2)::numeric * 6 / (total_positions - 2))::int)
	END AS bucket_row
	FROM lat_order
),
lon_order AS (
	SELECT *, ROW_NUMBER() OVER
		(PARTITION BY bucket_row ORDER BY %s, latitude) AS rank_lon,
		COUNT(*) OVER (PARTITION BY bucket_row) AS row_positions
	FROM lat_buckets
),
quantile_buckets AS (
	SELECT *, CASE
		WHEN row_positions <= 8 THEN (rank_lon - 1)::int
		WHEN rank_lon = 1 THEN 0
		WHEN rank_lon = row_positions THEN 7
		ELSE 1 + LEAST(5, FLOOR((rank_lon - 2)::numeric * 6 / (row_positions - 2))::int)
	END AS bucket_col
	FROM lon_order
),
ranked AS (
	SELECT bucket_row, bucket_col, latitude, longitude, cover_node_id,
		SUM(photo_count) OVER (PARTITION BY bucket_row, bucket_col) AS item_count,
		ROW_NUMBER() OVER (
			PARTITION BY bucket_row, bucket_col
			ORDER BY CASE WHEN cover_node_id IS NULL THEN 1 ELSE 0 END,
				photo_count DESC, COALESCE(cover_node_id, fallback_node_id),
				latitude, longitude
		) AS sample_rank
	FROM quantile_buckets
)
SELECT bucket_row, bucket_col, latitude AS sample_latitude,
	longitude AS sample_longitude, item_count, cover_node_id
FROM ranked WHERE sample_rank = 1
ORDER BY item_count DESC, bucket_row ASC, bucket_col ASC
LIMIT 65`, longitudeSort)
	var rows []row
	err = db.WithContext(ctx).Raw(query, ownerMedia, thumbnailMIMEs).Scan(&rows).Error
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
			ID: fmt.Sprintf("map-region:q:%s:%s:%s:%s:%d:%d",
				strconv.FormatFloat(fitted.West, 'f', -1, 64),
				strconv.FormatFloat(fitted.South, 'f', -1, 64),
				strconv.FormatFloat(fitted.East, 'f', -1, 64),
				strconv.FormatFloat(fitted.North, 'f', -1, 64),
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
