package main

import (
	"net/url"
	"strings"
	"testing"
)

func TestParseDesktopIPCMediaPlacesHierarchy(t *testing.T) {
	for _, tt := range []struct {
		name string
		query string
		valid bool
	}{
		{"country default", "", true},
		{"country page", "level=country&limit=48&cursor=country%3AJP", true},
		{"region", "level=region&country=JP&cursor=region%3AJP%3A13", true},
		{"city", "level=city&country=JP&region=13&cursor=city%3AJP%3A13%3A1850147", true},
		{"literal search", "level=city&country=JP&region=13&search="+url.QueryEscape("东京"), true},
		{"duplicate", "level=country&level=city", false},
		{"unknown", "level=country&owner_id=2", false},
		{"invalid country", "level=region&country=jp", false},
		{"wrong parent", "level=country&country=JP", false},
		{"cross country", "level=region&country=JP&cursor=region%3AUS%3ACA", false},
		{"cross region", "level=city&country=JP&region=13&cursor=city%3AJP%3A27%3A123", false},
		{"city noncanonical", "level=city&country=JP&region=13&cursor=city%3AJP%3A13%3A01", false},
		{"city overflow", "level=city&country=JP&region=13&cursor=city%3AJP%3A13%3A99999999999999999999", false},
		{"limit zero", "limit=0", false},
		{"limit beyond bound", "limit=101", false},
		{"search length", "search="+url.QueryEscape(strings.Repeat("京",81)), false},
		{"NUL", "search=%00", false},
		{"malformed percent", "search=%XX", false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseDesktopIPCMediaPlacesHierarchy(tt.query)
			if (err == nil) != tt.valid {
				t.Fatalf("valid=%t unexpected error=%v query=%s", tt.valid, err, tt.query)
			}
			if err == nil && (got.Limit < 1 || got.Limit > 100) {
				t.Fatalf("bounded limit required: %#v", got)
			}
		})
	}
}
