package main

import (
	"context"
	"net/http"

	"github.com/lazyxu/xdrive/internal/client"
)

// Only the authenticated loopback Desktop Main obtains the PUBLIC CA material
// already trusted by its current native Agent. No Renderer or map guest IPC.
func (h *desktopIPCHandler) desktopMapLANTrust(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	if h.backupOnly || r.URL.RawQuery != "" || r.ContentLength != 0 ||
		len(r.Header.Values("Cookie")) != 0 ||
		r.Header.Get("Origin") != "" || r.Header.Get("Sec-Fetch-Site") != "" {
		writeDesktopIPCError(w, http.StatusForbidden, "desktop_map_lan_trust_denied", "native Desktop LAN trust denied")
		return
	}
	provider, ok := h.ctrl.(interface {
		CloudDesktopMapLANTrust(context.Context) (desktopMapLANTrustReceipt, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "desktop_map_lan_trust_unavailable", "update xDrive Agent")
		return
	}
	receipt, err := provider.CloudDesktopMapLANTrust(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	if !receipt.Available {
		writeDesktopIPCJSON(w, http.StatusOK, desktopMapLANTrustReceipt{Available: false})
		return
	}
	if receipt.Username == "" || len(receipt.Username) > 128 ||
		client.ValidPrivateLANRoot(receipt.Server, receipt.RootPEM) != nil {
		writeDesktopIPCError(w, http.StatusBadGateway, "invalid_desktop_map_lan_trust", "invalid native private LAN CA")
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, receipt)
}
