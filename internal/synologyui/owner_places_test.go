package synologyui

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

type fakeDSMOwnerPlaces struct {
	*fakeAgent
	readPlaces, readPhotos int
	unsafe                 bool
}

func (f *fakeDSMOwnerPlaces) OwnerPlacesPage(_ context.Context, limit, offset int) (localbackupipc.OwnerPlacesPage, error) {
	f.readPlaces++
	page, err := client.ProjectOwnerPlacesPage(client.MediaPlacesPage{
		Items: []client.MediaPlaceFacet{{
			ID: "place:3550:13970", Name: "真实地点",
			Latitude: 35.5, Longitude: 139.7,
			SampleLatitude: 35.505, SampleLongitude: 139.706,
			CoordinateKind: "grid_cell_center", ItemCount: 1,
		}},
		TotalCount: 1, Limit: limit, Offset: offset,
	}, limit, offset)
	if f.unsafe {
		page.Items[0].Latitude = 100
	}
	return page, err
}
func (f *fakeDSMOwnerPlaces) OwnerPlaceItems(_ context.Context, place string, limit, offset int) (localbackupipc.OwnerGalleryPage, error) {
	f.readPhotos++
	now := time.Now()
	return localbackupipc.OwnerGalleryPage{
		Items: []client.OwnerGalleryItem{{
			Node: client.OwnerGalleryNode{
				ID: 42, ParentID: 17, Name: "Owner.jpg", Type: "file", Size: 11,
				Revision: 2, CreatedAt: now, UpdatedAt: now,
			},
			Metadata: client.OwnerGalleryMetadata{
				MediaKind: "image", MIMEType: "image/jpeg", IndexState: "ready",
				HasThumbnail: true,
			},
		}},
		TotalCount: 1, Offset: offset, Limit: limit,
	}, nil
}
func TestDSMOwnerPlacesReadOnlyCGIAndExactPhotoScope(t *testing.T) {
	g, native := newFixture(t)
	fake := &fakeDSMOwnerPlaces{fakeAgent: native}
	g.Connect = func(context.Context) (Agent, error) { return fake, nil }
	send := func(method, query string, withCookie bool) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, "https://nas.example:5001"+DSMCGIPath+query, nil)
		if withCookie {
			r.Header.Set("Cookie", "id=dsm-session")
		}
		w := httptest.NewRecorder()
		CGIHandler(g).ServeHTTP(w, r)
		return w
	}
	const list = "?op=cloud-gallery-places&limit=48&offset=0"
	const photos = "?op=cloud-gallery-place-items&place_id=place%3A3550%3A13970&limit=100&offset=0"
	if w := send("GET", list, true); w.Code != http.StatusOK ||
		!strings.Contains(w.Body.String(), "\"sample_longitude\":139.706") {
		t.Fatalf("real authenticated Owner Places unavailable: %d %s", w.Code, w.Body.String())
	}
	if w := send("GET", photos, true); w.Code != http.StatusOK ||
		!strings.Contains(w.Body.String(), "\"name\":\"Owner.jpg\"") {
		t.Fatalf("signed Owner place media unavailable: %d %s", w.Code, w.Body.String())
	}
	if fake.readPlaces != 1 || fake.readPhotos != 1 || native.runs != 0 || native.controls != 0 {
		t.Fatal("Owner Places escaped fixed read-only Agent methods")
	}
	for _, invalid := range []string{
		"?op=cloud-gallery-places&limit=49&offset=0",
		"?op=cloud-gallery-places&limit=48&limit=1&offset=0",
		"?op=cloud-gallery-places&limit=48&offset=0&owner_id=999",
		"?op=cloud-gallery-place-items&limit=100&offset=0",
		"?op=cloud-gallery-place-items&place_id=place%3A00%3A1&limit=100&offset=0",
		"?op=cloud-gallery-place-items&place_id=place%3A3550%3A13970&limit=101&offset=0",
		"?op=cloud-gallery-place-items&place_id=place%3A3550%3A13970&limit=100&offset=0&root=%2Fvolume1",
	} {
		if w := send("GET", invalid, true); w.Code == http.StatusOK {
			t.Fatalf("invalid DSM Owner map selector admitted: %s", invalid)
		}
	}
	if w := send("POST", list, true); w.Code == http.StatusOK {
		t.Fatal("Owner Places POST accepted")
	}
	if w := send("GET", list, false); w.Code == http.StatusOK {
		t.Fatal("Owner Places bypassed DSM login")
	}
	if fake.readPlaces != 1 || fake.readPhotos != 1 {
		t.Fatal("invalid Owner Places selector reached Agent")
	}
	fake.unsafe = true
	if w := send("GET", list, true); w.Code == http.StatusOK {
		t.Fatal("unsafe Owner GPS could reach browser")
	}
	g.Authenticate = func(context.Context) (string, error) { return "wrong", nil }
	if w := send("GET", photos, true); w.Code != http.StatusForbidden {
		t.Fatal("foreign DSM principal accessed Owner place media")
	}
}
func TestDSMOldAgentWithoutOwnerPlacesFailsUnavailable(t *testing.T) {
	g, _ := newFixture(t)
	for _, query := range []string{
		"?op=cloud-gallery-places&limit=48&offset=0",
		"?op=cloud-gallery-place-items&place_id=place%3A3550%3A13970&limit=100&offset=0",
	} {
		r := httptest.NewRequest("GET", "https://nas.example:5001"+DSMCGIPath+query, nil)
		r.Header.Set("Cookie", "id=dsm-session")
		w := httptest.NewRecorder()
		CGIHandler(g).ServeHTTP(w, r)
		if w.Code != http.StatusNotImplemented {
			t.Fatalf("old Agent must report Places unavailable: %d", w.Code)
		}
	}
}
