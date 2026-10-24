package main

import (
	"context"
	"net/http"

	"github.com/lazyxu/xdrive/internal/client"
)

// Read-only, no-query, Loopback Bearer-authenticated Agent view of the
// Server's CURRENT signed JSAPI4 release; never accept an Origin from Renderer.
func (h *desktopIPCHandler) mediaBaiduJSAPI4Release(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.URL.RawQuery != "" || r.ContentLength > 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_jsapi4_release_query", "invalid map release request")
		return
	}
	provider, ok := h.ctrl.(interface {
		CloudMediaBaiduJSAPI4Release(context.Context) (client.MediaBaiduJSAPI4Release, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "unsupported_jsapi4_release", "update Agent for signed map release")
		return
	}
	status, err := provider.CloudMediaBaiduJSAPI4Release(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	if !status.ValidForTransport() {
		writeDesktopIPCError(w, http.StatusBadGateway, "invalid_jsapi4_release", "signed map release unavailable")
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, status)
}
