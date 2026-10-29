package main

import (
	"net/http/httptest"
	"testing"
)

func TestOwnerGalleryAgentSelectorsFailClosedBeforeController(t *testing.T) {
	for _, valid := range []struct {
		query, kind, album string
		limit, offset      int
	}{
		{"kind=all&limit=100&offset=0", "all", "", 100, 0},
		{"kind=image&limit=1&offset=45&album_id=manual:abc", "image", "manual:abc", 1, 45},
		{"kind=video&limit=100&offset=100", "video", "", 100, 100},
	} {
		r := httptest.NewRequest("GET", "/v1/cloud/owner-gallery-items?"+valid.query, nil)
		kind, limit, offset, album, ok := ownerGalleryAgentSelector(r)
		if !ok || kind != valid.kind || limit != valid.limit || offset != valid.offset || album != valid.album {
			t.Errorf("valid Owner gallery selector failed: %q", valid.query)
		}
	}
	for _, bad := range []string{
		"", "kind=all&offset=0", "kind=all&limit=100",
		"kind=all&limit=101&offset=0",
		"kind=all&limit=100&offset=-1",
		"kind=all&limit=010&offset=0",
		"kind=all&limit=100&offset=00",
		"kind=all&kind=video&limit=100&offset=0",
		"kind=all&limit=100&limit=1&offset=0",
		"kind=audio&limit=100&offset=0",
		"kind=all&limit=100&offset=0&path=/volume1",
		"kind=all&limit=100&offset=0&album_id=../private",
		"kind=all&limit=100&offset=0&album_id=",
		"kind=all&limit=100&offset=0;op=run",
		"kind=all&limit=100&offset=0&token=secret",
		"kind=all&limit=100&offset=10000001",
	} {
		r := httptest.NewRequest("GET", "/v1/cloud/owner-gallery-items?"+bad, nil)
		if _, _, _, _, ok := ownerGalleryAgentSelector(r); ok {
			t.Errorf("unsafe Owner gallery selector admitted: %q", bad)
		}
	}
}

func TestOwnerGalleryReadOnlyBackupOnlyCapability(t *testing.T) {
	caps := desktopIPCCapabilitiesForRuntime(true)
	found := false
	for _, capability := range caps {
		if capability == "cloud-owner-gallery-read" {
			found = true
		}
		if capability == "media-gallery" {
			t.Fatal("Backup-only must not gain the full Desktop media RPC")
		}
	}
	if !found {
		t.Fatal("Agent did not expose the narrowly scoped Owner gallery read capability")
	}
	for _, route := range []string{"/v1/cloud/owner-gallery-items", "/v1/cloud/owner-gallery-albums"} {
		if fullAgentOnlyRequest("GET", route) || !fullAgentOnlyRequest("POST", route) {
			t.Fatalf("Owner gallery must be GET only in backup-only mode: %s", route)
		}
	}
	if !fullAgentOnlyRequest("GET", "/v1/media/items") ||
		!fullAgentOnlyRequest("POST", "/v1/cloud/owner-gallery-items") {
		t.Fatal("full Desktop media and writes must remain unavailable")
	}
}
