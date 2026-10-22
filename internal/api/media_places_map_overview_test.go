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
