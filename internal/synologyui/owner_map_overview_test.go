package synologyui

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func (f *fakeDSMOwnerPlaces) OwnerMapOverview(_ context.Context,
	bounds client.MediaPlacesViewportBounds) (client.OwnerMapOverview, error) {
	f.readPlaces++
	raw := client.MediaPlacesMapOverview{
		Items: []client.MediaPlaceFacet{{
			ID:   "map-region:q:-180:-90:180:90:1:1",
			Name: "Map cluster", SampleLatitude: 35.505, SampleLongitude: 139.706,
			CoordinateKind: "map_region_sample", ItemCount: 3,
		}}, TotalPhotoCount: 3, Aggregated: true,
	}
	if f.unsafe {
		raw.TotalPhotoCount = 7
	}
	return client.ProjectOwnerMapOverview(raw, bounds)
}
func TestDSMOwnerMapRealBoundedGPSCGI(t *testing.T) {
	g, base := newFixture(t)
	fake := &fakeDSMOwnerPlaces{fakeAgent: base}
	g.Connect = func(context.Context) (Agent, error) { return fake, nil }
	send := func(method, query string, cookie bool) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, "https://nas.example:5001"+DSMCGIPath+query, nil)
		if cookie {
			req.Header.Set("Cookie", "id=dsm-session")
		}
		res := httptest.NewRecorder()
		CGIHandler(g).ServeHTTP(res, req)
		return res
	}
	const good = "?op=cloud-gallery-map-overview&west=-180&south=-90&east=180&north=90"
	ok := send("GET", good, true)
	if ok.Code != 200 || !strings.Contains(ok.Body.String(), `"id":"map-region:1"`) ||
		!strings.Contains(ok.Body.String(), `"sample_longitude":139.706`) ||
		!strings.Contains(ok.Body.String(), `"total_photo_count":3`) ||
		strings.Contains(ok.Body.String(), "map-region:q:") {
		t.Fatalf("bounded verified WGS84 map lost: %d %s", ok.Code, ok.Body.String())
	}
	for _, query := range []string{
		"?op=cloud-gallery-map-overview&west=-180&south=-90&east=180",
		good + "&owner_id=55",
		good + "&west=180",
		"?op=cloud-gallery-map-overview&west=-180&south=-90&east=180&north=NaN",
		"?op=cloud-gallery-map-overview&west=180&south=-90&east=180&north=90",
	} {
		if w := send("GET", query, true); w.Code == 200 {
			t.Fatalf("bad Owner viewport admitted: %s", query)
		}
	}
	if fake.readPlaces != 1 || base.runs != 0 || base.controls != 0 {
		t.Fatal("invalid map read reached owning Agent or backup writer")
	}
	if w := send("POST", good, true); w.Code == 200 {
		t.Fatal("map POST accepted")
	}
	if w := send("GET", good, false); w.Code == 200 {
		t.Fatal("map without DSM session accepted")
	}
	fake.unsafe = true
	if w := send("GET", good, true); w.Code == 200 {
		t.Fatal("invalid Owner count published")
	}
	g.Authenticate = func(context.Context) (string, error) { return "wrong", nil }
	if w := send("GET", good, true); w.Code != http.StatusForbidden {
		t.Fatal("foreign DSM principal accessed map")
	}
}
func TestDSMOldAgentCannotFakeMapAvailability(t *testing.T) {
	g, _ := newFixture(t)
	req := httptest.NewRequest("GET",
		"https://nas.example:5001"+DSMCGIPath+"?op=cloud-gallery-map-overview&west=-180&south=-90&east=180&north=90", nil)
	req.Header.Set("Cookie", "id=dsm-session")
	res := httptest.NewRecorder()
	CGIHandler(g).ServeHTTP(res, req)
	if res.Code != http.StatusNotImplemented {
		t.Fatalf("old Agent must be unavailable: %d", res.Code)
	}
}
