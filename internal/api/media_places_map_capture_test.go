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
		"captured_from=2026-01-01&captured_to=2028-01-01",
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
