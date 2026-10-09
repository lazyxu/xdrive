package api

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const (
	mediaMemoryDefaultLimit       = 24
	mediaMemoryMaxLimit           = 100
	mediaMemoryRecentWindowDays   = 14
	mediaMemoryRecentMinItems     = 2
	mediaMemoryTripCellScale      = int64(5)
	mediaMemoryTripMinHistoryDays = 5
	mediaMemoryTripMinHomeDays    = 2
	mediaMemoryTripMaxGapDays     = 2
	mediaMemoryTripMinDays        = 2
	mediaMemoryTripMinItems       = 4
)

const (
	mediaMemoryKindRecentDay = "recent_day"
	mediaMemoryKindOnThisDay = "on_this_day"
	mediaMemoryKindTrip      = "trip"
)

type mediaMemoryDTO struct {
	ID          string     `json:"id"`
	Kind        string     `json:"kind"`
	Title       string     `json:"title"`
	Subtitle    string     `json:"subtitle,omitempty"`
	StartDate   string     `json:"start_date,omitempty"`
	EndDate     string     `json:"end_date,omitempty"`
	AnchorDate  string     `json:"anchor_date,omitempty"`
	PlaceName   string     `json:"place_name,omitempty"`
	ItemCount   int64      `json:"item_count"`
	YearCount   int64      `json:"year_count,omitempty"`
	CoverNodeID *uint64    `json:"cover_node_id,omitempty"`
	UpdatedAt   *time.Time `json:"updated_at,omitempty"`
}

type mediaMemorySpec struct {
	Kind       string
	Start      time.Time
	End        time.Time
	AnchorYear int
	Month      time.Month
	Day        int
}

type mediaMemoryTripDay struct {
	Date          time.Time
	DateKey       string
	LatitudeCell  int64
	LongitudeCell int64
	ItemCount     int64
	CoverNodeID   *uint64
	UpdatedAt     *time.Time
	PlaceName     string
}

type mediaMemoryTripSegment struct {
	Days      []mediaMemoryTripDay
	ItemCount int64
}

func mediaMemoryDate(value time.Time) time.Time {
	value = value.UTC()
	return time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, time.UTC)
}

func parseMediaMemoryAnchorDate(raw string, now time.Time) (time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		raw = now.Format("2006-01-02")
	}
	value, err := time.Parse("2006-01-02", raw)
	if err != nil {
		return time.Time{}, fmt.Errorf("anchor_date must use YYYY-MM-DD")
	}
	return mediaMemoryDate(value), nil
}

func mediaMemoryLimit(c *gin.Context) (int, bool) {
	limit := mediaMemoryDefaultLimit
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > mediaMemoryMaxLimit {
			fail(c, 400, "limit must be between 1 and 100")
			return 0, false
		}
		limit = value
	}
	return limit, true
}

func mediaMemoryRecentID(day time.Time) string {
	return "recent:" + mediaMemoryDate(day).Format("2006-01-02")
}

func mediaMemoryOnThisDayID(anchor time.Time) string {
	return fmt.Sprintf(
		"on-this-day:%04d:%02d-%02d",
		anchor.Year(),
		int(anchor.Month()),
		anchor.Day(),
	)
}

func mediaMemoryTripID(start, end time.Time) string {
	return "trip:v1:" +
		mediaMemoryDate(start).Format("2006-01-02") + ":" +
		mediaMemoryDate(end).Format("2006-01-02")
}

