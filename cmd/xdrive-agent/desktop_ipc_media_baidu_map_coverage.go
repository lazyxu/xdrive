package main

import (
	"context"
	"net/http"

	"github.com/lazyxu/xdrive/internal/client"
)

// A no-argument Owner read through the authenticated Agent bridge.
func (h *desktopIPCHandler) mediaBaiduMapCoverage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.URL.RawQuery != "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_map_coverage", "invalid map coverage query")
		return
	}
	provider, ok := h.ctrl.(interface {
		CloudMediaBaiduMapCoverage(context.Context) (client.MediaBaiduMapCoverage, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "unsupported_map_coverage", "update Agent for map coverage")
		return
	}
	counts, err := provider.CloudMediaBaiduMapCoverage(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	if !counts.ValidForTransport() {
		writeDesktopIPCError(w, http.StatusBadGateway, "invalid_map_coverage", "map coverage unavailable")
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, counts)
}
