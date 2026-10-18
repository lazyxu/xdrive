package main

import (
	"context"
	"fmt"
	"net/http"
	"net/url"

	"github.com/lazyxu/xdrive/internal/client"
)

// Reuse exact geometry limits without mistaking BD09 for WGS84. The mandatory
// local coordinate_space field is checked and stripped before the shared
// four-number validation. It is deliberately absent from Server's query.
func parseDesktopIPCBaiduNativeViewport(raw string) (client.BaiduNativeViewportBounds, int, int, error) {
	var none client.BaiduNativeViewportBounds
	q, err := url.ParseQuery(raw)
	if err != nil || len(q["coordinate_space"]) != 1 ||
		q.Get("coordinate_space") != "bd09ll" {
		return none, 0, 0, fmt.Errorf("invalid coordinate space")
	}
	q.Del("coordinate_space")
	original, limit, offset, err := parseDesktopIPCMediaPlacesViewport(q.Encode())
	if err != nil {
		return none, 0, 0, fmt.Errorf("invalid native viewport")
	}
	return client.BaiduNativeViewportBounds{
		CoordinateSpace: "bd09ll",
		West:            original.West, South: original.South,
		East: original.East, North: original.North,
	}, limit, offset, nil
}

func (h *desktopIPCHandler) mediaBaiduNativeViewport(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	bounds, limit, offset, err := parseDesktopIPCBaiduNativeViewport(r.URL.RawQuery)
	if err != nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_baidu_native_viewport", "invalid BD09 viewport")
		return
	}
	p, ok := h.ctrl.(interface {
		CloudBaiduNativeViewport(context.Context, client.BaiduNativeViewportBounds, int, int) (client.BaiduNativeViewportPage, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "unsupported_baidu_native_viewport", "update Agent for JSAPI4")
		return
	}
	page, err := p.CloudBaiduNativeViewport(r.Context(), bounds, limit, offset)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, page)
}
