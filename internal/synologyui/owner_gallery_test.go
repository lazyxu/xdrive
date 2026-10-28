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

type fakeOwnerGalleryReader struct {
    *fakeAgent
    pages, albums int
    unsafe bool
}
func (f *fakeOwnerGalleryReader) OwnerGalleryItemsRange(_ context.Context, kind string, limit, offset int, album string) (localbackupipc.OwnerGalleryPage, error) {
    f.pages++
    now := time.Now()
    page := localbackupipc.OwnerGalleryPage{
        Items: []client.OwnerGalleryItem{{
            Node: client.OwnerGalleryNode{
                ID: 42, ParentID: 17, Name: "Owner.jpg", Type: "file", Size: 11,
                Revision: 2, CreatedAt: now, UpdatedAt: now,
            },
            Metadata: client.OwnerGalleryMetadata{
                MediaKind: "image", MIMEType: "image/jpeg", IndexState: "ready", HasThumbnail: true,
            },
        }},
        TotalCount: 1, Offset: offset, Limit: limit,
    }
    if f.unsafe { page.Items[0].Node.ID = 0 }
    return page, nil
}
func (f *fakeOwnerGalleryReader) OwnerGalleryAlbums(context.Context) ([]localbackupipc.OwnerGalleryAlbum, error) {
    f.albums++
    if f.unsafe { return []localbackupipc.OwnerGalleryAlbum{{ID: "bad:abc"}}, nil }
    return []localbackupipc.OwnerGalleryAlbum{{ID: "manual:abc", Kind: "manual", Name: "Owner", ItemCount: 1}}, nil
}

func TestDSMOwnerGalleryCGIRequiresCurrentDSMPrincipalAndSafeExactGET(t *testing.T) {
    g, native := newFixture(t)
    fake := &fakeOwnerGalleryReader{fakeAgent: native}
    g.Connect = func(context.Context) (Agent, error) { return fake, nil }
    send := func(method, query string, withCookie bool) *httptest.ResponseRecorder {
        t.Helper()
        r := httptest.NewRequest(method, "https://nas.example:5001"+DSMCGIPath+query, nil)
        if withCookie { r.Header.Set("Cookie", "id=dsm-session") }
        w := httptest.NewRecorder()
        CGIHandler(g).ServeHTTP(w, r)
        return w
    }
    constQuery := "?op=cloud-gallery-items&kind=all&limit=100&offset=0"
    if w := send("GET", constQuery, true); w.Code != http.StatusOK ||
        !strings.Contains(w.Body.String(), `"name":"Owner.jpg"`) {
        t.Fatalf("authorized Owner Gallery page unavailable: %d %s", w.Code, w.Body.String())
    }
    if w := send("GET", "?op=cloud-gallery-albums", true); w.Code != http.StatusOK ||
        !strings.Contains(w.Body.String(), `"id":"manual:abc"`) {
        t.Fatalf("authorized Owner albums unavailable: %d %s", w.Code, w.Body.String())
    }
    if fake.pages != 1 || fake.albums != 1 || native.runs != 0 || native.controls != 0 {
        t.Fatal("Gallery GET triggered unplanned native backup operations")
    }
    for _, bad := range []string{
        "?op=cloud-gallery-items",
        "?op=cloud-gallery-items&kind=all&limit=101&offset=0",
        "?op=cloud-gallery-items&kind=audio&limit=100&offset=0",
        "?op=cloud-gallery-items&kind=all&limit=100&offset=0&root=/volume1",
        "?op=cloud-gallery-items&kind=all&limit=100&offset=0&album_id=../../private",
        "?op=cloud-gallery-items&kind=all&kind=image&limit=100&offset=0",
        "?op=cloud-gallery-items&kind=all&limit=100&offset=0&op=run",
        "?op=cloud-gallery-items&kind=all&limit=100&offset=0;op=run",
        "?op=cloud-gallery-albums&token=private",
    } {
        if w := send("GET", bad, true); w.Code == http.StatusOK {
            t.Fatalf("unapproved Owner Gallery selector accepted: %s", bad)
        }
    }
    if w := send("POST", constQuery, true); w.Code == http.StatusOK {
        t.Fatal("Owner Gallery accepted POST")
    }
    if w := send("GET", constQuery, false); w.Code == http.StatusOK {
        t.Fatal("Owner Gallery bypassed DSM session")
    }
    if fake.pages != 1 || fake.albums != 1 {
        t.Fatal("unapproved Owner Gallery selector reached Agent")
    }
    fake.unsafe = true
    if w := send("GET", constQuery, true); w.Code == http.StatusOK {
        t.Fatal("unsafe Owner media data was serialized")
    }
    if w := send("GET", "?op=cloud-gallery-albums", true); w.Code == http.StatusOK {
        t.Fatal("unsafe album inventory was serialized")
    }
    g.Authenticate = func(context.Context) (string, error) { return "other-user", nil }
    if w := send("GET", constQuery, true); w.Code != http.StatusForbidden {
        t.Fatal("foreign DSM principal accessed original Server Owner Gallery")
    }
}

func TestOldAgentDoesNotAdvertiseOwnerGallery(t *testing.T) {
    g, _ := newFixture(t)
    for _, q := range []string{
        "?op=cloud-gallery-items&kind=all&limit=100&offset=0",
        "?op=cloud-gallery-albums",
    } {
        r := httptest.NewRequest("GET", "https://nas.example:5001"+DSMCGIPath+q, nil)
        r.Header.Set("Cookie", "id=dsm-session")
        w := httptest.NewRecorder()
        CGIHandler(g).ServeHTTP(w, r)
        if w.Code != http.StatusNotImplemented {
            t.Fatalf("old Agent must fail unavailable: %s HTTP %d", q, w.Code)
        }
    }
}
