package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// Exact trips use an Owner-scoped away-day GPS predicate, not the single
// dominant 0.2-degree cell. This admits a genuine second city on the same
// travel day while excluding the proven home area and all no-GPS media.
// The predicate is reused for the membership fingerprint and every Range.
func mediaExactTripAwayPredicate(homeLat, homeLon int64) (string, []any) {
	latExpr := fmt.Sprintf("FLOOR(xd_media_metadata.latitude * %d)::bigint", mediaMemoryTripCellScale)
	lonExpr := fmt.Sprintf("FLOOR((CASE WHEN xd_media_metadata.longitude = 180 THEN -180 ELSE xd_media_metadata.longitude END) * %d)::bigint", mediaMemoryTripCellScale)
	nearHomeLon := []int64{
		mediaMemoryTripCanonicalLongitudeCell(homeLon - 1),
		mediaMemoryTripCanonicalLongitudeCell(homeLon),
		mediaMemoryTripCanonicalLongitudeCell(homeLon + 1),
	}
	return "NOT (" + latExpr + " BETWEEN ? AND ? AND " + lonExpr + " IN ?)",
		[]any{homeLat - 1, homeLat + 1, nearHomeLon}
}

// Match the existing v1 home calculation exactly, but never turn the v1
// day-dominant trip heuristic into a photo-membership authorization token.
func mediaExactTripHome(days []mediaMemoryTripDay) (int64, int64, bool) {
	frequency := make(map[string]int)
	coordinates := make(map[string][2]int64)
	for _, day := range days {
		key := mediaMemoryTripCellKey(day)
		frequency[key]++
		coordinates[key] = [2]int64{day.LatitudeCell, mediaMemoryTripCanonicalLongitudeCell(day.LongitudeCell)}
	}
	bestKey, bestCount := "", 0
	for key, count := range frequency {
		if count > bestCount || (count == bestCount && (bestKey == "" || key < bestKey)) {
			bestKey, bestCount = key, count
		}
	}
	if bestCount < mediaMemoryTripMinHomeDays {
		return 0, 0, false
	}
	home := coordinates[bestKey]
	return home[0], home[1], true
}

// A home-dominant travel transition day can still have genuine off-home
// photos (e.g. return home after visiting another city). Promote it only
// when a distinct neighboring day is already independently identified as
// away; isolated commuter GPS rows must never manufacture a trip.
func mediaExactTripPromoteTransitDays(
	dominant []mediaMemoryTripDay, offHome []mediaMemoryTripDay,
	homeLat, homeLon int64,
) []mediaMemoryTripDay {
	candidates := make(map[string]mediaMemoryTripDay, len(offHome))
	for _, away := range offHome {
		if away.ItemCount >= 2 && !mediaMemoryTripNearHome(away, homeLat, homeLon) {
			candidates[away.DateKey] = away
		}
	}
	adjusted := append([]mediaMemoryTripDay(nil), dominant...)
	for i, day := range dominant {
		if !mediaMemoryTripNearHome(day, homeLat, homeLon) {
			continue
		}
		away, ok := candidates[day.DateKey]
		if !ok {
			continue
		}
		before, after := false, false
		for j, other := range dominant {
			if i == j || mediaMemoryTripNearHome(other, homeLat, homeLon) {
				continue
			}
			delta := int(day.Date.Sub(other.Date).Hours() / 24)
			if delta == 1 {
				before = true
			}
			if delta == -1 {
				after = true
			}
		}
		// A home-dominant day between two separate away runs may be a real
		// return-home and second departure. Keep it as a boundary rather
		// than merging two trips solely because it also has distant photos.
		if before != after {
			adjusted[i] = away
		}
	}
	return adjusted
}

// SQL chooses one genuine off-home cell per local day, without loading
// every distinct GPS location into memory. This is recognition evidence
// only; exact membership still includes all off-home cities and is checked
// through the independent current-Owner predicate.
func queryMediaExactTripAwayDays(
	ctx context.Context, db *gorm.DB, ownerID uint64, zone string,
	homeLat, homeLon int64,
) ([]mediaMemoryTripDay, error) {
	base, err := (&Server{DB: db}).mediaItemsBaseQuery(
		ctx, ownerID, mediaQueryOptions{}, "")
	if err != nil {
		return nil, err
	}
	predicate, arguments := mediaExactTripAwayPredicate(homeLat, homeLon)
	dateExpr := mediaIANAZoneExpression(
		"TO_CHAR(xd_media_metadata.captured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')", zone)
	latExpr := fmt.Sprintf("FLOOR(xd_media_metadata.latitude * %d)::bigint", mediaMemoryTripCellScale)
	lonExpr := fmt.Sprintf("FLOOR((CASE WHEN xd_media_metadata.longitude = 180 THEN -180 ELSE xd_media_metadata.longitude END) * %d)::bigint", mediaMemoryTripCellScale)
	grouped := base.Where(
		"xd_media_metadata.index_state = ? AND xd_media_metadata.captured_at IS NOT NULL AND "+
			mediaPlaceValidGPSPredicate, meta.MediaIndexStateReady).
		Where(predicate, arguments...).
		Select(dateExpr + " AS day_key, " + latExpr + " AS latitude_cell, " +
			lonExpr + " AS longitude_cell, COUNT(DISTINCT xd_media_metadata.node_id) AS item_count").
		Group("day_key, " + latExpr + ", " + lonExpr)
	ranked := db.WithContext(ctx).Table("(?) AS off_home_days", grouped).
		Select("day_key, latitude_cell, longitude_cell, item_count, " +
			"ROW_NUMBER() OVER (PARTITION BY day_key ORDER BY item_count DESC, latitude_cell ASC, longitude_cell ASC) AS rank")
	type row struct {
		DayKey        string
		LatitudeCell  int64
		LongitudeCell int64
		ItemCount     int64
	}
	var rows []row
	if err := db.WithContext(ctx).Table("(?) AS ranked_days", ranked).
		Select("day_key, latitude_cell, longitude_cell, item_count").
		Where("rank = 1").Order("day_key ASC").Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]mediaMemoryTripDay, 0, len(rows))
	for _, row := range rows {
		day, err := time.Parse("2006-01-02", row.DayKey)
		if err != nil {
			return nil, err
		}
		out = append(out, mediaMemoryTripDay{
			Date: mediaMemoryDate(day), DateKey: row.DayKey,
			LatitudeCell: row.LatitudeCell, LongitudeCell: row.LongitudeCell,
			ItemCount: row.ItemCount,
		})
	}
	return out, nil
}

