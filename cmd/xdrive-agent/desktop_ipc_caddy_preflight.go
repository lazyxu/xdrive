package main

import (
	"context"
	"net/http"

	"github.com/lazyxu/xdrive/internal/client"
)

// Optional Agent capability, with authoritative requireAdmin on the Server.
type desktopIPCAdminCaddyPreflightController interface {
	CloudAdminCaddyHTTPSPreflight(context.Context) (client.AdminCaddyPreflight, error)
}

func (h *desktopIPCHandler) cloudAdminCaddyHTTPSPreflight(w http.ResponseWriter, r *http.Request) {
	provider, ok := h.ctrl.(desktopIPCAdminCaddyPreflightController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "admin_caddy_preflight_unsupported", "HTTPS preflight is unsupported")
		return
	}
	result, err := provider.CloudAdminCaddyHTTPSPreflight(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	writeDesktopIPCJSON(w, http.StatusOK, result)
}
