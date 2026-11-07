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
		"west": {"175"}, "south": {"-20"},
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
    if count != 64 { t.Fatal("missing one aggregate display region") }
    for _, invalid := range [][2]int{{-1, 0}, {0, 8}, {8, 0}} {
        if _, ok := mediaMapOverviewBucketBounds(fitted, invalid[0], invalid[1]); ok {
            t.Fatalf("invalid region index admitted: %v", invalid)
        }
    }
}
