package api

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// A trip map is NOT the whole-Owner /media/places/overview. This endpoint
// returns only geographic cells from a currently authorized trip:v2 member
// predicate. More than 64 real cells must never be silently truncated into a
// misleading map or a top-N cover with inflated total counts.
const mediaExactTripMapMaxPlaces = 64

type mediaExactTripMapDTO struct {
	Items           []mediaPlaceDTO `json:"items"`
	TotalPhotoCount int64           `json:"total_photo_count"`
	TripPhotoCount  int64           `json:"trip_photo_count"`
	Aggregated      bool            `json:"aggregated"`
}

func mediaExactTripPlaceCellQuery(query *gorm.DB, cell mediaPlaceCell) *gorm.DB {
	latExpr, lonExpr := mediaExactTripPlaceExpressions()
	return query.Where(latExpr+" = ? AND "+lonExpr+" = ?", cell.Latitude, cell.Longitude)
}

func mediaExactTripPlaceExpressions() (string, string) {
	lat, _ := mediaPlaceCellExpressions()
	// +180 and -180 are the same WGS84 meridian. Reuse this expression for
	// GROUP BY and exact place Range to avoid fake duplicates at the seam.
	lon := fmt.Sprintf(
		"FLOOR((CASE WHEN xd_media_metadata.longitude = 180 THEN -180 ELSE xd_media_metadata.longitude END) * %d)::bigint",
		mediaPlaceCellScale,
	)
	return lat, lon
}

// Current Owner and time zone re-prove each trip segment independently of a
// caller-provided tripID. Old IDs never fall back to the v1 date-only query.
func (s *Server) resolveMediaExactTrip(
	ctx context.Context, ownerID uint64, zone, tripID string,
) (mediaMemoryTripSegment, bool, error) {
	if !strings.HasPrefix(tripID, mediaExactTripIDPrefix) ||
		len(tripID) != 54 {
		return mediaMemoryTripSegment{}, false, nil
	}
	segments, err := queryMediaExactTripSegments(ctx, s.DB, ownerID, zone)
	if err != nil {
		return mediaMemoryTripSegment{}, false, err
	}
	for _, segment := range segments {
		if mediaExactTripID(segment, zone) == tripID {
			return segment, true, nil
		}
	}
	return mediaMemoryTripSegment{}, false, nil
}


func (s *Server) queryMediaExactTripMap(
	ctx context.Context, ownerID uint64,
	segment mediaMemoryTripSegment, zone string,
) (mediaExactTripMapDTO, error) {
	return s.queryMediaExactTripMapViewport(ctx, ownerID, segment, zone,
		mediaPlaceViewportBounds{West: -180, South: -90, East: 180, North: 90})
}

