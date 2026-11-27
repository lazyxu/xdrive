package api

import (
	"net/url"
	"testing"
	"time"
)

func TestMediaExactTripHomeAndDatelineExclusion(t *testing.T) {
	day := func(d int, lat, lon int64) mediaMemoryTripDay {
		date := time.Date(2026, 1, d, 0, 0, 0, 0, time.UTC)
		return mediaMemoryTripDay{Date: date, DateKey: date.Format("2006-01-02"),
			LatitudeCell: lat, LongitudeCell: lon}
	}
	lat, lon, ok := mediaExactTripHome([]mediaMemoryTripDay{
		day(1, 10, 900), day(2, 10, -900), day(3, 10, -900),
		day(4, 50, 200), day(5, 55, -100),
	})
	if !ok || lat != 10 || lon != -900 {
		t.Fatalf("dateline home mismatch: lat=%d lon=%d ok=%v", lat, lon, ok)
	}
	predicate, args := mediaExactTripAwayPredicate(lat, lon)
	if predicate == "" || len(args) != 3 {
		t.Fatalf("missing away membership filter: %q %v", predicate, args)
	}
	near, ok := args[2].([]int64)
	if !ok || len(near) != 3 ||
		near[0] != 899 || near[1] != -900 || near[2] != -899 {
		t.Fatalf("antimeridian home vicinity not canonical: %v", args)
	}
	if _, _, ok := mediaExactTripHome([]mediaMemoryTripDay{day(1, 10, 10)}); ok {
		t.Fatal("one GPS date was incorrectly promoted to a home location")
	}
}

func TestMediaExactTripMapViewportParamsFailClosed(t *testing.T) {
	world, err := mediaExactTripMapRequestBounds("time_zone=UTC")
	if err != nil || world.West != -180 || world.East != 180 {
		t.Fatalf("default map should be full world: %+v %v", world, err)
	}
	values := url.Values{
		"time_zone": {"Europe/London"},
		"west":      {"175"}, "south": {"-20"},
		"east": {"-175"}, "north": {"40"},
	}
	wrapped, err := mediaExactTripMapRequestBounds(values.Encode())
	if err != nil || wrapped.West <= wrapped.East {
		t.Fatalf("valid WGS84 antimeridian viewport rejected: %+v %v", wrapped, err)
	}
	for _, raw := range []string{
		"west=1", "west=1&south=2&east=3&north=4&unknown=1",
		"west=1&south=2&east=3&north=4&west=5",
		"west=NaN&south=-1&east=3&north=4",
		"west=180&south=-1&east=-180&north=4",
		"west=1&south=2&east=1&north=4",
	} {
		if _, err := mediaExactTripMapRequestBounds(raw); err == nil {
			t.Fatalf("invalid map bounds admitted: %q", raw)
		}
	}
}

func TestMediaExactTripPromotionRequiresOneSideAwayEvidence(t *testing.T) {
	day := func(n int, lat, lon int64, count int64) mediaMemoryTripDay {
		date := time.Date(2026, time.January, n, 0, 0, 0, 0, time.UTC)
		return mediaMemoryTripDay{
			Date: date, DateKey: date.Format("2006-01-02"),
			LatitudeCell: lat, LongitudeCell: lon, ItemCount: count,
		}
	}
	original := []mediaMemoryTripDay{
		day(1, 5, 5, 3), day(2, 5, 5, 3),
		day(3, 5, 5, 7), day(4, 40, 40, 3),
		day(5, 45, 45, 4), day(6, 5, 5, 10),
		day(7, 70, 70, 3), day(8, 75, 75, 4),
		day(9, 5, 5, 3),
	}
	candidates := []mediaMemoryTripDay{
		day(1, 40, 40, 2), // isolated routine: no neighboring away day
		day(3, 40, 40, 2), // first travel-day transition
		day(6, 45, 45, 2), // return home AND another trip: ambiguous
		day(9, 75, 75, 1), // below genuine off-home evidence threshold
	}
	chosen := mediaExactTripPromoteTransitDays(original, candidates, 5, 5)
	if chosen[0].LatitudeCell != 5 ||
		chosen[2].LatitudeCell != 40 ||
		chosen[5].LatitudeCell != 5 ||
		chosen[8].LatitudeCell != 5 {
		t.Fatalf("away-day promotion merged home/commute/overlapping trips: %+v", chosen)
	}
	segments := mediaMemoryTripSegments(chosen)
	if len(segments) != 2 ||
		len(segments[0].Days) != 3 ||
		len(segments[1].Days) != 2 {
		t.Fatalf("two independent home-separated trips were merged: %+v", segments)
	}
}

