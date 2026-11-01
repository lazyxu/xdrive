package main

import "testing"

func TestOwnerPlacesAgentSelectorsAndBackupOnlyReadScope(t *testing.T) {
	for _, tc := range []struct {
		query string
		items bool
		place string
	}{
		{"limit=48&offset=0", false, ""},
		{"limit=1&offset=10000000", false, ""},
		{"limit=100&offset=0&place_id=place%3A3550%3A13970", true, "place:3550:13970"},
	} {
		limit, _, id, ok := ownerPlacesPageSelector(tc.query, tc.items)
		if !ok || id != tc.place || limit < 1 {
			t.Errorf("valid Owner Places selector denied: %s", tc.query)
		}
	}
	for _, query := range []string{
		"", "limit=48", "limit=49&offset=0", "limit=0&offset=0",
		"limit=01&offset=0", "limit=48&offset=00",
		"limit=48&limit=1&offset=0", "limit=48&offset=-1",
		"limit=48&offset=0&owner_id=2", "limit=48&offset=0;op=run",
		"limit=48&offset=0&place_id=place:1:2",
	} {
		if _, _, _, ok := ownerPlacesPageSelector(query, false); ok {
			t.Errorf("unsafe Places selector admitted: %q", query)
		}
	}
	for _, query := range []string{
		"limit=48&offset=0", "limit=101&offset=0&place_id=place:1:2",
		"limit=48&offset=0&place_id=place:00:1",
		"limit=48&offset=0&place_id=place:9001:2",
		"limit=48&offset=0&place_id=place:1:2&path=/volume1",
	} {
		if _, _, _, ok := ownerPlacesPageSelector(query, true); ok {
			t.Errorf("unsafe place photo range admitted: %q", query)
		}
	}
	capability := false
	for _, name := range desktopIPCCapabilitiesForRuntime(true) {
		if name == "cloud-owner-places-read" {
			capability = true
		}
		if name == "media-gallery" {
			t.Fatal("backup-only gained Desktop media API")
		}
	}
	if !capability {
		t.Fatal("backup-only lost read-only Owner Places capability")
	}
	for _, path := range []string{"/v1/cloud/owner-places-page", "/v1/cloud/owner-place-items"} {
		if fullAgentOnlyRequest("GET", path) || !fullAgentOnlyRequest("POST", path) {
			t.Errorf("incorrect Backup-only route admission: %s", path)
		}
	}
}
