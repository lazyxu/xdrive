package api

import (
	"net/url"
	"testing"
	"time"
)

func TestMediaMapOverviewCalendarScopeUsesSameDSTInstants(t *testing.T) {
	input := url.Values{
		"west": {"-180"}, "south": {"-85"},
		"east": {"180"}, "north": {"85"},
		"detail":        {"1"},
		"time_zone":     {"Europe/London"},
		"captured_from": {"2026-03-29"},
		"captured_to":   {"2026-03-30"},
	}
	b, detail, date, err := parseMediaMapOverviewScopedQuery(input.Encode())
	if err != nil || !detail || !b.valid() || date == nil || !date.valid() {
		t.Fatalf("valid map calendar scope rejected: %+v %v %+v %v", b, detail, date, err)
	}
	if got := date.To.Sub(date.From); got != 23*time.Hour {
		t.Fatalf("DST day widened to a generic 24h scope: %s", got)
	}
	for _, test := range []string{
		"captured_from=2026-01-01", "captured_from=2026-01-01&captured_to=2026-01-01",
		"captured_from=2026-01-03&captured_to=2026-01-01",
		"captured_from=2026-01-01&captured_to=2026-02-01&captured_from=2026-01-01",
		"captured_from=2026-01-01&captured_to=2026-02-01&time_zone=Not/AZone",
		"captured_from=2026-01-01&captured_to=2026-02-01&time_zone=UTC&time_zone=UTC",
	} {
		if _, _, _, err := parseMediaMapOverviewScopedQuery(
			"west=-180&south=-85&east=180&north=85&" + test,
		); err == nil {
			t.Fatalf("invalid date/map query permitted: %q", test)
		}
	}
}

func TestMediaAggregateDrilldownBoundsAreDisplayOnly(t *testing.T) {
	original := mediaPlaceViewportBounds{West: 175, South: -12, East: -175, North: 12}
	total := 0
	for row := 0; row < mediaMapOverviewAxis; row++ {
		for col := 0; col < mediaMapOverviewAxis; col++ {
			rect, ok := mediaMapOverviewBucketBounds(original, row, col)
			if !ok || !rect.valid() {
				t.Fatalf("invalid bounded MapKit drilldown %d/%d: %+v", row, col, rect)
			}
			total++
		}
	}
	if total != 64 {
		t.Fatal("aggregate display exceeded 64 regions")
	}
}

func TestMediaMapOverviewAcceptsExplicitMultiYearRangeWithoutBroadeningOwner(t *testing.T) {
	base := "west=-180&south=-85&east=180&north=85&"
	for _, dates := range []string{
		"captured_from=2000-01-01&captured_to=2026-01-01",
		"captured_from=1900-01-01&captured_to=2100-01-01",
	} {
		_, _, scope, err := parseMediaMapOverviewScopedQuery(base + dates)
		if err != nil || scope == nil || !scope.valid() {
			t.Fatalf("explicit multi-year map interval rejected: %q: %v", dates, err)
		}
	}
	for _, dates := range []string{
		"captured_from=2026-01-01&captured_to=2025-01-01",
		"captured_from=2026-01-01",
		"captured_to=2028-01-01",
	} {
		if _, _, _, err := parseMediaMapOverviewScopedQuery(base + dates); err == nil {
			t.Fatalf("invalid multi-year map interval accepted: %q", dates)
		}
	}
}

func TestMediaMapOverviewNativeMediaAndLiteralFilenameFilter(t *testing.T) {
	base := "west=-180&south=-85&east=180&north=85&detail=1"
	for _, scenario := range []struct{
		query string
		media string
		asset string
		filename string
	}{
		{"&filename=IMG_001.JPG", "", "", "IMG_001.JPG"},
		{"&kind=video", "video", "", ""},
		{"&kind=image&filename=photo.heic", "image", "", "photo.heic"},
		{"&asset_kind=live_photo&filename=A%25_B", "", "live_photo", "A%_B"},
	} {
		bounds, detail, scope, err := parseMediaMapOverviewScopedQuery(base + scenario.query)
		if err != nil || !detail || !bounds.valid() || scope == nil || !scope.valid() ||
			scope.MediaKind != scenario.media || scope.AssetKind != scenario.asset ||
			scope.Filename != scenario.filename {
			t.Fatalf("invalid map filter: %q -> %+v %v", scenario.query, scope, err)
		}
	}
	for _, reject := range []string{
		"&filename=", "&filename=one&filename=two", "&filename=%00",
		"&kind=audio", "&kind=image&kind=video", "&asset_kind=unknown",
		"&filename=%20spaces%20", "&kind=video&asset_kind=unexpected",
	} {
		if _, _, _, err := parseMediaMapOverviewScopedQuery(base + reject); err == nil {
			t.Fatalf("invalid map filter accepted: %s", reject)
		}
	}
}