// Every response is an exact Owner+trip:v2 partition of its requested WGS84
// viewport. The full trip Count is independent of the visible viewport Count;
// an aggregate is presentation-only, and a photo Range still requires a
// canonical place after zooming to a sufficiently small real-cell selection.
func (s *Server) queryMediaExactTripMapViewport(
	ctx context.Context, ownerID uint64, segment mediaMemoryTripSegment,
	zone string, bounds mediaPlaceViewportBounds,
) (mediaExactTripMapDTO, error) {
	if !bounds.valid() {
		return mediaExactTripMapDTO{}, fmt.Errorf("invalid exact trip map viewport")
	}
	base, err := s.mediaExactTripQuery(ctx, ownerID, segment, zone)
	if err != nil {
		return mediaExactTripMapDTO{}, err
	}
	var tripCount int64
	if err := base.Session(&gorm.Session{}).
		Distinct("xd_media_metadata.node_id").Count(&tripCount).Error; err != nil {
		return mediaExactTripMapDTO{}, err
	}
	if tripCount < 1 {
		return mediaExactTripMapDTO{}, fmt.Errorf("exact trip has no current members")
	}
	scoped := mediaPlacesWithinViewport(base.Session(&gorm.Session{}), bounds)
	var expected int64
	if err := scoped.Session(&gorm.Session{}).
		Distinct("xd_media_metadata.node_id").Count(&expected).Error; err != nil {
		return mediaExactTripMapDTO{}, err
	}
	out := mediaExactTripMapDTO{
		Items: make([]mediaPlaceDTO, 0, mediaExactTripMapMaxPlaces),
		TripPhotoCount: tripCount,
	}
	if expected == 0 {
		return out, nil
	}
	latCell, lonCell := mediaExactTripPlaceExpressions()
	type placeRow struct {
		LatitudeCell int64
		LongitudeCell int64
		SampleLatitude float64
		SampleLongitude float64
		ItemCount int64
		CoverNodeID *uint64
		UpdatedAt *time.Time
	}
	var rows []placeRow
	err = scoped.Session(&gorm.Session{}).
		Select(latCell+" AS latitude_cell, "+lonCell+" AS longitude_cell, "+
			"(ARRAY_AGG(xd_media_metadata.latitude ORDER BY xd_media_metadata.node_id))[1] AS sample_latitude, "+
			"(ARRAY_AGG(xd_media_metadata.longitude ORDER BY xd_media_metadata.node_id))[1] AS sample_longitude, "+
			"COUNT(DISTINCT xd_media_metadata.node_id) AS item_count, "+
			"MIN(CASE WHEN lower(xd_media_metadata.mime_type) IN ? THEN xd_media_metadata.node_id ELSE NULL END) AS cover_node_id, "+
			"MAX(xd_media_metadata.captured_at) AS updated_at",
			listMemoryThumbnailMIMEs()).
		Group(latCell+", "+lonCell).
		Order("item_count DESC, latitude_cell ASC, longitude_cell ASC").
		Limit(mediaExactTripMapMaxPlaces + 1).
		Scan(&rows).Error
	if err != nil {
		return mediaExactTripMapDTO{}, err
	}
	if len(rows) <= mediaExactTripMapMaxPlaces {
		for _, r := range rows {
			cell := mediaPlaceCell{Latitude: r.LatitudeCell, Longitude: r.LongitudeCell}
			if r.ItemCount < 1 || r.ItemCount > expected-out.TotalPhotoCount ||
				cell.Latitude < -90*mediaPlaceCellScale || cell.Latitude > 90*mediaPlaceCellScale ||
				cell.Longitude < -180*mediaPlaceCellScale || cell.Longitude > 180*mediaPlaceCellScale {
				return mediaExactTripMapDTO{}, fmt.Errorf("invalid exact trip place count")
			}
			lat, lon := mediaPlaceCenter(cell)
			out.Items = append(out.Items, mediaPlaceDTO{
				ID: mediaPlaceKey(cell), Name: mediaPlaceName(cell),
				Latitude: lat, Longitude: lon,
				SampleLatitude: r.SampleLatitude, SampleLongitude: r.SampleLongitude,
				CoordinateKind: "grid_cell_center", ItemCount: r.ItemCount,
				CoverNodeID: r.CoverNodeID, UpdatedAt: r.UpdatedAt,
			})
			out.TotalPhotoCount += r.ItemCount
		}
		if out.TotalPhotoCount != expected {
			return mediaExactTripMapDTO{}, fmt.Errorf("exact trip map changed during grouped read")
		}
		return out, nil
	}
	// An exact 65th place is a reason to aggregate, NOT a 409 error or
	// permission to publish a misleading top-64 result. Fit the grid to
	// genuine GPS extrema so a dense city is not one giant world bucket.
	var extent mediaMapOverviewExtent
	if err := scoped.Session(&gorm.Session{}).
		Select("MIN(xd_media_metadata.latitude) AS min_latitude, "+
			"MAX(xd_media_metadata.latitude) AS max_latitude, "+
			"MIN(xd_media_metadata.longitude) AS min_longitude, "+
			"MAX(xd_media_metadata.longitude) AS max_longitude, "+
			"MIN(CASE WHEN xd_media_metadata.longitude < 0 THEN xd_media_metadata.longitude + 360 ELSE xd_media_metadata.longitude END) AS min_shifted_longitude, "+
			"MAX(CASE WHEN xd_media_metadata.longitude < 0 THEN xd_media_metadata.longitude + 360 ELSE xd_media_metadata.longitude END) AS max_shifted_longitude").
		Scan(&extent).Error; err != nil {
		return mediaExactTripMapDTO{}, err
	}
	fitted, found, err := mediaMapOverviewFittedBounds(bounds, extent)
	if err != nil || !found {
		return mediaExactTripMapDTO{}, fmt.Errorf("invalid exact trip aggregate extent")
	}
	rowExpr, colExpr := mediaMapOverviewBuckets(fitted)
	type aggregateRow struct {
		BucketRow int
		BucketCol int
		SampleLatitude float64
		SampleLongitude float64
		ItemCount int64
		CoverNodeID *uint64
	}
	var aggregates []aggregateRow
	err = scoped.Session(&gorm.Session{}).
		Select(rowExpr+" AS bucket_row, "+colExpr+" AS bucket_col, "+
			"(ARRAY_AGG(xd_media_metadata.latitude ORDER BY xd_media_metadata.node_id))[1] AS sample_latitude, "+
			"(ARRAY_AGG(xd_media_metadata.longitude ORDER BY xd_media_metadata.node_id))[1] AS sample_longitude, "+
			"COUNT(DISTINCT xd_media_metadata.node_id) AS item_count, "+
			"MIN(CASE WHEN lower(xd_media_metadata.mime_type) IN ? THEN xd_media_metadata.node_id ELSE NULL END) AS cover_node_id",
			listMemoryThumbnailMIMEs()).
		Group(rowExpr+", "+colExpr).
		Order("bucket_row ASC, bucket_col ASC").
		Limit(mediaExactTripMapMaxPlaces + 1).Scan(&aggregates).Error
	if err != nil {
		return mediaExactTripMapDTO{}, err
	}
	if len(aggregates) == 0 || len(aggregates) > mediaExactTripMapMaxPlaces {
		return mediaExactTripMapDTO{}, fmt.Errorf("invalid exact trip aggregate partition")
	}
	out.Aggregated = true
	for _, r := range aggregates {
		if r.BucketRow < 0 || r.BucketRow >= mediaMapOverviewAxis ||
			r.BucketCol < 0 || r.BucketCol >= mediaMapOverviewAxis ||
			r.ItemCount < 1 || r.ItemCount > expected-out.TotalPhotoCount ||
			math.IsNaN(r.SampleLatitude) || math.IsNaN(r.SampleLongitude) ||
			math.Abs(r.SampleLatitude) > 90 || math.Abs(r.SampleLongitude) > 180 {
			return mediaExactTripMapDTO{}, fmt.Errorf("invalid exact trip aggregate cell")
		}
		out.Items = append(out.Items, mediaPlaceDTO{
			ID: fmt.Sprintf("trip-region:%d:%d", r.BucketRow, r.BucketCol),
			Name: fmt.Sprintf("旅行照片区域 %d-%d", r.BucketRow+1, r.BucketCol+1),
			Latitude: r.SampleLatitude, Longitude: r.SampleLongitude,
			SampleLatitude: r.SampleLatitude, SampleLongitude: r.SampleLongitude,
			CoordinateKind: "map_region_sample", ItemCount: r.ItemCount,
			CoverNodeID: r.CoverNodeID,
		})
		out.TotalPhotoCount += r.ItemCount
	}
	if out.TotalPhotoCount != expected {
		return mediaExactTripMapDTO{}, fmt.Errorf("exact trip aggregate count mismatch")
	}
	return out, nil
}

