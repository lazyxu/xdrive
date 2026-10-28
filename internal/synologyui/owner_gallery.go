package synologyui

import (
    "context"
    "net/http"
    "net/url"
    "strconv"

    "github.com/lazyxu/xdrive/internal/client"
    "github.com/lazyxu/xdrive/internal/localbackupipc"
)

// Optional authenticated, read-only Owner Gallery capability. Never inherit
// arbitrary Desktop RPC, cloud-write, Owner/Root switching or Server tokens.
type OwnerGalleryReader interface {
    OwnerGalleryItemsRange(context.Context, string, int, int, string) (localbackupipc.OwnerGalleryPage, error)
    OwnerGalleryAlbums(context.Context) ([]localbackupipc.OwnerGalleryAlbum, error)
}

func ownerGalleryDSMSelector(rawQuery string) (kind string, limit, offset int, albumID string, ok bool) {
    q, err := url.ParseQuery(rawQuery)
    if err != nil || (len(q) != 3 && len(q) != 4) {
        return "", 0, 0, "", false
    }
    for key, values := range q {
        switch key {
        case "kind", "limit", "offset", "album_id":
            if len(values) != 1 { return "", 0, 0, "", false }
        default:
            return "", 0, 0, "", false
        }
    }
    if len(q["kind"]) != 1 || len(q["limit"]) != 1 || len(q["offset"]) != 1 {
        return "", 0, 0, "", false
    }
    kind = q.Get("kind")
    limit, errLimit := strconv.Atoi(q.Get("limit"))
    offset, errOffset := strconv.Atoi(q.Get("offset"))
    if !client.ValidOwnerGalleryKind(kind) ||
        errLimit != nil || errOffset != nil ||
        !client.ValidOwnerGalleryWindow(limit, offset) ||
        strconv.Itoa(limit) != q.Get("limit") ||
        strconv.Itoa(offset) != q.Get("offset") {
        return "", 0, 0, "", false
    }
    if len(q["album_id"]) > 0 {
        albumID = q.Get("album_id")
        if !client.ValidOwnerGalleryAlbumID(albumID) {
            return "", 0, 0, "", false
        }
    }
    return kind, limit, offset, albumID, true
}

func serveOwnerGallery(w http.ResponseWriter, r *http.Request, agent Agent) {
    reader, ok := agent.(OwnerGalleryReader)
    if !ok {
        http.Error(w, "authenticated Owner Gallery capability unavailable", http.StatusNotImplemented)
        return
    }
    if r.URL.Path == "/v1/cloud-gallery-albums" {
        if r.URL.RawQuery != "" {
            http.Error(w, "invalid Owner Gallery album selector", http.StatusBadRequest)
            return
        }
        albums, err := reader.OwnerGalleryAlbums(r.Context())
        if err != nil || !client.ValidOwnerGalleryAlbums(albums) {
            http.Error(w, "Server Owner Gallery albums unavailable", http.StatusServiceUnavailable)
            return
        }
        sendJSON(w, albums)
        return
    }
    kind, limit, offset, albumID, ok := ownerGalleryDSMSelector(r.URL.RawQuery)
    if !ok {
        http.Error(w, "invalid Owner Gallery page selector", http.StatusBadRequest)
        return
    }
    page, err := reader.OwnerGalleryItemsRange(r.Context(), kind, limit, offset, albumID)
    if err != nil || !client.ValidOwnerGalleryPage(page, limit, offset) {
        http.Error(w, "Server Owner Gallery page unavailable", http.StatusServiceUnavailable)
        return
    }
    sendJSON(w, page)
}
