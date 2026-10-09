package api

import (
	"fmt"
	"regexp"
	"strings"
	"time"
	_ "time/tzdata"
)

var mediaIANAZoneCharacters = regexp.MustCompile(`^[A-Za-z0-9_+/-]+$`)

// mediaIANAZone validates before any timezone string is incorporated into a SQL
// expression. Only loaded IANA zone names (and UTC) are permitted.
func mediaIANAZone(raw string) (*time.Location, string, error) {
	zone := strings.TrimSpace(raw)
	if zone == "" {
		zone = "UTC"
	}
	if len(zone) > 80 || !mediaIANAZoneCharacters.MatchString(zone) ||
		(zone != "UTC" && !strings.Contains(zone, "/")) {
		return nil, "", fmt.Errorf("time_zone must be a valid IANA time zone")
	}
	location, err := time.LoadLocation(zone)
	if err != nil {
		return nil, "", fmt.Errorf("time_zone must be a valid IANA time zone")
	}
	return location, zone, nil
}

func mediaIANAZoneExpression(utcExpression, zone string) string {
	// zone has been validated by mediaIANAZone at the request boundary.
	if zone == "" {
		return utcExpression
	}
	return strings.ReplaceAll(utcExpression, "'UTC'", "'"+zone+"'")
}

func mediaMemoryLocalMidnight(date time.Time, location *time.Location) time.Time {
	if location == nil {
		location = time.UTC
	}
	// All dates in Memory IDs are calendar labels (YYYY-MM-DD), not instants.
	// Resolve both local midnight boundaries separately across DST transitions.
	year, month, day := date.UTC().Date()
	return time.Date(year, month, day, 0, 0, 0, 0, location).UTC()
}

func mediaMemoryZoneName(values []string) string {
	if len(values) == 0 {
		return "UTC"
	}
	_, zone, err := mediaIANAZone(values[0])
	if err != nil {
		return "UTC"
	}
	return zone
}
