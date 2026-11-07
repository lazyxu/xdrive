package api

import (
	"testing"
	"time"
)

func TestMediaExactTripIDUsesDatesCellsAndValidatedZone(t *testing.T) {
	day := func(n int, lat, lon int64) mediaMemoryTripDay {
		d := time.Date(2026, time.January, n, 0, 0, 0, 0, time.UTC)
		return mediaMemoryTripDay{
			Date: d, DateKey: d.Format("2006-01-02"),
			LatitudeCell: lat, LongitudeCell: lon,
		}
	}
	segment := mediaMemoryTripSegment{Days: []mediaMemoryTripDay{
		day(4, 50, 50), day(5, 50, 51),
	}}
	id := mediaExactTripID(segment, "UTC")
	if len(id) != 54 || id[:8] != "trip:v2:" {
		t.Fatalf("unexpected v2 trip id: %q", id)
	}
	if id != mediaExactTripID(segment, "UTC") {
		t.Fatal("identical days/locations changed stable id")
	}
	if id == mediaExactTripID(segment, "Asia/Singapore") {
		t.Fatal("different calendar zone shares trip authority")
	}
	changed := mediaMemoryTripSegment{Days: []mediaMemoryTripDay{
		day(4, 50, 50), day(5, 50, 52),
	}}
	if id == mediaExactTripID(changed, "UTC") {
		t.Fatal("geographic trip change reused stale id")
	}
	sameDate := mediaMemoryTripSegment{Days: []mediaMemoryTripDay{
		day(4, 50, 50), day(4, 50, 51),
	}}
	if got := mediaExactTripID(sameDate, "UTC"); got != "" {
		t.Fatalf("same date twice admitted: %q", got)
	}
	reversed := mediaMemoryTripSegment{Days: []mediaMemoryTripDay{
		day(5, 50, 51), day(4, 50, 50),
	}}
	if got := mediaExactTripID(reversed, "UTC"); got != "" {
		t.Fatalf("unordered dates admitted: %q", got)
	}
	tooLarge := mediaMemoryTripSegment{Days: make([]mediaMemoryTripDay, 367)}
	if got := mediaExactTripID(tooLarge, "UTC"); got != "" {
		t.Fatalf("unbounded days admitted: %q", got)
	}
}
