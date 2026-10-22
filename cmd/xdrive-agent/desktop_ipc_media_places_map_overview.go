package main

import (
	"context"
	"net/http"
	"net/url"

	"github.com/lazyxu/xdrive/internal/client"
)

// Reject arbitrary map inputs before the authenticated Desktop Agent hop.
func (h *desktopIPCHandler) mediaPlacesMapOverview(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_map_overview", "invalid map overview")
		return
	}
	for key := range q {
		if key != "west" && key != "south" && key != "east" && key != "north" && key != "detail" {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_map_overview", "invalid map overview")
			return
		}
	}
	detail := false
	if values, ok := q["detail"]; ok {
		if len(values) != 1 || (values[0] != "0" && values[0] != "1") {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_map_overview", "invalid map overview")
			return
		}
		detail = values[0] == "1"
		q.Del("detail")
	}
	q.Set("limit", "64")
	q.Set("offset", "0")
	bounds, _, _, err := parseDesktopIPCMediaPlacesViewport(q.Encode())
	if err != nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_map_overview", "invalid map overview")
		return
	}
	provider, ok := h.ctrl.(interface {
		CloudMediaPlacesMapOverview(context.Context, client.MediaPlacesViewportBounds, bool) (client.MediaPlacesMapOverview, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "unsupported_map_overview", "update Agent for bounded map")
		return
	}
	page, err := provider.CloudMediaPlacesMapOverview(r.Context(), bounds, detail)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	if len(page.Items) > 64 || page.TotalPhotoCount < 0 {
		writeDesktopIPCError(w, http.StatusBadGateway, "invalid_map_overview", "invalid map overview")
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, page)
}
