package geoquery

import (
	"math"
	"testing"
)

func TestNearbyAndBBoxSelectionFiniteStrictAndBounded(t *testing.T) {
	for _, tc := range []struct{ near, bbox string }{
		{"0,0,1", ""},
		{"90,180,0.1", ""},
		{"-90,-180,200", ""},
		{"", "179,-1,-179,1"},
		{"", "0,0,1,1"},
	} {
		got, err := Parse(tc.near, tc.bbox)
		if err != nil || got == nil {
			t.Fatalf("valid near=%q bbox=%q: %+v %v", tc.near, tc.bbox, got, err)
		}
	}
	for _, tc := range []struct{ near, bbox string }{
		{"0,0,0", ""}, {"0,0,201", ""}, {"91,0,5", ""},
		{"0,181,5", ""}, {"NaN,0,5", ""}, {"Inf,0,5", ""},
		{"0,0,5,", ""}, {"0,0,5 ", ""}, {"0,0,1", "0,0,1,1"},
		{"", "-180,-90,180,90"}, {"", "0,0,21,1"},
		{"", "0,0,1,21"}, {"", "1,1,1,2"},
		{"", "180,-1,-180,1"}, {"", "NaN,0,1,1"},
	} {
		if result, err := Parse(tc.near, tc.bbox); err == nil || result != nil {
			t.Errorf("accepted near=%q bbox=%q: %+v", tc.near, tc.bbox, result)
		}
	}
	if got, err := Parse("", ""); err != nil || got != nil {
		t.Fatalf("empty filter %+v %v", got, err)
	}
}

func TestNearbyCoarseBoundsAntimeridianAndPole(t *testing.T) {
	dateline := Nearby{Latitude: 0, Longitude: 179.99, RadiusKM: 5}
	south, north, west, east, all := dateline.RadiusBounds()
	if all || !(west > east) || south >= 0 || north <= 0 {
		t.Fatalf("dateline bounds %.6f %.6f %.6f %.6f all=%v", south, north, west, east, all)
	}
	polar := Nearby{Latitude: 89.999, Longitude: -70, RadiusKM: 5}
	_, north, _, _, all = polar.RadiusBounds()
	if !all || north != 90 {
		t.Fatalf("pole bounds north=%v all=%v", north, all)
	}
	if math.Abs(EarthRadiusKM-6371.0088) > 0.001 || MaxRadiusKM > 200 || MaxBBoxSpan > 20 {
		t.Fatal("A4 bounded policy drift")
	}
}