func parseMediaMemoryID(raw string) (mediaMemorySpec, bool) {
	parts := strings.Split(strings.TrimSpace(raw), ":")
	switch {
	case len(parts) == 2 && parts[0] == "recent":
		day, err := time.Parse("2006-01-02", parts[1])
		if err != nil {
			return mediaMemorySpec{}, false
		}
		day = mediaMemoryDate(day)
		return mediaMemorySpec{
			Kind:  mediaMemoryKindRecentDay,
			Start: day,
			End:   day.AddDate(0, 0, 1),
		}, true
	case len(parts) == 3 && parts[0] == "on-this-day":
		year, err := strconv.Atoi(parts[1])
		if err != nil || year < 1 || year > 9999 {
			return mediaMemorySpec{}, false
		}
		monthDay, err := time.Parse("01-02", parts[2])
		if err != nil {
			return mediaMemorySpec{}, false
		}
		return mediaMemorySpec{
			Kind:       mediaMemoryKindOnThisDay,
			AnchorYear: year,
			Month:      monthDay.Month(),
			Day:        monthDay.Day(),
		}, true
	case len(parts) == 4 && parts[0] == "trip" && parts[1] == "v1":
		start, startErr := time.Parse("2006-01-02", parts[2])
		end, endErr := time.Parse("2006-01-02", parts[3])
		if startErr != nil || endErr != nil {
			return mediaMemorySpec{}, false
		}
		start = mediaMemoryDate(start)
		end = mediaMemoryDate(end)
		if end.Before(start) {
			return mediaMemorySpec{}, false
		}
		return mediaMemorySpec{
			Kind:  mediaMemoryKindTrip,
			Start: start,
			End:   end.AddDate(0, 0, 1),
		}, true
	default:
		return mediaMemorySpec{}, false
	}
}

func mediaMemoryDateTitle(day, anchor time.Time) string {
	day = mediaMemoryDate(day)
	anchor = mediaMemoryDate(anchor)
	switch {
	case day.Equal(anchor):
		return "今天"
	case day.Equal(anchor.AddDate(0, 0, -1)):
		return "昨天"
	default:
		return fmt.Sprintf("%d月%d日", int(day.Month()), day.Day())
	}
}

func mediaMemoryDateRangeLabel(start, end time.Time) string {
	start = mediaMemoryDate(start)
	end = mediaMemoryDate(end)
	if start.Equal(end) {
		return fmt.Sprintf("%d月%d日", int(start.Month()), start.Day())
	}
	if start.Year() == end.Year() && start.Month() == end.Month() {
		return fmt.Sprintf(
			"%d月%d日–%d日",
			int(start.Month()),
			start.Day(),
			end.Day(),
		)
	}
	if start.Year() == end.Year() {
		return fmt.Sprintf(
			"%d月%d日–%d月%d日",
			int(start.Month()),
			start.Day(),
			int(end.Month()),
			end.Day(),
		)
	}
	return fmt.Sprintf(
		"%d年%d月%d日–%d年%d月%d日",
		start.Year(),
		int(start.Month()),
		start.Day(),
		end.Year(),
		int(end.Month()),
		end.Day(),
	)
}

func listMemoryThumbnailMIMEs() []string {
	return []string{
		"image/jpeg", "image/png", "image/gif", "image/webp", "image/avif",
		"image/tiff", "image/bmp", "image/heic", "image/heif", "image/x-adobe-dng",
	}
}

