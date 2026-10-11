package main

import (
	"context"
	"net/http"

	"github.com/lazyxu/xdrive/internal/client"
)

// Feature-gated for old Desktop Agents. Server-side requireAdmin is authoritative.
// The IPC handlers forward fixed fields only and never invoke any host operation.
type desktopIPCAdminCaddyAliDNSController interface {
	CloudAdminCaddyAliDNSConfig(context.Context) (client.AdminCaddyAliDNSConfig, error)
	CloudSetAdminCaddyAliDNS(context.Context, client.AdminCaddyAliDNSUpdate) (client.AdminCaddyAliDNSConfig, error)
	CloudRevealAdminCaddyAliDNS(context.Context, uint64) (client.AdminCaddyAliDNSReveal, error)
}

func (h *desktopIPCHandler) cloudAdminCaddyAliDNS(w http.ResponseWriter, r *http.Request) {
	provider, ok := h.ctrl.(desktopIPCAdminCaddyAliDNSController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "admin_caddy_alidns_unsupported", "Caddy AliDNS staged credentials are unsupported")
		return
	}
	result, err := provider.CloudAdminCaddyAliDNSConfig(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeDesktopIPCJSON(w, http.StatusOK, result)
}
func (h *desktopIPCHandler) cloudSetAdminCaddyAliDNS(w http.ResponseWriter, r *http.Request) {
	provider, ok := h.ctrl.(desktopIPCAdminCaddyAliDNSController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "admin_caddy_alidns_unsupported", "Caddy AliDNS staged credentials are unsupported")
		return
	}
	var input struct {
		Revision        *uint64 `json:"revision"`
		AccessKeyID     string  `json:"access_key_id"`
		AccessKeySecret string  `json:"access_key_secret"`
		Clear           bool    `json:"clear"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.Revision == nil || *input.Revision > 1<<60 ||
		(input.Clear && (input.AccessKeyID != "" || input.AccessKeySecret != "")) ||
		(!input.Clear && !validDesktopCaddyAliDNSPair(input.AccessKeyID, input.AccessKeySecret)) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_caddy_alidns_input", "AliDNS requires current revision and both bounded credentials or explicit clear")
		return
	}
	result, err := provider.CloudSetAdminCaddyAliDNS(r.Context(), client.AdminCaddyAliDNSUpdate{
		Revision: *input.Revision, AccessKeyID: input.AccessKeyID, AccessKeySecret: input.AccessKeySecret, Clear: input.Clear,
	})
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeDesktopIPCJSON(w, http.StatusOK, result)
}
func (h *desktopIPCHandler) cloudRevealAdminCaddyAliDNS(w http.ResponseWriter, r *http.Request) {
	provider, ok := h.ctrl.(desktopIPCAdminCaddyAliDNSController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "admin_caddy_alidns_unsupported", "Caddy AliDNS staged credentials are unsupported")
		return
	}
	var input struct {
		Revision *uint64 `json:"revision"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.Revision == nil || *input.Revision > 1<<60 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_caddy_alidns_revision", "AliDNS revision is required")
		return
	}
	result, err := provider.CloudRevealAdminCaddyAliDNS(r.Context(), *input.Revision)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Referrer-Policy", "no-referrer")
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func validDesktopCaddyAliDNSPair(id, secret string) bool {
	for _, field := range []struct {
		value    string
		min, max int
	}{{id, 8, 128}, {secret, 8, 256}} {
		if len(field.value) < field.min || len(field.value) > field.max {
			return false
		}
		for i := 0; i < len(field.value); i++ {
			if field.value[i] < '!' || field.value[i] > '~' {
				return false
			}
		}
	}
	return true
}
