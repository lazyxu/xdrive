package api

import (
	"strings"
	"testing"
	"time"
)

func TestMediaIANATimeZoneValidation(t *testing.T) {
	for _, value := range []string{"", "UTC", "Asia/Singapore", "America/New_York", "Europe/Berlin", "Pacific/Auckland"} {
		location, name, err := mediaIANAZone(value)
		if err != nil || location == nil || name == "" {
			t.Fatalf("valid zone %q rejected: %v", value, err)
		}
	}
	for _, value := range []string{"Local", "PST", "../../etc/passwd", "America/Impossible", "UTC' OR true--", strings.Repeat("a", 81)} {
		if _, _, err := mediaIANAZone(value); err == nil {
			t.Fatalf("invalid time zone %q accepted", value)
		}
	}
}

func TestMediaLocalDayBoundsCrossDST(t *testing.T) {
	type dayCase struct {
		zone  string
		day   string
		start string
		end   string
	}
	for _, testcase := range []dayCase{
		{"Asia/Singapore", "2026-10-09", "2026-10-08T16:00:00Z", "2026-10-09T16:00:00Z"},
		{"America/New_York", "2026-03-08", "2026-03-08T05:00:00Z", "2026-03-09T04:00:00Z"},
		{"America/New_York", "2026-11-01", "2026-11-01T04:00:00Z", "2026-11-02T05:00:00Z"},
		{"Pacific/Auckland", "2026-09-27", "2026-09-26T12:00:00Z", "2026-09-27T11:00:00Z"},
	} {
		t.Run(testcase.zone+"/"+testcase.day, func(t *testing.T) {
			location, _, err := mediaIANAZone(testcase.zone)
			if err != nil {
				t.Fatal(err)
			}
			day, err := time.Parse("2006-01-02", testcase.day)
			if err != nil {
				t.Fatal(err)
			}
			start := mediaMemoryLocalMidnight(day, location)
			end := mediaMemoryLocalMidnight(day.AddDate(0, 0, 1), location)
			if got := start.Format(time.RFC3339); got != testcase.start {
				t.Fatalf("start=%s want=%s", got, testcase.start)
			}
			if got := end.Format(time.RFC3339); got != testcase.end {
				t.Fatalf("end=%s want=%s", got, testcase.end)
			}
		})
	}
}

func TestMediaTimeZoneSQLExpressionUsesValidatedZone(t *testing.T) {
	expression := "TO_CHAR(xd_media_metadata.captured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')"
	got := mediaIANAZoneExpression(expression, "Asia/Singapore")
	want := "TO_CHAR(xd_media_metadata.captured_at AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD')"
	if got != want {
		t.Fatalf("expression=%q, want=%q", got, want)
	}
}

func TestMediaQueryRejectsUnknownTimeZone(t *testing.T) {
	_, _, err := mediaIANAZone("Asia/Atlantis")
	if err == nil {
		t.Fatal("unknown IANA zone must fail")
	}
}