func (s *Server) listMediaMemories(c *gin.Context) {
	location, zone, zoneErr := mediaIANAZone(c.Query("time_zone"))
	if zoneErr != nil {
		fail(c, 400, zoneErr.Error())
		return
	}
	if err := s.refreshMediaIndexForOwner(
		c.Request.Context(),
		userID(c),
		mediaRequestIndexBatch,
	); err != nil {
		fail(c, 500, "refresh media projection failed")
		return
	}
	anchor, err := parseMediaMemoryAnchorDate(c.Query("anchor_date"), time.Now().In(location))
	if err != nil {
		fail(c, 400, err.Error())
		return
	}
	limit, ok := mediaMemoryLimit(c)
	if !ok {
		return
	}
	items, err := queryMediaMemories(
		c.Request.Context(),
		s.DB,
		userID(c),
		anchor,
		limit,
		zone,
	)
	if err != nil {
		fail(c, 500, "list media memories failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(200, items)
}

func (s *Server) listMediaMemoryItems(c *gin.Context) {
	_, zone, zoneErr := mediaIANAZone(c.Query("time_zone"))
	if zoneErr != nil {
		fail(c, 400, zoneErr.Error())
		return
	}
	memoryID := strings.TrimSpace(c.Param("memoryID"))
	spec, ok := parseMediaMemoryID(memoryID)
	if !ok {
		fail(c, 404, "media memory not found")
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
	page, err := s.queryMediaMemoryItemRange(
		c.Request.Context(),
		userID(c),
		spec,
		limit,
		offset,
		zone,
	)
	if err != nil {
		fail(c, 500, "list media memory items failed")
		return
	}
	c.Header("Cache-Control", "no-store")
	if rangeRequested {
		c.JSON(200, page)
		return
	}
	c.JSON(200, page.Items)
}

func queryMediaMemories(
	ctx context.Context,
	db *gorm.DB,
	ownerID uint64,
	anchor time.Time,
	limit int,
	zoneName ...string,
) ([]mediaMemoryDTO, error) {
	if db == nil || ownerID == 0 {
		return nil, fmt.Errorf("media memories query is not configured")
	}
	if limit <= 0 || limit > mediaMemoryMaxLimit {
		limit = mediaMemoryDefaultLimit
	}
	anchor = mediaMemoryDate(anchor)
	zone := mediaMemoryZoneName(zoneName)

	onThisDay, err := queryMediaOnThisDayMemory(ctx, db, ownerID, anchor, zone)
	if err != nil {
		return nil, err
	}
	recent, err := queryMediaRecentDayMemories(ctx, db, ownerID, anchor, zone)
	if err != nil {
		return nil, err
	}
	trips, err := queryMediaTripMemories(ctx, db, ownerID, zone)
	if err != nil {
		return nil, err
	}

	out := make([]mediaMemoryDTO, 0, 1+len(recent)+len(trips))
	if onThisDay != nil {
		out = append(out, *onThisDay)
	}
	out = append(out, recent...)
	out = append(out, trips...)
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func queryMediaRecentDayMemories(
	ctx context.Context,
	db *gorm.DB,
	ownerID uint64,
	anchor time.Time,
	zoneName ...string,
) ([]mediaMemoryDTO, error) {
	zone := mediaMemoryZoneName(zoneName)
	location, _, _ := mediaIANAZone(zone)
	start := mediaMemoryLocalMidnight(anchor.AddDate(0, 0, -(mediaMemoryRecentWindowDays-1)), location)
	end := mediaMemoryLocalMidnight(anchor.AddDate(0, 0, 1), location)
	type row struct {
		DayKey      string     `gorm:"column:day_key"`
		ItemCount   int64      `gorm:"column:item_count"`
		CoverNodeID *uint64    `gorm:"column:cover_node_id"`
		UpdatedAt   *time.Time `gorm:"column:updated_at"`
	}
	var rows []row
	if err := db.WithContext(ctx).
		Model(&meta.MediaMetadata{}).
		Select(
			mediaIANAZoneExpression("TO_CHAR(xd_media_metadata.captured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')", zone)+" AS day_key, "+
				"COUNT(DISTINCT pa.id) AS item_count, "+
				"MAX(CASE WHEN lower(xd_media_metadata.mime_type) IN ? THEN pa.primary_node_id ELSE NULL END) AS cover_node_id, "+
				"MAX(xd_media_metadata.captured_at) AS updated_at",
			listMemoryThumbnailMIMEs(),
		).
		Joins(
			"JOIN xd_photo_assets AS pa ON pa.primary_node_id = xd_media_metadata.node_id AND pa.owner_id = ?",
			ownerID,
		).
		Joins("JOIN xd_nodes AS n ON n.id = xd_media_metadata.node_id AND n.deleted_at IS NULL").
		Where(
			"xd_media_metadata.owner_id = ? AND xd_media_metadata.index_state = ? AND "+
				"xd_media_metadata.media_kind IN ? AND xd_media_metadata.captured_at >= ? AND xd_media_metadata.captured_at < ?",
			ownerID,
			meta.MediaIndexStateReady,
			[]string{meta.MediaKindImage, meta.MediaKindVideo},
			start,
			end,
		).
		Group("day_key").
		Having("COUNT(DISTINCT pa.id) >= ?", mediaMemoryRecentMinItems).
		Order("day_key DESC").
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	out := make([]mediaMemoryDTO, 0, len(rows))
	for _, row := range rows {
		day, err := time.Parse("2006-01-02", row.DayKey)
		if err != nil {
			continue
		}
		out = append(out, mediaMemoryDTO{
			ID:          mediaMemoryRecentID(day),
			Kind:        mediaMemoryKindRecentDay,
			Title:       mediaMemoryDateTitle(day, anchor),
			Subtitle:    fmt.Sprintf("%d 个项目", row.ItemCount),
			StartDate:   row.DayKey,
			EndDate:     row.DayKey,
			ItemCount:   row.ItemCount,
			CoverNodeID: row.CoverNodeID,
			UpdatedAt:   row.UpdatedAt,
		})
	}
	return out, nil
}

func queryMediaOnThisDayMemory(
	ctx context.Context,
	db *gorm.DB,
	ownerID uint64,
	anchor time.Time,
	zoneName ...string,
) (*mediaMemoryDTO, error) {
	zone := mediaMemoryZoneName(zoneName)
	location, _, _ := mediaIANAZone(zone)
	type row struct {
		ItemCount   int64      `gorm:"column:item_count"`
		YearCount   int64      `gorm:"column:year_count"`
		CoverNodeID *uint64    `gorm:"column:cover_node_id"`
		UpdatedAt   *time.Time `gorm:"column:updated_at"`
	}
	var value row
	currentYearStart := time.Date(anchor.Year(), 1, 1, 0, 0, 0, 0, location).UTC()
	if err := db.WithContext(ctx).
		Model(&meta.MediaMetadata{}).
		Select(
			"COUNT(DISTINCT pa.id) AS item_count, "+
				"COUNT(DISTINCT EXTRACT(YEAR FROM ("+mediaIANAZoneExpression("xd_media_metadata.captured_at AT TIME ZONE 'UTC'", zone)+"))) AS year_count, "+
				"MAX(CASE WHEN lower(xd_media_metadata.mime_type) IN ? THEN pa.primary_node_id ELSE NULL END) AS cover_node_id, "+
				"MAX(xd_media_metadata.captured_at) AS updated_at",
			listMemoryThumbnailMIMEs(),
		).
		Joins(
			"JOIN xd_photo_assets AS pa ON pa.primary_node_id = xd_media_metadata.node_id AND pa.owner_id = ?",
			ownerID,
		).
		Joins("JOIN xd_nodes AS n ON n.id = xd_media_metadata.node_id AND n.deleted_at IS NULL").
		Where(
			"xd_media_metadata.owner_id = ? AND xd_media_metadata.index_state = ? AND "+
				"xd_media_metadata.media_kind IN ? AND xd_media_metadata.captured_at IS NOT NULL AND "+
				"xd_media_metadata.captured_at < ? AND "+
				"EXTRACT(MONTH FROM ("+mediaIANAZoneExpression("xd_media_metadata.captured_at AT TIME ZONE 'UTC'", zone)+")) = ? AND "+
				"EXTRACT(DAY FROM ("+mediaIANAZoneExpression("xd_media_metadata.captured_at AT TIME ZONE 'UTC'", zone)+")) = ?",
			ownerID,
			meta.MediaIndexStateReady,
			[]string{meta.MediaKindImage, meta.MediaKindVideo},
			currentYearStart,
			int(anchor.Month()),
			anchor.Day(),
		).
		Scan(&value).Error; err != nil {
		return nil, err
	}
	if value.ItemCount == 0 {
		return nil, nil
	}
	return &mediaMemoryDTO{
		ID:          mediaMemoryOnThisDayID(anchor),
		Kind:        mediaMemoryKindOnThisDay,
		Title:       "往年今日",
		Subtitle:    fmt.Sprintf("%d 年 · %d 个项目", value.YearCount, value.ItemCount),
		AnchorDate:  anchor.Format("2006-01-02"),
		ItemCount:   value.ItemCount,
		YearCount:   value.YearCount,
		CoverNodeID: value.CoverNodeID,
		UpdatedAt:   value.UpdatedAt,
	}, nil
}

func queryMediaTripDays(
	ctx context.Context,
	db *gorm.DB,
	ownerID uint64,
	zoneName ...string,
) ([]mediaMemoryTripDay, error) {
	zone := mediaMemoryZoneName(zoneName)
	type row struct {
		DayKey        string     `gorm:"column:day_key"`
		LatitudeCell  int64      `gorm:"column:latitude_cell"`
		LongitudeCell int64      `gorm:"column:longitude_cell"`
		ItemCount     int64      `gorm:"column:item_count"`
		CoverNodeID   *uint64    `gorm:"column:cover_node_id"`
		UpdatedAt     *time.Time `gorm:"column:updated_at"`
		PlaceName     string     `gorm:"column:place_name"`
	}
	latExpr := fmt.Sprintf(
		"FLOOR(xd_media_metadata.latitude * %d)::bigint",
		mediaMemoryTripCellScale,
	)
	lonExpr := fmt.Sprintf(
		"FLOOR(xd_media_metadata.longitude * %d)::bigint",
		mediaMemoryTripCellScale,
	)
	var rows []row
	if err := db.WithContext(ctx).
		Model(&meta.MediaMetadata{}).
		Select(
			mediaIANAZoneExpression("TO_CHAR(xd_media_metadata.captured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')", zone)+" AS day_key, "+
				latExpr+" AS latitude_cell, "+lonExpr+" AS longitude_cell, "+
				"COUNT(DISTINCT pa.id) AS item_count, "+
				"MAX(CASE WHEN lower(xd_media_metadata.mime_type) IN ? THEN pa.primary_node_id ELSE NULL END) AS cover_node_id, "+
				"MAX(xd_media_metadata.captured_at) AS updated_at, "+
				"MIN(NULLIF(ppl.formatted, '')) AS place_name",
			listMemoryThumbnailMIMEs(),
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
				"xd_media_metadata.media_kind IN ? AND xd_media_metadata.captured_at IS NOT NULL AND "+
				"xd_media_metadata.latitude IS NOT NULL AND xd_media_metadata.longitude IS NOT NULL AND "+
				"xd_media_metadata.latitude BETWEEN -90 AND 90 AND "+
				"xd_media_metadata.longitude BETWEEN -180 AND 180",
			ownerID,
			meta.MediaIndexStateReady,
			[]string{meta.MediaKindImage, meta.MediaKindVideo},
		).
		Group("day_key, " + latExpr + ", " + lonExpr).
		Order("day_key ASC, item_count DESC, latitude_cell ASC, longitude_cell ASC").
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	dominant := make([]mediaMemoryTripDay, 0)
	seenDay := ""
	for _, row := range rows {
		if row.DayKey == seenDay {
			continue
		}
		day, err := time.Parse("2006-01-02", row.DayKey)
		if err != nil {
			continue
		}
		seenDay = row.DayKey
		dominant = append(dominant, mediaMemoryTripDay{
			Date:          mediaMemoryDate(day),
			DateKey:       row.DayKey,
			LatitudeCell:  row.LatitudeCell,
			LongitudeCell: row.LongitudeCell,
			ItemCount:     row.ItemCount,
			CoverNodeID:   row.CoverNodeID,
			UpdatedAt:     row.UpdatedAt,
			PlaceName:     strings.TrimSpace(row.PlaceName),
		})
	}
	return dominant, nil
}

func mediaMemoryTripCellKey(day mediaMemoryTripDay) string {
	return fmt.Sprintf("%d:%d", day.LatitudeCell, day.LongitudeCell)
}

func mediaMemoryTripNearHome(
	day mediaMemoryTripDay,
	homeLat, homeLon int64,
) bool {
	latDistance := day.LatitudeCell - homeLat
	if latDistance < 0 {
		latDistance = -latDistance
	}
	lonDistance := day.LongitudeCell - homeLon
	if lonDistance < 0 {
		lonDistance = -lonDistance
	}
	return latDistance <= 1 && lonDistance <= 1
}

func mediaMemoryTripSegments(
	days []mediaMemoryTripDay,
) []mediaMemoryTripSegment {
	if len(days) < mediaMemoryTripMinHistoryDays {
		return nil
	}
	cellDays := make(map[string]int)
	cellLocation := make(map[string][2]int64)
	for _, day := range days {
		key := mediaMemoryTripCellKey(day)
		cellDays[key]++
		cellLocation[key] = [2]int64{day.LatitudeCell, day.LongitudeCell}
	}
	homeKey := ""
	homeCount := 0
	for key, count := range cellDays {
		if count > homeCount || (count == homeCount && (homeKey == "" || key < homeKey)) {
			homeKey = key
			homeCount = count
		}
	}
	if homeKey == "" || homeCount < mediaMemoryTripMinHomeDays {
		return nil
	}
	home := cellLocation[homeKey]

	var segments []mediaMemoryTripSegment
	var current mediaMemoryTripSegment
	flush := func() {
		if len(current.Days) >= mediaMemoryTripMinDays &&
			current.ItemCount >= mediaMemoryTripMinItems {
			segments = append(segments, current)
		}
		current = mediaMemoryTripSegment{}
	}
	for _, day := range days {
		if mediaMemoryTripNearHome(day, home[0], home[1]) {
			flush()
			continue
		}
		if len(current.Days) > 0 {
			last := current.Days[len(current.Days)-1]
			gap := int(day.Date.Sub(last.Date).Hours() / 24)
			if gap > mediaMemoryTripMaxGapDays {
				flush()
			}
		}
		current.Days = append(current.Days, day)
		current.ItemCount += day.ItemCount
	}
	flush()
	return segments
}

func mediaMemoryTripPlace(segment mediaMemoryTripSegment) string {
	weights := make(map[string]int64)
	for _, day := range segment.Days {
		if day.PlaceName != "" {
			weights[day.PlaceName] += day.ItemCount
		}
	}
	name := ""
	var weight int64
	for candidate, candidateWeight := range weights {
		if candidateWeight > weight ||
			(candidateWeight == weight && (name == "" || candidate < name)) {
			name = candidate
			weight = candidateWeight
		}
	}
	return name
}

type mediaMemoryRangeSummary struct {
	ItemCount   int64
	CoverNodeID *uint64
	UpdatedAt   *time.Time
}

func queryMediaMemoryRangeSummary(
	ctx context.Context,
	db *gorm.DB,
	ownerID uint64,
	start, end time.Time,
) (mediaMemoryRangeSummary, error) {
	var out mediaMemoryRangeSummary
	err := db.WithContext(ctx).
		Model(&meta.MediaMetadata{}).
		Select(
			"COUNT(DISTINCT pa.id) AS item_count, "+
				"MAX(CASE WHEN lower(xd_media_metadata.mime_type) IN ? THEN pa.primary_node_id ELSE NULL END) AS cover_node_id, "+
				"MAX(xd_media_metadata.captured_at) AS updated_at",
			listMemoryThumbnailMIMEs(),
		).
		Joins(
			"JOIN xd_photo_assets AS pa ON pa.primary_node_id = xd_media_metadata.node_id AND pa.owner_id = ?",
			ownerID,
		).
		Joins("JOIN xd_nodes AS n ON n.id = xd_media_metadata.node_id AND n.deleted_at IS NULL").
		Where(
			"xd_media_metadata.owner_id = ? AND xd_media_metadata.index_state = ? AND "+
				"xd_media_metadata.media_kind IN ? AND "+
				"xd_media_metadata.captured_at >= ? AND xd_media_metadata.captured_at < ?",
			ownerID,
			meta.MediaIndexStateReady,
			[]string{meta.MediaKindImage, meta.MediaKindVideo},
			start,
			end,
		).
		Scan(&out).Error
	return out, err
}

func queryMediaTripMemories(
	ctx context.Context,
	db *gorm.DB,
	ownerID uint64,
	zoneName ...string,
) ([]mediaMemoryDTO, error) {
	zone := mediaMemoryZoneName(zoneName)
	location, _, _ := mediaIANAZone(zone)
	days, err := queryMediaTripDays(ctx, db, ownerID, zone)
	if err != nil {
		return nil, err
	}
	segments := mediaMemoryTripSegments(days)
	out := make([]mediaMemoryDTO, 0, len(segments))
	for _, segment := range segments {
		if len(segment.Days) == 0 {
			continue
		}
		start := segment.Days[0].Date
		end := segment.Days[len(segment.Days)-1].Date
		summary, summaryErr := queryMediaMemoryRangeSummary(
			ctx,
			db,
			ownerID,
			mediaMemoryLocalMidnight(start, location),
			mediaMemoryLocalMidnight(end.AddDate(0, 0, 1), location),
		)
		if summaryErr != nil {
			return nil, summaryErr
		}
		if summary.ItemCount == 0 {
			continue
		}
		place := mediaMemoryTripPlace(segment)
		title := "行程回忆"
		if place != "" {
			title = place + "之行"
		}
		out = append(out, mediaMemoryDTO{
			ID:          mediaMemoryTripID(start, end),
			Kind:        mediaMemoryKindTrip,
			Title:       title,
			Subtitle:    mediaMemoryDateRangeLabel(start, end) + fmt.Sprintf(" · %d 个项目", summary.ItemCount),
			StartDate:   start.Format("2006-01-02"),
			EndDate:     end.Format("2006-01-02"),
			PlaceName:   place,
			ItemCount:   summary.ItemCount,
			CoverNodeID: summary.CoverNodeID,
			UpdatedAt:   summary.UpdatedAt,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].EndDate != out[j].EndDate {
			return out[i].EndDate > out[j].EndDate
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}

func (s *Server) mediaMemoryItemsBaseQuery(
	ctx context.Context,
	ownerID uint64,
	spec mediaMemorySpec,
	zoneName ...string,
) (*gorm.DB, error) {
	zone := mediaMemoryZoneName(zoneName)
	location, _, _ := mediaIANAZone(zone)
	base, err := s.mediaItemsBaseQuery(
		ctx,
		ownerID,
		mediaQueryOptions{},
		"",
	)
	if err != nil {
		return nil, err
	}
	base = base.Where("xd_media_metadata.index_state = ?", meta.MediaIndexStateReady)
	switch spec.Kind {
	case mediaMemoryKindRecentDay, mediaMemoryKindTrip:
		return base.Where(
			"xd_media_metadata.captured_at >= ? AND xd_media_metadata.captured_at < ?",
			mediaMemoryLocalMidnight(spec.Start, location),
			mediaMemoryLocalMidnight(spec.End, location),
		), nil
	case mediaMemoryKindOnThisDay:
		return base.Where(
			"xd_media_metadata.captured_at IS NOT NULL AND "+
				"EXTRACT(YEAR FROM ("+mediaIANAZoneExpression("xd_media_metadata.captured_at AT TIME ZONE 'UTC'", zone)+")) < ? AND "+
				"EXTRACT(MONTH FROM ("+mediaIANAZoneExpression("xd_media_metadata.captured_at AT TIME ZONE 'UTC'", zone)+")) = ? AND "+
				"EXTRACT(DAY FROM ("+mediaIANAZoneExpression("xd_media_metadata.captured_at AT TIME ZONE 'UTC'", zone)+")) = ?",
			spec.AnchorYear,
			int(spec.Month),
			spec.Day,
		), nil
	default:
		return nil, gorm.ErrRecordNotFound
	}
}

func (s *Server) queryMediaMemoryItemRange(
	ctx context.Context,
	ownerID uint64,
	spec mediaMemorySpec,
	limit, offset int,
	zoneName ...string,
) (mediaItemRangeDTO, error) {
	query, err := s.mediaMemoryItemsBaseQuery(ctx, ownerID, spec, zoneName...)
	if err != nil {
		return mediaItemRangeDTO{}, err
	}
	var totalCount int64
	if err := query.Session(&gorm.Session{}).
		Distinct("xd_media_metadata.node_id").
		Count(&totalCount).Error; err != nil {
		return mediaItemRangeDTO{}, err
	}
	items, err := s.materializeMediaItems(ctx, ownerID, query, limit, offset)
	if err != nil {
		return mediaItemRangeDTO{}, err
	}
	return mediaItemRangeDTO{
		Items:      items,
		TotalCount: totalCount,
		Offset:     offset,
		Limit:      limit,
	}, nil
}