// A viewport is a display/request filter, never a Member credential.
// The User-supplied bounds must be complete WGS84 numbers; other query
// keys, duplicates and non-finite numbers are fail-closed.
func mediaExactTripMapRequestBounds(rawQuery string) (mediaPlaceViewportBounds, error) {
	world := mediaPlaceViewportBounds{West: -180, South: -90, East: 180, North: 90}
	q, err := url.ParseQuery(rawQuery)
	if err != nil {
		return world, fmt.Errorf("malformed trip viewport")
	}
	values := url.Values{}
	boundsCount := 0
	for key, items := range q {
		if len(items) != 1 {
			return world, fmt.Errorf("repeated trip map parameter")
		}
		switch key {
		case "time_zone":
		case "west", "south", "east", "north":
			boundsCount++
			values.Set(key, items[0])
		default:
			return world, fmt.Errorf("unknown trip map parameter")
		}
	}
	if boundsCount == 0 {
		return world, nil
	}
	if boundsCount != 4 {
		return world, fmt.Errorf("incomplete trip viewport")
	}
	bounds, _, _, err := parseMediaPlaceViewport(values.Encode())
	return bounds, err
}

func (s *Server) listMediaExactTripMap(c *gin.Context) {
	_, zone, err := mediaIANAZone(c.Query("time_zone"))
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	ownerID := userID(c)
	segment, ok, err := s.resolveMediaExactTrip(
		c.Request.Context(), ownerID, zone, c.Param("tripID"))
	if err != nil {
		fail(c, http.StatusInternalServerError, "read exact trip map failed")
		return
	}
	if !ok {
		fail(c, http.StatusNotFound, "exact trip changed; reload trips")
		return
	}
	bounds, parseErr := mediaExactTripMapRequestBounds(c.Request.URL.RawQuery)
	if parseErr != nil {
		fail(c, http.StatusBadRequest, "invalid trip map viewport")
		return
	}
	overview, err := s.queryMediaExactTripMapViewport(
		c.Request.Context(), ownerID, segment, zone, bounds)
	if err != nil {
		// A concurrent member edit or invalid aggregate cannot publish a partial map.
		fail(c, http.StatusConflict, "exact trip map changed; refresh current trip")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, overview)
}
