package api

import "testing"

func TestMediaPlaceKeyRoundTrip(t *testing.T) {
	for _, cell := range []mediaPlaceCell{
		{Latitude: 123, Longitude: 456},
		{Latitude: -1234, Longitude: 17999},
		{Latitude: -9000, Longitude: -18000},
		{Latitude: 9000, Longitude: 18000},
	} {
		key := mediaPlaceKey(cell)
		got, ok := parseMediaPlaceKey(key)
		if !ok || got != cell {
			t.Fatalf("key=%q got=%+v ok=%v want=%+v", key, got, ok, cell)
		}
	}
}

func TestParseMediaPlaceKeyRejectsInvalidValues(t *testing.T) {
	for _, value := range []string{
		"",
		"place",
		"place:1",
		"place:1:2:3",
		"folder:1:2",
		"place:9001:0",
		"place:0:18001",
		"place:not-a-number:1",
	} {
		if _, ok := parseMediaPlaceKey(value); ok {
			t.Fatalf("accepted invalid place key %q", value)
		}
	}
}

func TestMediaPlaceBoundsAndCenter(t *testing.T) {
	cell := mediaPlaceCell{Latitude: 3123, Longitude: 12147}
	latMin, latMax, lonMin, lonMax := mediaPlaceBounds(cell)
	if latMin != 31.23 || latMax != 31.24 ||
		lonMin != 121.47 || lonMax != 121.48 {
		t.Fatalf("bounds=%v,%v %v,%v", latMin, latMax, lonMin, lonMax)
	}
	lat, lon := mediaPlaceCenter(cell)
	if lat != 31.235 || lon != 121.475 {
		t.Fatalf("center=%v,%v", lat, lon)
	}
	if got := mediaPlaceName(cell); got != "约 31.235°, 121.475°" {
		t.Fatalf("name=%q", got)
	}
}

func TestMediaPlaceMapFacetLimit(t *testing.T) {
	if mediaPlaceDefaultLimit != 24 {
		t.Fatalf("default limit=%d want 24", mediaPlaceDefaultLimit)
	}
	if mediaPlaceMaxLimit != 1000 {
		t.Fatalf("max limit=%d want 1000", mediaPlaceMaxLimit)
	}
}

func TestMediaPlacePageCountAndGPSPredicate(t *testing.T) {
	for _, tc := range []struct {
		total            int64
		offset, returned int
		more             bool
	}{
		{total: 31, offset: 0, returned: 24, more: true},
		{total: 31, offset: 24, returned: 7, more: false},
		{total: 0, offset: 0, returned: 0, more: false},
		{total: 100000, offset: 99948, returned: 48, more: true},
		{total: 100000, offset: 99996, returned: 4, more: false},
	} {
		if got := mediaPlaceHasMore(tc.total, tc.offset, tc.returned); got != tc.more {
			t.Fatalf("page total=%d offset=%d returned=%d: has_more=%v want %v",
				tc.total, tc.offset, tc.returned, got, tc.more)
		}
	}
	if mediaPlacePageDefaultLimit != 48 || mediaPlacePageMaxLimit != 100 ||
		mediaPlacePageMaxOffset < 100000 {
		t.Fatal("page defaults should preserve 100k+ sparse navigation")
	}
	if mediaPlaceValidGPSPredicate == "" {
		t.Fatal("Gallery GPS and Places must share one valid coordinate predicate")
	}
}
