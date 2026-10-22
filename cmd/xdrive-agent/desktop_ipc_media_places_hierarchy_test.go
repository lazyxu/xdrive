package main

import "testing"

func TestParseDesktopIPCMediaPlacesHierarchy(t *testing.T) {
	valid := []string{
		"level=country&limit=48", "level=country&cursor=country%3AJP",
		"level=region&country=JP&cursor=region%3AJP%3A13",
		"level=city&country=JP&region=13&cursor=city%3AJP%3A13%3A1850147&favorite=true",
		"level=city&country=US&region=MA&search=Springfield&camera=sony&camera=canon",
	}
	for _, raw := range valid {
		if _, err := parseDesktopIPCMediaPlacesHierarchy(raw); err != nil {
			t.Fatalf("valid query %q: %v", raw, err)
		}
	}
	invalid := []string{
		"", "level=unknown", "level=country&country=JP",
		"level=region", "level=region&country=jp",
		"level=city&country=JP", "level=city&country=JP&region=13!",
		"level=country&limit=101", "level=country&limit=-1",
		"level=country&cursor=region%3AJP%3A13",
		"level=city&country=JP&region=13&cursor=city%3AUS%3AMA%3A123",
		"level=country&level=city", "level=country&owner_id=1",
		"level=country&server_url=https%3A%2F%2Fevil.invalid", "level=country&search=%00",
	}
	for _, raw := range invalid {
		if v, err := parseDesktopIPCMediaPlacesHierarchy(raw); err == nil {
			t.Fatalf("invalid query %q: %+v", raw, v)
		}
	}
}
