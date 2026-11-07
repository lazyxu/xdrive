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
