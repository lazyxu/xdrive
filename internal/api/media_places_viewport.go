package api

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// A3b3a1: a bounded Owner-scoped view of existing A1 0.01-degree cells.
// All coordinates and the query envelope are WGS84. This is NOT a Baidu
// JSAPI4 route, a basemap, BD-09 output, or client-side clustering.
const (
	mediaPlaceViewportDefaultLimit = 64
	mediaPlaceViewportMaxLimit     = 100
	mediaPlaceViewportQueryTimeout = 3 * time.Second
)

type mediaPlaceViewportBounds struct {
	West  float64
	South float64
	East  float64
	North float64
}

// Validate trusted internal calls too: NaN and infinity bypass ordinary
// range comparisons even though HTTP parsing already rejects them.
func (b mediaPlaceViewportBounds) valid() bool {
	for _, v := range []float64{b.West, b.South, b.East, b.North} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return false
		}
	}
	return b.South >= -90 && b.North <= 90 && b.West >= -180 &&
		b.West <= 180 && b.East >= -180 && b.East <= 180 &&
		b.South < b.North && b.West != b.East &&
		!(b.West == 180 && b.East == -180)
}

type mediaPlacesViewportDTO struct {
	Items           []mediaPlaceDTO `json:"items"`
	TotalCount      int64           `json:"total_count"`       // Number of grid cells in this viewport.
	TotalPhotoCount int64           `json:"total_photo_count"` // Distinct visible logical PhotoAssets.
	Offset          int             `json:"offset"`
	Limit           int             `json:"limit"`
	HasMore         bool            `json:"has_more"`
}

// Do not silently parse the first of duplicated parameters, invent a world
// viewport on missing fields, or accept an unconstrained client-side SQL scale.
// West > East intentionally selects across the antimeridian.
func parseMediaPlaceViewport(rawQuery string) (mediaPlaceViewportBounds, int, int, error) {
	var bounds mediaPlaceViewportBounds
	q, err := url.ParseQuery(rawQuery)
	if err != nil {
		return bounds, 0, 0, fmt.Errorf("invalid viewport query")
	}
	for key, values := range q {
		switch key {
		case "west", "south", "east", "north", "limit", "offset":
		default:
			return bounds, 0, 0, fmt.Errorf("unknown viewport parameter")
		}
		if len(values) != 1 || values[0] == "" || strings.TrimSpace(values[0]) != values[0] {
			return bounds, 0, 0, fmt.Errorf("invalid viewport parameter")
		}
	}
	coordinate := func(name string, minimum, maximum float64) (float64, error) {
		values := q[name]
		if len(values) != 1 {
			return 0, fmt.Errorf("missing viewport coordinate")
		}
		v, err := strconv.ParseFloat(values[0], 64)
		if err != nil || math.IsNaN(v) || math.IsInf(v, 0) || v < minimum || v > maximum {
			return 0, fmt.Errorf("invalid viewport coordinate")
		}
		return v, nil
	}
	if bounds.West, err = coordinate("west", -180, 180); err != nil {
		return bounds, 0, 0, err
	}
	if bounds.South, err = coordinate("south", -90, 90); err != nil {
		return bounds, 0, 0, err
	}
	if bounds.East, err = coordinate("east", -180, 180); err != nil {
		return bounds, 0, 0, err
	}
	if bounds.North, err = coordinate("north", -90, 90); err != nil {
		return bounds, 0, 0, err
	}
	if !bounds.valid() {
		return bounds, 0, 0, fmt.Errorf("degenerate viewport")
	}
	limit := mediaPlaceViewportDefaultLimit
	if values := q["limit"]; len(values) == 1 {
		limit, err = strconv.Atoi(values[0])
		if err != nil || limit < 1 || limit > mediaPlaceViewportMaxLimit {
			return bounds, 0, 0, fmt.Errorf("invalid viewport limit")
		}
	}
	offset := 0
	if values := q["offset"]; len(values) == 1 {
		offset, err = strconv.Atoi(values[0])
		if err != nil || offset < 0 || offset > mediaPlacePageMaxOffset {
			return bounds, 0, 0, fmt.Errorf("invalid viewport offset")
		}
	}
	return bounds, limit, offset, nil
}

