package api

import (
	"context"
	"fmt"
	"net/http"
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
	query, err := s.mediaExactTripQuery(ctx, ownerID, segment, zone)
	if err != nil {
		return mediaExactTripMapDTO{}, err
	}
	var expected int64
	if err := query.Session(&gorm.Session{}).
		Distinct("xd_media_metadata.node_id").Count(&expected).Error; err != nil {
		return mediaExactTripMapDTO{}, err
	}
	latCell, lonCell := mediaExactTripPlaceExpressions()
	type row struct {
		LatitudeCell   int64      `gorm:"column:latitude_cell"`
		LongitudeCell  int64      `gorm:"column:longitude_cell"`
		SampleLatitude float64    `gorm:"column:sample_latitude"`
		SampleLongitude float64   `gorm:"column:sample_longitude"`
		ItemCount      int64      `gorm:"column:item_count"`
		CoverNodeID    *uint64    `gorm:"column:cover_node_id"`
		UpdatedAt      *time.Time `gorm:"column:updated_at"`
	}
	var rows []row
	err = query.Session(&gorm.Session{}).
		Select(
			latCell+" AS latitude_cell, "+lonCell+" AS longitude_cell, "+
				"(ARRAY_AGG(xd_media_metadata.latitude ORDER BY xd_media_metadata.node_id))[1] AS sample_latitude, "+
				"(ARRAY_AGG(xd_media_metadata.longitude ORDER BY xd_media_metadata.node_id))[1] AS sample_longitude, "+
				"COUNT(DISTINCT xd_media_metadata.node_id) AS item_count, "+
				"MIN(CASE WHEN lower(xd_media_metadata.mime_type) IN ? "+
				"THEN xd_media_metadata.node_id ELSE NULL END) AS cover_node_id, "+
				"MAX(xd_media_metadata.captured_at) AS updated_at",
			listMemoryThumbnailMIMEs(),
		).
		Group(latCell + ", " + lonCell).
		Order("item_count DESC, latitude_cell ASC, longitude_cell ASC").
		Limit(mediaExactTripMapMaxPlaces + 1).
		Scan(&rows).Error
	if err != nil {
		return mediaExactTripMapDTO{}, err
	}
	if len(rows) > mediaExactTripMapMaxPlaces {
		return mediaExactTripMapDTO{}, fmt.Errorf("trip has more than %d exact places", mediaExactTripMapMaxPlaces)
	}
	overview := mediaExactTripMapDTO{Items: make([]mediaPlaceDTO, 0, len(rows))}
	for _, r := range rows {
		cell := mediaPlaceCell{Latitude: r.LatitudeCell, Longitude: r.LongitudeCell}
		if r.ItemCount < 1 || r.ItemCount > expected-overview.TotalPhotoCount ||
			cell.Latitude < -90*mediaPlaceCellScale || cell.Latitude > 90*mediaPlaceCellScale ||
			cell.Longitude < -180*mediaPlaceCellScale || cell.Longitude > 180*mediaPlaceCellScale {
			return mediaExactTripMapDTO{}, fmt.Errorf("invalid exact trip map count or coordinate")
		}
		lat, lon := mediaPlaceCenter(cell)
		overview.Items = append(overview.Items, mediaPlaceDTO{
			ID:              mediaPlaceKey(cell),
			Name:            mediaPlaceName(cell),
			Latitude:        lat,
			Longitude:       lon,
			SampleLatitude:  r.SampleLatitude,
			SampleLongitude: r.SampleLongitude,
			CoordinateKind:  "grid_cell_center",
			ItemCount:       r.ItemCount,
			CoverNodeID:     r.CoverNodeID,
			UpdatedAt:       r.UpdatedAt,
		})
		overview.TotalPhotoCount += r.ItemCount
	}
	if expected != overview.TotalPhotoCount || expected == 0 {
		// A change between Count and grouped read must fail closed. The
		// browser/native app must never reconcile by guessing unlisted photos.
		return mediaExactTripMapDTO{}, fmt.Errorf("exact trip map members changed")
	}
	return overview, nil
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
	overview, err := s.queryMediaExactTripMap(
		c.Request.Context(), ownerID, segment, zone)
	if err != nil {
		// A very large trip cannot become an incomplete 64-place map.
		fail(c, http.StatusConflict, "exact trip map has changed or exceeds the bounded place limit")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, overview)
}
