package main

import (
	"testing"
)

func TestMediaPlacesViewportAgentQueryContract(t *testing.T) {
	for _, item := range []struct {
		query         string
		west, east    float64
		limit, offset int
	}{
		{"west=-180&south=-90&east=180&north=90", -180, 180, 64, 0},
		{"west=170&south=0&east=-170&north=1&limit=100&offset=13", 170, -170, 100, 13},
		{"west=-1&south=-1&east=1&north=1&limit=1", -1, 1, 1, 0},
	} {
		bounds, limit, offset, err := parseDesktopIPCMediaPlacesViewport(item.query)
		if err != nil || bounds.West != item.west || bounds.East != item.east ||
			limit != item.limit || offset != item.offset {
			t.Fatalf("viewport %+v %d %d error %v", bounds, limit, offset, err)
		}
	}
	for _, q := range []string{
		"", "west=0&south=0&east=1", "west=0&west=1&south=0&east=1&north=1",
		"west=0&south=0&east=1&north=1&ak=secret",
		"west=0&south=0&east=1&north=1&limit=101",
		"west=0&south=0&east=1&north=1&offset=-1",
		"west=0&south=0&east=1&north=1&offset=10000001",
		"west=0&south=0&east=1&north=NaN",
		"west=0&south=0&east=1&north=Inf",
		"west=%GG&south=0&east=1&north=1",
		"west=0&south=0&east=0&north=1",
		"west=0&south=1&east=1&north=0",
		"west=180&south=0&east=-180&north=1",
		"west= 0&south=0&east=1&north=1",
	} {
		if _, _, _, err := parseDesktopIPCMediaPlacesViewport(q); err == nil {
			t.Fatalf("unsafe viewport accepted")
		}
	}
}
