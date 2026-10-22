package api

import (
	"math"
	"strings"
	"testing"
)

func TestMediaPlacesMapOverviewParserBoundsAndDetail(t *testing.T) {
	cases := []struct {
		input  string
		valid  bool
		detail bool
	}{
		{"west=-180&south=-85&east=180&north=85", true, false},
		{"west=170&south=-10&east=-170&north=10&detail=1", true, true},
		{"west=-180&south=-85&east=180&north=85&detail=0", true, false},
		{"west=-180&south=-85&east=180&north=85&detail=2", false, false},
		{"west=-180&south=-85&east=180&north=85&detail=1&detail=0", false, false},
		{"west=-180&south=-85&east=180&north=85&limit=100000", false, false},
		{"west=-180&south=-85&east=180&north=85&owner=2", false, false},
		{"west=180&south=-85&east=-180&north=85", false, false},
	}
	for _, tt := range cases {
		_, detail, err := parseMediaMapOverviewQuery(tt.input)
		if (err == nil) != tt.valid || (tt.valid && detail != tt.detail) {
			t.Errorf("%s valid=%v detail=%v error=%v", tt.input, tt.valid, detail, err)
		}
	}
}

func TestMediaMapOverviewExpressionIsFiniteAndBounded(t *testing.T) {
	b := mediaPlaceViewportBounds{West: 170, East: -170, South: -10, North: 10}
	lat, lon := mediaMapOverviewBuckets(b)
	if !strings.Contains(lon, "longitude + 360") || !strings.Contains(lat, "LEAST(7") ||
		!strings.Contains(lon, "LEAST(7") {
		t.Fatal("world-wrap or bounded grid lost")
	}
	b.West = math.Inf(1)
	if b.valid() {
		t.Fatal("non-finite bounds accepted")
	}
}

func testMediaOverviewBucket(b mediaPlaceViewportBounds, latitude, longitude float64) [2]int {
	span := b.East - b.West
	if span < 0 {
		span += 360
		if longitude < b.West {
			longitude += 360
		}
	}
	row := math.Min(7, math.Max(0, math.Floor((latitude-b.South)/(b.North-b.South)*8)))
	col := math.Min(7, math.Max(0, math.Floor((longitude-b.West)/span*8)))
	return [2]int{int(row), int(col)}
}

func TestMediaMapOverviewJinhuaWorldCellRegression(t *testing.T) {
	// Screenshot regression: eight independent real GPS coordinates around
	// Jinhua all disappear into ONE 45x21.25-degree world bucket. Its single
	// sample would misleadingly appear to represent 3,128 photographs at
	// exactly one position, despite many actual distinct place cells.
	positions := [][2]float64{
		{29.08, 119.27}, {29.21, 119.54}, {29.34, 119.81},
		{29.45, 120.08}, {28.95, 119.72}, {29.52, 119.36},
		{29.75, 119.89}, {29.12, 120.15},
	}
	world := mediaPlaceViewportBounds{West: -180, South: -85, East: 180, North: 85}
	before := map[[2]int]bool{}
	for _, position := range positions {
		before[testMediaOverviewBucket(world, position[0], position[1])] = true
	}
	if len(before) != 1 {
		t.Fatalf("fixture lost world-grid regression; got %d", len(before))
	}
	minLat, maxLat, minLon, maxLon := 28.95, 29.75, 119.27, 120.15
	fitted, found, err := mediaMapOverviewFittedBounds(world, mediaMapOverviewExtent{
		MinLatitude: &minLat, MaxLatitude: &maxLat,
		MinLongitude: &minLon, MaxLongitude: &maxLon,
		MinShiftedLongitude: &minLon, MaxShiftedLongitude: &maxLon,
	})
	if err != nil || !found || !fitted.valid() {
		t.Fatalf("Owner's actual GPS envelope was rejected: %+v found=%t err=%v", fitted, found, err)
	}
	after := map[[2]int]bool{}
	for _, position := range positions {
		after[testMediaOverviewBucket(fitted, position[0], position[1])] = true
	}
	if len(after) != 8 {
		t.Fatalf("all Jinhua photo positions still collapsed: before=%d after=%d bounds=%+v",
			len(before), len(after), fitted)
	}
	if fitted.East-fitted.West >= 2 || fitted.North-fitted.South >= 2 {
		t.Fatalf("world bounds leaked into local GPS grid: %+v", fitted)
	}
}

func TestMediaMapOverviewFittedBoundsDegenerateAndWrapped(t *testing.T) {
	world := mediaPlaceViewportBounds{West: -180, South: -85, East: 180, North: 85}
	fitted, found, err := mediaMapOverviewFittedBounds(world, mediaMapOverviewExtent{})
	if err != nil || found || fitted != world {
		t.Fatalf("empty Owner should have no fabricated samples: %+v found=%t err=%v", fitted, found, err)
	}
	pointLat, pointLon := 29.23, 119.73
	single := mediaMapOverviewExtent{
		MinLatitude: &pointLat, MaxLatitude: &pointLat,
		MinLongitude: &pointLon, MaxLongitude: &pointLon,
		MinShiftedLongitude: &pointLon, MaxShiftedLongitude: &pointLon,
	}
	fitted, found, err = mediaMapOverviewFittedBounds(world, single)
	if err != nil || !found || !fitted.valid() ||
		testMediaOverviewBucket(fitted, pointLat, pointLon)[0] > 7 {
		t.Fatalf("single real coordinate must stay finite: %+v err=%v", fitted, err)
	}
	left, right := -179.8, 179.7
	shiftLeft, shiftRight := 179.7, 180.2
	latMin, latMax := 10.0, 11.0
	wrapped := mediaMapOverviewExtent{
		MinLatitude: &latMin, MaxLatitude: &latMax,
		MinLongitude: &left, MaxLongitude: &right,
		MinShiftedLongitude: &shiftLeft, MaxShiftedLongitude: &shiftRight,
	}
	fitted, found, err = mediaMapOverviewFittedBounds(world, wrapped)
	if err != nil || !found || !fitted.valid() || fitted.West <= fitted.East {
		t.Fatalf("dateline observations must retain a short wrapped arc: %+v err=%v", fitted, err)
	}
	if testMediaOverviewBucket(fitted, latMin, right) ==
		testMediaOverviewBucket(fitted, latMax, left) {
		t.Fatalf("two distinct dateline locations still share a bucket: %+v", fitted)
	}
	bad := math.NaN()
	wrapped.MinLatitude = &bad
	if _, _, err := mediaMapOverviewFittedBounds(world, wrapped); err == nil {
		t.Fatal("nonfinite GPS extent was accepted")
	}
}

func TestMediaMapOverviewFitsWithoutLeavingRequestedViewport(t *testing.T) {
	requested := mediaPlaceViewportBounds{West: 119.4, South: 29.1, East: 119.8, North: 29.5}
	minLat, maxLat, minLon, maxLon := 29.1, 29.4, 119.4, 119.8
	fitted, found, err := mediaMapOverviewFittedBounds(requested, mediaMapOverviewExtent{
		MinLatitude: &minLat, MaxLatitude: &maxLat,
		MinLongitude: &minLon, MaxLongitude: &maxLon,
		MinShiftedLongitude: &minLon, MaxShiftedLongitude: &maxLon,
	})
	if err != nil || !found || fitted.West < requested.West ||
		fitted.East > requested.East || fitted.South < requested.South ||
		fitted.North > requested.North {
		t.Fatalf("fitted extent escaped the currently queried Owner viewport: %+v err=%v", fitted, err)
	}
}
