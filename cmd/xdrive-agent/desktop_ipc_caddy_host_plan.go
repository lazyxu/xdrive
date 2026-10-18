package main

import (
	"context"
	"net/http"

	"github.com/lazyxu/xdrive/internal/client"
)

// Optional authenticated Agent support, still relying on the Server's
// requireAdmin() route for authoritative access control.
type desktopIPCAdminCaddyHostPlanController interface {
	CloudAdminCaddyHTTPSHostPlan(context.Context) (client.AdminCaddyHostPlan, error)
}

func (h *desktopIPCHandler) cloudAdminCaddyHTTPSHostPlan(w http.ResponseWriter, r *http.Request) {
	provider, ok := h.ctrl.(desktopIPCAdminCaddyHostPlanController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "admin_caddy_host_plan_unsupported", "HTTPS host plan is unavailable")
		return
	}
	result, err := provider.CloudAdminCaddyHTTPSHostPlan(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	writeDesktopIPCJSON(w, http.StatusOK, result)
}
