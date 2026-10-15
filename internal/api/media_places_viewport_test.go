package api

import (
	"context"
	"math"
	"testing"
)

func TestParseMediaPlaceViewportStrictlyBounded(t *testing.T) {
	tests := []struct {
		name, query   string
		wrap          bool
		limit, offset int
	}{
		{"world", "west=-180&south=-90&east=180&north=90", false, 64, 0},
		{"antimeridian", "west=170&south=-1&east=-170&north=1&limit=12&offset=8", true, 12, 8},
		{"legal polar edge", "west=170&south=89.99&east=-170&north=90", true, 64, 0},
		{"zero location", "west=-1&south=-1&east=1&north=1&limit=100", false, 100, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, limit, offset, err := parseMediaPlaceViewport(tt.query)
			if err != nil || limit != tt.limit || offset != tt.offset ||
				(got.West > got.East) != tt.wrap {
				t.Fatalf("viewport %+v limit %d offset %d error %v", got, limit, offset, err)
			}
		})
	}
}

func TestMediaPlaceViewportRejectsBadOrAmbiguousRanges(t *testing.T) {
	const good = "west=-180&south=-90&east=180&north=90"
	for _, query := range []string{
		"",
		"south=-90&east=180&north=90",
		"west=-180&south=-90&east=180&north=90&west=0",
		good + "&ak=secret",
		good + "&limit=0",
		good + "&limit=101",
		good + "&offset=-1",
		good + "&offset=10000001",
		good + "&offset=NaN",
		good + "&north=91",
		good + "&north=NaN",
		good + "&north=Inf",
		good + "&west=%GG",
		"west=1&south=0&east=1&north=1",
		"west=0&south=0&east=1&north=0",
		"west=180&south=-1&east=-180&north=1",
		"west= 0&south=-1&east=1&north=1",
	} {
		if _, _, _, err := parseMediaPlaceViewport(query); err == nil {
			t.Errorf("accepted malformed viewport query %q", query)
		}
	}
	if mediaPlaceViewportQueryTimeout <= 0 || mediaPlaceViewportMaxLimit > 100 {
		t.Fatal("viewport requests must remain bounded")
	}
}

func TestMediaPlaceViewportInputCannotBypassOwnerOrContext(t *testing.T) {
	bounds := mediaPlaceViewportBounds{West: -180, South: -90, East: 180, North: 90}
	if _, err := queryMediaPlacesViewport(context.Background(), nil, 1, bounds, 64, 0); err == nil {
		t.Fatal("nil database accepted")
	}
	if _, err := queryMediaPlacesViewport(context.Background(), nil, 0, bounds, 64, 0); err == nil {
		t.Fatal("missing owner accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := queryMediaPlacesViewport(ctx, nil, 1, bounds, 64, 0); err == nil {
		t.Fatal("cancelled request accepted")
	}
	bounds.North = math.NaN()
	if bounds.valid() {
		t.Fatal("internal NaN bound accepted")
	}
	if _, _, _, err := parseMediaPlaceViewport("west=-1&south=-1&east=1&north=NaN"); err == nil {
		t.Fatal("HTTP NaN bound accepted")
	}
}
