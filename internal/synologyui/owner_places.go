package synologyui

import (
	"context"
	"net/http"
	"net/url"
	"strconv"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

// Same owning Agent + current DSM principal, not a browser-supplied
// xDrive Server URL or the full Desktop media RPC.
type OwnerPlacesReader interface {
	OwnerPlacesPage(context.Context, int, int) (localbackupipc.OwnerPlacesPage, error)
	OwnerPlaceItems(context.Context, string, int, int) (localbackupipc.OwnerGalleryPage, error)
}

func ownerPlacesDSMSelector(raw string, items bool) (limit, offset int, place string, ok bool) {
	q, err := url.ParseQuery(raw)
	expected := 2
	if items { expected = 3 }
	if err != nil || len(q) != expected { return }
	for key, values := range q {
		if len(values) != 1 || (key != "limit" && key != "offset" && (!items || key != "place_id")) { return }
	}
	if len(q["limit"]) != 1 || len(q["offset"]) != 1 { return }
	limit, e1 := strconv.Atoi(q.Get("limit"))
	offset, e2 := strconv.Atoi(q.Get("offset"))
	max := client.OwnerPlacesPageLimit
	if items { max = client.OwnerGalleryPageLimit }
	if e1 != nil || e2 != nil || limit < 1 || limit > max ||
		offset < 0 || offset > client.OwnerGalleryMaxOffset ||
		strconv.Itoa(limit) != q.Get("limit") || strconv.Itoa(offset) != q.Get("offset") { return }
	if items {
		place = q.Get("place_id")
		if !client.ValidOwnerPlaceID(place) { return limit, offset, "", false }
	}
	return limit, offset, place, true
}

func serveOwnerPlaces(w http.ResponseWriter, r *http.Request, agent Agent) {
	reader, ok := agent.(OwnerPlacesReader)
	if !ok {
		http.Error(w, "authenticated Owner Places capability unavailable", http.StatusNotImplemented)
		return
	}
	isItems := r.URL.Path == "/v1/cloud-gallery-place-items"
	limit, offset, place, ok := ownerPlacesDSMSelector(r.URL.RawQuery, isItems)
	if !ok {
		http.Error(w, "invalid Owner Places selector", http.StatusBadRequest)
		return
	}
	if isItems {
		page, err := reader.OwnerPlaceItems(r.Context(), place, limit, offset)
		if err != nil || !client.ValidOwnerGalleryPage(page, limit, offset) {
			http.Error(w, "Owner place photos unavailable", http.StatusServiceUnavailable)
			return
		}
		sendJSON(w, page)
		return
	}
	page, err := reader.OwnerPlacesPage(r.Context(), limit, offset)
	if err != nil || !client.ValidOwnerPlacesPage(page, limit, offset) {
		http.Error(w, "Owner Places unavailable", http.StatusServiceUnavailable)
		return
	}
	sendJSON(w, page)
}