func mediaPlacesWithinViewport(query *gorm.DB, bounds mediaPlaceViewportBounds) *gorm.DB {
	query = query.Where(
		"xd_media_metadata.latitude >= ? AND xd_media_metadata.latitude <= ?",
		bounds.South, bounds.North,
	)
	if bounds.West < bounds.East {
		return query.Where(
			"xd_media_metadata.longitude >= ? AND xd_media_metadata.longitude <= ?",
			bounds.West, bounds.East,
		)
	}
	return query.Where(
		"(xd_media_metadata.longitude >= ? OR xd_media_metadata.longitude <= ?)",
		bounds.West, bounds.East,
	)
}

// Count the entire authorized spatial selection with the same valid-GPS
// predicate used by A1, then return a bounded ordered window. No originals,
// image bytes or a 100k-item JS/DOM collection are materialized.
func queryMediaPlacesViewport(
	ctx context.Context, db *gorm.DB, ownerID uint64,
	bounds mediaPlaceViewportBounds, limit, offset int,
) (mediaPlacesViewportDTO, error) {
	if ctx == nil || ctx.Err() != nil || db == nil || ownerID == 0 ||
		limit < 1 || limit > mediaPlaceViewportMaxLimit ||
		offset < 0 || offset > mediaPlacePageMaxOffset ||
		!bounds.valid() {
		return mediaPlacesViewportDTO{}, fmt.Errorf("invalid media viewport")
	}
	latCell, lonCell := mediaPlaceCellExpressions()
	grouped := mediaPlacesWithinViewport(mediaPlacesBaseQuery(ctx, db, ownerID), bounds).
		Select(latCell + " AS latitude_cell, " + lonCell + " AS longitude_cell").
		Group(latCell + ", " + lonCell)
	var totalCount int64
	if err := db.WithContext(ctx).Table("(?) AS visible_place_cells", grouped).
		Count(&totalCount).Error; err != nil {
		return mediaPlacesViewportDTO{}, err
	}
	var totalPhotoCount int64
	if err := mediaPlacesWithinViewport(mediaPlacesBaseQuery(ctx, db, ownerID), bounds).
		Distinct("pa.id").Count(&totalPhotoCount).Error; err != nil {
		return mediaPlacesViewportDTO{}, err
	}
	items, err := queryMediaPlacesWindowScoped(ctx, db, ownerID, limit, offset, &bounds)
	if err != nil {
		return mediaPlacesViewportDTO{}, err
	}
	if items == nil {
		items = []mediaPlaceDTO{}
	}
	return mediaPlacesViewportDTO{
		Items: items, TotalCount: totalCount, TotalPhotoCount: totalPhotoCount,
		Offset: offset, Limit: limit, HasMore: mediaPlaceHasMore(totalCount, offset, len(items)),
	}, nil
}

func (s *Server) listMediaPlacesViewport(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("X-Content-Type-Options", "nosniff")
	bounds, limit, offset, err := parseMediaPlaceViewport(c.Request.URL.RawQuery)
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid viewport parameters")
		return
	}
	if err := s.refreshMediaIndexForGalleryRead(
		c.Request.Context(), userID(c), mediaRequestIndexBatch,
	); err != nil {
		fail(c, http.StatusInternalServerError, "refresh media projection failed")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), mediaPlaceViewportQueryTimeout)
	defer cancel()
	page, err := queryMediaPlacesViewport(ctx, s.DB, userID(c), bounds, limit, offset)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			fail(c, http.StatusGatewayTimeout, "viewport query timed out")
		} else {
			fail(c, http.StatusInternalServerError, "list media viewport failed")
		}
		return
	}
	c.JSON(http.StatusOK, page)
}
