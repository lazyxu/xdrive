package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// Trip v1 Memories remain a date-only historical heuristic. This separate v2
// read path proves membership in the actual GPS cells used to select each trip
// day. It never claims that same-day home photos or arbitrary date-range media
// are members of the trip. It does not mutate media or add a second map provider.
const mediaExactTripMaximumDays = 366
const mediaExactTripIDPrefix = "trip:v2:"

func mediaExactTripID(segment mediaMemoryTripSegment, zone string) string {
	if len(segment.Days) == 0 || len(segment.Days) > mediaExactTripMaximumDays {
		return ""
	}
	first := segment.Days[0].DateKey
	last := segment.Days[len(segment.Days)-1].DateKey
	if _, err := time.Parse("2006-01-02", first); err != nil {
		return ""
	}
	if _, err := time.Parse("2006-01-02", last); err != nil {
		return ""
	}
	// The identity names a deterministic geography/calendar scope, not a
	// cached list of Node IDs. Details recompute its current Owner membership.
	// Include IANA time_zone so a different local day boundary cannot open
	// the same ID with different source photos.
	h := sha256.New()
	fmt.Fprintf(h, "xdrive-trip-v2\x00%s\x00", zone)
	if segment.ExactVerified {
		fmt.Fprintf(h, "home:%d:%d:%s;", segment.HomeLatitudeCell,
			segment.HomeLongitudeCell, segment.MemberFingerprint)
	}
	previous := ""
	for _, day := range segment.Days {
		parsed, err := time.Parse("2006-01-02", day.DateKey)
		if err != nil || day.DateKey <= previous ||
			!parsed.Equal(mediaMemoryDate(day.Date)) {
			return ""
		}
		previous = day.DateKey
		fmt.Fprintf(h, "%s:%d:%d;", day.DateKey, day.LatitudeCell, day.LongitudeCell)
	}
	digest := hex.EncodeToString(h.Sum(nil)[:12])
	return mediaExactTripIDPrefix + first + ":" + last + ":" + digest
}

func queryMediaExactTripSegments(
	ctx context.Context, db *gorm.DB, ownerID uint64, zone string,
) ([]mediaMemoryTripSegment, error) {
	if db == nil || ctx == nil || ctx.Err() != nil || ownerID == 0 {
		return nil, fmt.Errorf("invalid Owner trip request")
	}
	days, err := queryMediaTripDays(ctx, db, ownerID, zone)
	if err != nil {
		return nil, err
	}
	// Start from conservative home evidence, then add genuine
	// off-home travel transitions that share a neighboring away day.
	// Never add all photos from a calendar date without real GPS proof.
	recognitionDays := days
	if homeLat, homeLon, ok := mediaExactTripHome(days); ok {
		away, lookupErr := queryMediaExactTripAwayDays(
			ctx, db, ownerID, zone, homeLat, homeLon)
		if lookupErr != nil { return nil, lookupErr }
		recognitionDays = mediaExactTripPromoteTransitDays(
			days, away, homeLat, homeLon)
	}
	segments := mediaMemoryTripSegments(recognitionDays)
	segments, err = verifyMediaExactTripMembership(ctx, db, ownerID, zone, days, segments)
	if err != nil {
		return nil, err
	}
	bounded := make([]mediaMemoryTripSegment, 0, len(segments))
	for _, segment := range segments {
		if mediaExactTripID(segment, zone) != "" {
			bounded = append(bounded, segment)
		}
	}
	return bounded, nil
}

func (s *Server) mediaExactTripQuery(
	ctx context.Context, ownerID uint64,
	segment mediaMemoryTripSegment, zone string,
) (*gorm.DB, error) {
	if len(segment.Days) == 0 ||
		len(segment.Days) > mediaExactTripMaximumDays ||
		!segment.ExactVerified || segment.MemberFingerprint == "" {
		return nil, gorm.ErrRecordNotFound
	}
	location, _, err := mediaIANAZone(zone)
	if err != nil {
		return nil, err
	}
	base, err := s.mediaItemsBaseQuery(ctx, ownerID, mediaQueryOptions{}, "")
	if err != nil {
		return nil, err
	}

	// The exact scope is each proven travel day AND a real GPS outside
	// the trusted home vicinity. A second away city on that day is included;
	// same-day home and no-GPS photos never become trip members.
	pieces := make([]string, 0, len(segment.Days))
	params := make([]any, 0, len(segment.Days)*2)
	for _, day := range segment.Days {
		value, err := time.Parse("2006-01-02", day.DateKey)
		if err != nil || !mediaMemoryDate(day.Date).Equal(value) ||
			day.LatitudeCell < -450 || day.LatitudeCell > 450 ||
			day.LongitudeCell < -900 || day.LongitudeCell > 900 {
			return nil, gorm.ErrRecordNotFound
		}
		pieces = append(pieces,
			"(xd_media_metadata.captured_at >= ? AND xd_media_metadata.captured_at < ?)")
		params = append(params,
			mediaMemoryLocalMidnight(value, location),
			mediaMemoryLocalMidnight(value.AddDate(0, 0, 1), location))
	}
	awaySQL, awayArgs := mediaExactTripAwayPredicate(
		segment.HomeLatitudeCell, segment.HomeLongitudeCell)
	return base.Where(
		"xd_media_metadata.index_state = ? AND "+
			"xd_media_metadata.captured_at IS NOT NULL AND "+
			"xd_media_metadata.latitude BETWEEN -90 AND 90 AND "+
			"xd_media_metadata.longitude BETWEEN -180 AND 180",
		meta.MediaIndexStateReady,
	).Where("("+strings.Join(pieces, " OR ")+")", params...).
		Where(awaySQL, awayArgs...), nil
}

