package api

import (
	"fmt"
	"testing"
	"time"
)

func TestParseMediaMemoryID(t *testing.T) {
	recent, ok := parseMediaMemoryID("recent:2026-10-07")
	if !ok ||
		recent.Kind != mediaMemoryKindRecentDay ||
		recent.Start.Format("2006-01-02") != "2026-10-07" ||
		recent.End.Format("2006-01-02") != "2026-10-08" {
		t.Fatalf("recent=%+v ok=%v", recent, ok)
	}

	onThisDay, ok := parseMediaMemoryID("on-this-day:2026:10-07")
	if !ok ||
		onThisDay.Kind != mediaMemoryKindOnThisDay ||
		onThisDay.AnchorYear != 2026 ||
		onThisDay.Month != time.October ||
		onThisDay.Day != 7 {
		t.Fatalf("on this day=%+v ok=%v", onThisDay, ok)
	}

	trip, ok := parseMediaMemoryID("trip:v1:2026-09-30:2026-10-03")
	if !ok ||
		trip.Kind != mediaMemoryKindTrip ||
		trip.Start.Format("2006-01-02") != "2026-09-30" ||
		trip.End.Format("2006-01-02") != "2026-10-04" {
		t.Fatalf("trip=%+v ok=%v", trip, ok)
	}

	for _, invalid := range []string{
		"",
		"recent:not-a-date",
		"on-this-day:2026:02-30",
		"trip:v1:2026-10-08:2026-10-07",
		"trip:v2:2026-10-01:2026-10-02",
	} {
		if _, ok := parseMediaMemoryID(invalid); ok {
			t.Fatalf("invalid memory id accepted: %q", invalid)
		}
	}
}

func TestMediaMemoryTripSegmentsUsesHomeDaysAndAwayRuns(t *testing.T) {
	day := func(day int, lat, lon int64, count int64, name string) mediaMemoryTripDay {
		value := time.Date(2026, time.January, day, 0, 0, 0, 0, time.UTC)
		nodeID := uint64(day)
		return mediaMemoryTripDay{
			Date:          value,
			DateKey:       value.Format("2006-01-02"),
			LatitudeCell:  lat,
			LongitudeCell: lon,
			ItemCount:     count,
			CoverNodeID:   &nodeID,
			PlaceName:     name,
		}
	}

	days := []mediaMemoryTripDay{
		day(1, 5, 5, 2, "常驻地"),
		day(2, 5, 5, 2, "常驻地"),
		day(3, 5, 5, 2, "常驻地"),
		day(4, 50, 50, 2, "旅行地"),
		day(5, 51, 50, 3, "旅行地"),
		day(6, 6, 5, 2, "常驻地附近"),
	}
	segments := mediaMemoryTripSegments(days)
	if len(segments) != 1 {
		t.Fatalf("segments=%+v", segments)
	}
	segment := segments[0]
	if len(segment.Days) != 2 ||
		segment.ItemCount != 5 ||
		segment.Days[0].DateKey != "2026-01-04" ||
		segment.Days[1].DateKey != "2026-01-05" {
		t.Fatalf("segment=%+v", segment)
	}
	if got := mediaMemoryTripPlace(segment); got != "旅行地" {
		t.Fatalf("trip place=%q", got)
	}
}

func TestMediaMemoryTripSegmentsRejectsSparseAwayDay(t *testing.T) {
	days := make([]mediaMemoryTripDay, 0, 5)
	for index := 0; index < 4; index++ {
		value := time.Date(2026, time.January, index+1, 0, 0, 0, 0, time.UTC)
		days = append(days, mediaMemoryTripDay{
			Date: value, DateKey: value.Format("2006-01-02"),
			LatitudeCell: 5, LongitudeCell: 5, ItemCount: 1,
		})
	}
	away := time.Date(2026, time.January, 5, 0, 0, 0, 0, time.UTC)
	days = append(days, mediaMemoryTripDay{
		Date: away, DateKey: away.Format("2006-01-02"),
		LatitudeCell: 50, LongitudeCell: 50, ItemCount: 20,
	})
	if segments := mediaMemoryTripSegments(days); len(segments) != 0 {
		t.Fatalf("single away day became a trip: %+v", segments)
	}
}

func TestMediaMemoryDateRangeLabel(t *testing.T) {
	start := time.Date(2026, time.October, 2, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, time.October, 5, 0, 0, 0, 0, time.UTC)
	if got := mediaMemoryDateRangeLabel(start, end); got != "10月2日–5日" {
		t.Fatalf("label=%q", got)
	}
	if got := mediaMemoryTripID(start, end); got !=
		fmt.Sprintf("trip:v1:%s:%s", "2026-10-02", "2026-10-05") {
		t.Fatalf("trip id=%q", got)
	}
}