func TestMapOverviewDisplayOnlyBucketBoundsNeverWidenBeyondFitted(t *testing.T) {
	fitted := mediaPlaceViewportBounds{
		West: 170, South: -20, East: -170, North: 20,
	}
	var count int
	for row := 0; row < 8; row++ {
		for col := 0; col < 8; col++ {
			b, ok := mediaMapOverviewBucketBounds(fitted, row, col)
			if !ok || !b.valid() || b.North <= b.South {
				t.Fatalf("invalid WGS84 aggregate rectangle %d,%d: %+v", row, col, b)
			}
			count++
		}
	}
	if count != 64 {
		t.Fatal("missing one aggregate display region")
	}
	for _, invalid := range [][2]int{{-1, 0}, {0, 8}, {8, 0}} {
		if _, ok := mediaMapOverviewBucketBounds(fitted, invalid[0], invalid[1]); ok {
			t.Fatalf("invalid region index admitted: %v", invalid)
		}
	}
}

func TestMediaExactTripCivilDayDeltaDSTAndTimezone(t *testing.T) {
	// These midnight instants are 23/25 hours apart across New York DST,
	// but calendar-neighbor travel days must still be adjacent.
	zone, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	for _, dates := range [][2]string{
		{"2026-03-08", "2026-03-09"},
		{"2026-11-01", "2026-11-02"},
		{"2026-12-31", "2027-01-01"},
	} {
		first, _ := time.ParseInLocation("2006-01-02", dates[0], zone)
		second, _ := time.ParseInLocation("2006-01-02", dates[1], zone)
		if first.Equal(second) {
			t.Fatalf("test does not represent distinct days: %v", dates)
		}
		if delta := mediaExactTripCivilDayDelta(dates[1], dates[0]); delta != 1 {
			t.Fatalf("forward adjacent dates %v yielded %d", dates, delta)
		}
		if delta := mediaExactTripCivilDayDelta(dates[0], dates[1]); delta != -1 {
			t.Fatalf("backward adjacent dates %v yielded %d", dates, delta)
		}
	}
	for _, pair := range [][2]string{
		{"2026-03-10", "2026-03-08"}, {"2026-02-30", "2026-03-01"},
		{"2026-03-08", "2026-03-08"}, {"2026-3-08", "2026-03-07"},
	} {
		if got := mediaExactTripCivilDayDelta(pair[0], pair[1]); got != 0 {
			t.Fatalf("non-neighbor/invalid dates %v admitted: %d", pair, got)
		}
	}
}

func TestMediaExactTripPromotionUsesCivilDaysEvenWithDSTShift(t *testing.T) {
	zone, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	mk := func(date string, lat, lon, count int64) mediaMemoryTripDay {
		value, parseErr := time.ParseInLocation("2006-01-02", date, zone)
		if parseErr != nil {
			t.Fatal(parseErr)
		}
		return mediaMemoryTripDay{
			Date: value, DateKey: date,
			LatitudeCell: lat, LongitudeCell: lon, ItemCount: count,
		}
	}
	dominant := []mediaMemoryTripDay{
		mk("2026-03-06", 5, 5, 4), mk("2026-03-07", 5, 5, 4),
		mk("2026-03-08", 5, 5, 12),  // return with off-home GPS, true near home dominant
		mk("2026-03-09", 30, 30, 5), // neighbor away across DST
		mk("2026-03-10", 40, 40, 6),
	}
	candidates := []mediaMemoryTripDay{mk("2026-03-08", 20, 20, 2)}
	chosen := mediaExactTripPromoteTransitDays(dominant, candidates, 5, 5)
	if chosen[2].LatitudeCell != 20 {
		t.Fatalf("genuine DST transition trip day was wrongly excluded: %+v", chosen)
	}
	// Home -> another genuine trip -> home must not merge on a shared day.
	dominant[1] = mk("2026-03-07", 50, 50, 4)
	chosen = mediaExactTripPromoteTransitDays(dominant, candidates, 5, 5)
	if chosen[2].LatitudeCell != 5 {
		t.Fatalf("home return and second departure must remain separate: %+v", chosen)
	}
}
