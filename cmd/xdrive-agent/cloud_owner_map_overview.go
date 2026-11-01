package main

import (
    "context"
    "net/http"

    "github.com/lazyxu/xdrive/internal/client"
)

// A fixed, authenticated Owner read. The response is a bounded WGS84
// distribution, never an arbitrary Server endpoint or an SDK release.
func (h *desktopIPCHandler) cloudOwnerMapOverview(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Cache-Control", "private, no-store")
    w.Header().Set("Referrer-Policy", "no-referrer")
    bounds, err := client.ParseOwnerMapBoundsQuery(r.URL.RawQuery)
    if err != nil {
        writeDesktopIPCError(w, http.StatusBadRequest, "invalid_owner_map", "bounded Owner map viewport required")
        return
    }
    provider, ok := h.ctrl.(interface {
        CloudMediaPlacesMapOverview(context.Context, client.MediaPlacesViewportBounds, bool) (client.MediaPlacesMapOverview, error)
    })
    if !ok {
        writeDesktopIPCError(w, http.StatusNotImplemented, "unsupported_owner_map", "update Agent for Owner map overview")
        return
    }
    raw, err := provider.CloudMediaPlacesMapOverview(r.Context(), bounds, true)
    if err != nil {
        writeDesktopIPCControllerError(w, err)
        return
    }
    page, err := client.ProjectOwnerMapOverview(raw, bounds)
    if err != nil {
        writeDesktopIPCError(w, http.StatusServiceUnavailable, "invalid_owner_map", "current Owner GPS overview unavailable")
        return
    }
    writeDesktopIPCJSON(w, http.StatusOK, page)
}
