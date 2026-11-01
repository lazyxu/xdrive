package main

import (
	"context"
	"net/http"
	"net/url"
	"strconv"

	"github.com/lazyxu/xdrive/internal/client"
)

// Every parameter is fixed and bounded; there is no user-supplied Owner,
// Server URL, device Root, arbitrary map SDK query, or write capability.
func ownerPlacesPageSelector(raw string, placeRequired bool) (limit, offset int, place string, ok bool) {
	q, err := url.ParseQuery(raw)
	want := 2
	if placeRequired { want = 3 }
	if err != nil || len(q) != want { return }
	for key, values := range q {
		if len(values) != 1 { return }
		if key != "limit" && key != "offset" && (!placeRequired || key != "place_id") { return }
	}
	if len(q["limit"]) != 1 || len(q["offset"]) != 1 { return }
	limit, e1 := strconv.Atoi(q.Get("limit"))
	offset, e2 := strconv.Atoi(q.Get("offset"))
	max := client.OwnerPlacesPageLimit
	if placeRequired { max = client.OwnerGalleryPageLimit }
	if e1 != nil || e2 != nil || limit < 1 || limit > max ||
		offset < 0 || offset > client.OwnerGalleryMaxOffset ||
		strconv.Itoa(limit) != q.Get("limit") || strconv.Itoa(offset) != q.Get("offset") { return }
	if placeRequired {
		place = q.Get("place_id")
		if !client.ValidOwnerPlaceID(place) { return limit, offset, "", false }
	} else if len(q["place_id"]) > 0 { return limit, offset, "", false }
	return limit, offset, place, true
}
func (h *desktopIPCHandler) cloudOwnerPlacesPage(w http.ResponseWriter, r *http.Request) {
	limit, offset, _, ok := ownerPlacesPageSelector(r.URL.RawQuery, false)
	if !ok {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_owner_places", "bounded Owner Places page required")
		return
	}
	provider, ok := h.ctrl.(interface {
		CloudMediaPlacesPage(ctx context.Context, limit, offset int) (client.MediaPlacesPage, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "unsupported_owner_places", "update Agent")
		return
	}
	raw, err := provider.CloudMediaPlacesPage(r.Context(), limit, offset)
	if err != nil { writeDesktopIPCControllerError(w, err); return }
	page, err := client.ProjectOwnerPlacesPage(raw, limit, offset)
	if err != nil {
		writeDesktopIPCError(w, http.StatusServiceUnavailable, "invalid_owner_places", "Owner Places unavailable")
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, page)
}
func (h *desktopIPCHandler) cloudOwnerPlaceItems(w http.ResponseWriter, r *http.Request) {
	limit, offset, place, ok := ownerPlacesPageSelector(r.URL.RawQuery, true)
	if !ok {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_owner_place_items", "exact place and bounded range required")
		return
	}
	raw, err := h.ctrl.CloudMediaItemsRange(r.Context(),
		client.MediaQuery{Place: place, SortBy: "captured", SortDir: "desc"}, limit, offset)
	if err != nil { writeDesktopIPCControllerError(w, err); return }
	page, err := client.ProjectOwnerGalleryPage(raw, limit, offset)
	if err != nil {
		writeDesktopIPCError(w, http.StatusServiceUnavailable, "invalid_owner_place_items", "Owner place items unavailable")
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, page)
}
