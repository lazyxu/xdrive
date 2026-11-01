package client

import (
	"encoding/json"
	"strings"
	"testing"
)

func ownerPlacesFixture() MediaPlacesPage {
	cover := uint64(901)
	return MediaPlacesPage{
		Items: []MediaPlaceFacet{{
			ID: "place:3550:13970", Name: "真实地点", Latitude: 35.5,
			Longitude: 139.7, SampleLatitude: 35.505,
			SampleLongitude: 139.706, CoordinateKind: "grid_cell_center",
			ItemCount: 3, CoverNodeID: &cover, Attribution: "PRIVATE_PROVIDER",
			AttributionURL: "https://untrusted.test/private?token=secret",
		}},
		TotalCount: 1, Offset: 0, Limit: 48, HasMore: false,
	}
}
func TestOwnerPlacesProjectionKeepsActualGPSButNeverProviderURLs(t *testing.T) {
	page, err := ProjectOwnerPlacesPage(ownerPlacesFixture(), 48, 0)
	if err != nil || !ValidOwnerPlacesPage(page, 48, 0) {
		t.Fatalf("valid Owner GPS projection denied: %+v %v", page, err)
	}
	bytes, err := json.Marshal(page)
	if err != nil {
		t.Fatal(err)
	}
	body := string(bytes)
	for _, forbidden := range []string{"PRIVATE_PROVIDER", "untrusted.test", "token", "owner_id", "metadata"} {
		if strings.Contains(body, forbidden) {
			t.Errorf("Owner Places leaked %s", forbidden)
		}
	}
	if !strings.Contains(body, "\"sample_longitude\":139.706") ||
		!strings.Contains(body, "\"item_count\":3") {
		t.Fatal("verified GPS and count were lost", body)
	}
}
func TestOwnerPlacesRejectsMalformedAndWideRanges(t *testing.T) {
	for _, id := range []string{
		"", "place:00:1", "place:-0:1", "place:1:+2", "place:9001:0",
		"place:0:18001", "place:1:2?q=all", "place:1:2:3", "map-region:1:2",
	} {
		if ValidOwnerPlaceID(id) {
			t.Errorf("unsafe place admitted: %s", id)
		}
	}
	for _, limit := range []int{0, 49, 100} {
		if ValidOwnerPlacesWindow(limit, 0) {
			t.Errorf("unbounded limit: %d", limit)
		}
	}
	for _, mutate := range []func(*MediaPlacesPage){
		func(p *MediaPlacesPage) { p.TotalCount = -1 },
		func(p *MediaPlacesPage) { p.Items[0].ID = "place:0:0?q=secret" },
		func(p *MediaPlacesPage) { p.Items[0].Latitude = 91 },
		func(p *MediaPlacesPage) { p.Items[0].SampleLongitude = 181 },
		func(p *MediaPlacesPage) { p.Items[0].ItemCount = -1 },
		func(p *MediaPlacesPage) { p.Items[0].CoverNodeID = new(uint64) },
		func(p *MediaPlacesPage) { p.Items[0].Name = "x\nBearer secret" },
		func(p *MediaPlacesPage) { p.Items = append(p.Items, p.Items[0]); p.TotalCount = 2 },
		func(p *MediaPlacesPage) { p.HasMore = true },
		func(p *MediaPlacesPage) { p.Limit = 100 },
		func(p *MediaPlacesPage) { p.Offset = 1 },
	} {
		input := ownerPlacesFixture()
		mutate(&input)
		if out, err := ProjectOwnerPlacesPage(input, 48, 0); err == nil {
			t.Errorf("unsafe Owner Places response admitted: %+v", out)
		}
	}
	if _, err := ProjectOwnerPlacesPage(MediaPlacesPage{
		Items: []MediaPlaceFacet{}, TotalCount: 3, Offset: 0, Limit: 48, HasMore: true,
	}, 48, 0); err == nil {
		t.Fatal("nonadvancing Owner Places page was accepted")
	}
	empty := MediaPlacesPage{Items: []MediaPlaceFacet{}, TotalCount: 3, Offset: 48, Limit: 48}
	if _, err := ProjectOwnerPlacesPage(empty, 48, 48); err != nil {
		t.Fatal("genuine beyond-EOF empty page was rejected", err)
	}
}