func (s *Server) listMediaExactTrips(c *gin.Context) {
	_, zone, err := mediaIANAZone(c.Query("time_zone"))
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	limit, ok := mediaMemoryLimit(c)
	if !ok {
		return
	}
	ownerID := userID(c)
	if err := s.refreshMediaIndexForGalleryRead(
		c.Request.Context(), ownerID, mediaRequestIndexBatch,
	); err != nil {
		fail(c, http.StatusInternalServerError, "refresh media projection failed")
		return
	}
	segments, err := queryMediaExactTripSegments(
		c.Request.Context(), s.DB, ownerID, zone)
	if err != nil {
		fail(c, http.StatusInternalServerError, "list exact trips failed")
		return
	}
	// Newest first, before expensive bounded summary reads.
	sort.Slice(segments, func(i, j int) bool {
		a, b := segments[i], segments[j]
		return a.Days[len(a.Days)-1].DateKey > b.Days[len(b.Days)-1].DateKey
	})
	trips := make([]mediaMemoryDTO, 0, min(limit, len(segments)))
	for _, segment := range segments {
		query, err := s.mediaExactTripQuery(
			c.Request.Context(), ownerID, segment, zone)
		if err != nil {
			fail(c, http.StatusInternalServerError, "list exact trips failed")
			return
		}
		var summary struct {
			ItemCount   int64      `gorm:"column:item_count"`
			CoverNodeID *uint64    `gorm:"column:cover_node_id"`
			UpdatedAt   *time.Time `gorm:"column:updated_at"`
		}
		if err := query.Select(
			"COUNT(DISTINCT xd_media_metadata.node_id) AS item_count, "+
				"MAX(CASE WHEN lower(xd_media_metadata.mime_type) IN ? "+
				"THEN xd_media_metadata.node_id ELSE NULL END) AS cover_node_id, "+
				"MAX(xd_media_metadata.captured_at) AS updated_at",
			listMemoryThumbnailMIMEs(),
		).Scan(&summary).Error; err != nil {
			fail(c, http.StatusInternalServerError, "list exact trips failed")
			return
		}
		if summary.ItemCount == 0 {
			continue
		}
		start := segment.Days[0].Date
		end := segment.Days[len(segment.Days)-1].Date
		place := mediaMemoryTripPlace(segment)
		title := "地点行程"
		if place != "" {
			title = place + "之行"
		}
		trips = append(trips, mediaMemoryDTO{
			ID:    mediaExactTripID(segment, zone),
			Kind:  mediaMemoryKindTrip,
			Title: title,
			Subtitle: mediaMemoryDateRangeLabel(start, end) +
				fmt.Sprintf(" · %d 张已核对 GPS 照片", summary.ItemCount),
			StartDate:   segment.Days[0].DateKey,
			EndDate:     segment.Days[len(segment.Days)-1].DateKey,
			PlaceName:   place,
			ItemCount:   summary.ItemCount,
			CoverNodeID: summary.CoverNodeID,
			UpdatedAt:   summary.UpdatedAt,
		})
		if len(trips) == limit {
			break
		}
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, trips)
}

func (s *Server) listMediaExactTripItems(c *gin.Context) {
	_, zone, err := mediaIANAZone(c.Query("time_zone"))
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
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
	ownerID := userID(c)
	segment, found, err := s.resolveMediaExactTrip(
		c.Request.Context(), ownerID, zone, c.Param("tripID"))
	if err != nil {
		fail(c, http.StatusInternalServerError, "get exact trip failed")
		return
	}
	if !found {
		// Never fall back to the v1 calendar-only memory query.
		fail(c, http.StatusNotFound, "exact trip changed; reload trips")
		return
	}
	query, err := s.mediaExactTripQuery(
		c.Request.Context(), ownerID, segment, zone)
	if err != nil {
		fail(c, http.StatusInternalServerError, "get exact trip failed")
		return
	}
	// A map pin is not authority. Apply this canonical WGS84 cell *after*
	// the Owner+trip:v2 predicate, and use it unchanged for Count and Range.
	if values, present := c.Request.URL.Query()["place"]; present {
		if len(values) != 1 {
			fail(c, http.StatusBadRequest, "exact trip place must be unique")
			return
		}
		cell, valid := parseMediaPlaceKey(values[0])
		if !valid || values[0] != mediaPlaceKey(cell) {
			fail(c, http.StatusBadRequest, "invalid exact trip place")
			return
		}
		query = mediaExactTripPlaceCellQuery(query, cell)
	}
	var count int64
	if err := query.Session(&gorm.Session{}).
		Distinct("xd_media_metadata.node_id").Count(&count).Error; err != nil {
		fail(c, http.StatusInternalServerError, "get exact trip failed")
		return
	}
	items, err := s.materializeMediaItems(
		c.Request.Context(), ownerID, query, limit, offset)
	if err != nil {
		fail(c, http.StatusInternalServerError, "get exact trip failed")
		return
	}
	// One Owner, GPS membership predicate and materialization for both the
	// total and the 48-item sparse reader. No client-side 100k enumeration.
	page := mediaItemRangeDTO{
		Items: items, TotalCount: count, Offset: offset, Limit: limit,
	}
	c.Header("Cache-Control", "no-store")
	if rangeRequested {
		c.JSON(http.StatusOK, page)
	} else {
		c.JSON(http.StatusOK, page.Items)
	}
}