// Resolve every travel day once. The SQL aggregate has O(days) response size,
// even for 100k photos or thousands of 0.01-degree places. The 64-bit hash
// is a staleness detector only; Owner authorization and live Range checks
// are always repeated and never derived from this digest.
func verifyMediaExactTripMembership(
	ctx context.Context, db *gorm.DB, ownerID uint64, zone string,
	dominant []mediaMemoryTripDay, segments []mediaMemoryTripSegment,
) ([]mediaMemoryTripSegment, error) {
	if len(segments) == 0 {
		return segments, nil
	}
	homeLat, homeLon, ok := mediaExactTripHome(dominant)
	if !ok {
		return nil, fmt.Errorf("no trustworthy trip home location")
	}
	dayToSegment := make(map[string]int)
	for index, segment := range segments {
		for _, day := range segment.Days {
			if _, exists := dayToSegment[day.DateKey]; exists {
				return nil, fmt.Errorf("overlapping exact trip day")
			}
			dayToSegment[day.DateKey] = index
		}
	}
	keys := make([]string, 0, len(dayToSegment))
	for key := range dayToSegment {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	dayExpr := mediaIANAZoneExpression("TO_CHAR(xd_media_metadata.captured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')", zone)
	awaySQL, awayArgs := mediaExactTripAwayPredicate(homeLat, homeLon)
	// Mix Node identity, revision, full coordinate and capture instant. A
	// count-preserving GPS edit must not preserve an old trip URL or map.
	const checksumSQL = "BIT_XOR(('x' || LEFT(MD5(CONCAT_WS(':', " +
		"xd_media_metadata.node_id::text, xd_media_metadata.node_revision::text, " +
		"xd_media_metadata.latitude::text, xd_media_metadata.longitude::text, " +
		"xd_media_metadata.captured_at::text)), 16))::bit(64)::bigint)"
	type daySummary struct {
		DayKey      string
		MemberCount int64
		Fingerprint int64
	}
	var rows []daySummary
	base, err := (&Server{DB: db}).mediaItemsBaseQuery(
		ctx, ownerID, mediaQueryOptions{}, "")
	if err != nil {
		return nil, err
	}
	query := base.
		Where("xd_media_metadata.index_state = ? AND xd_media_metadata.captured_at IS NOT NULL AND "+
			mediaPlaceValidGPSPredicate, meta.MediaIndexStateReady).
		Where(dayExpr+" IN ?", keys).Where(awaySQL, awayArgs...).
		Select(dayExpr + " AS day_key, COUNT(DISTINCT xd_media_metadata.node_id) AS member_count, " +
			checksumSQL + " AS fingerprint").
		Group("day_key").Order("day_key ASC")
	if err := query.Scan(&rows).Error; err != nil {
		return nil, err
	}
	byDay := make(map[string]daySummary, len(rows))
	for _, row := range rows {
		if row.MemberCount < 1 || dayToSegment[row.DayKey] >= len(segments) {
			return nil, fmt.Errorf("invalid exact trip day summary")
		}
		if _, exists := dayToSegment[row.DayKey]; !exists {
			return nil, fmt.Errorf("out-of-scope exact trip day")
		}
		byDay[row.DayKey] = row
	}
	for i := range segments {
		segment := &segments[i]
		segment.ExactVerified = true
		segment.HomeLatitudeCell = homeLat
		segment.HomeLongitudeCell = homeLon
		fingerprint := sha256.New()
		fmt.Fprintf(fingerprint, "home:%d:%d;", homeLat, homeLon)
		var count int64
		for _, day := range segment.Days {
			row, present := byDay[day.DateKey]
			if !present {
				return nil, fmt.Errorf("travel day no longer has away GPS media")
			}
			fmt.Fprintf(fingerprint, "%s:%d:%d;", day.DateKey, row.MemberCount, row.Fingerprint)
			count += row.MemberCount
		}
		segment.ItemCount = count
		segment.MemberFingerprint = hex.EncodeToString(fingerprint.Sum(nil)[:12])
	}
	return segments, nil
}
