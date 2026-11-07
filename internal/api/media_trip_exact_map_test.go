package api

import (
	"strings"
	"testing"
)

func TestMediaExactTripPlaceExpressionsCanonicalizeDateLine(t *testing.T) {
	lat, lon := mediaExactTripPlaceExpressions()
	if !strings.Contains(lat, "FLOOR(xd_media_metadata.latitude * 100)") {
		t.Fatalf("trip map latitude cell differs from ordinary place grid: %q", lat)
	}
	if !strings.Contains(lon, "CASE WHEN xd_media_metadata.longitude = 180 THEN -180") ||
		!strings.Contains(lon, "* 100)::bigint") {
		t.Fatalf("trip map does not canonicalize the WGS84 date line: %q", lon)
	}
	place, valid := parseMediaPlaceKey("place:1000:-18000")
	if !valid || mediaPlaceKey(place) != "place:1000:-18000" {
		t.Fatalf("wrong trip-map canonical place: %+v, valid=%v", place, valid)
	}
	for _, invalid := range []string{
		"place:10:18001", "place:9001:0", "map-region:q:0:0:1:1:0:0",
		"trip:v2:2026-01-01:2026-01-02:000000000000000000000000",
	} {
		if _, ok := parseMediaPlaceKey(invalid); ok {
			t.Fatalf("non-place ID admitted as trip map cell: %q", invalid)
		}
	}
}
