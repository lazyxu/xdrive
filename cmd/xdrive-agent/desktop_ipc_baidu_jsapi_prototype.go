package main

import (
	"context"
	"net/http"

	"github.com/lazyxu/xdrive/internal/client"
)

// Only the authenticated local Desktop Agent may forward the current
// Browser-type (public) JSAPI AK to this app's renderer. Never use the
// private Server Static API AK or cache the result on disk.
func (h *desktopIPCHandler) mediaBaiduJSAPIPrototype(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	controller, ok := h.ctrl.(interface {
		CloudBaiduJSAPIPrototype(context.Context) (client.BaiduJSAPIPrototypeConfig, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented,
			"map_unavailable", "Baidu JSAPI prototype is unavailable")
		return
	}
	response, err := controller.CloudBaiduJSAPIPrototype(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, response)
}
