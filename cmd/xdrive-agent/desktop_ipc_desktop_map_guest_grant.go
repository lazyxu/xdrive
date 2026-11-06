package main

import (
	"context"
	"net/http"
	"strings"

	"github.com/lazyxu/xdrive/internal/client"
)

// The response is an opaque one-use ticket, NOT the native refresh secret.
// Only Loopback+discovery Bearer may call this handler; browser WebView never
// has the discovery file, and Main never forwards this route to a renderer.
func (h *desktopIPCHandler) issueDesktopMapGuestGrant(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	if h.backupOnly || r.URL.RawQuery != "" ||
		r.ContentLength > 0 || len(r.Header.Values("Cookie")) != 0 {
		writeDesktopIPCError(w, http.StatusForbidden, "desktop_map_grant_denied", "native Desktop map grant denied")
		return
	}
	provider, ok := h.ctrl.(interface {
		CloudIssueDesktopMapGuestGrant(context.Context) (client.DesktopMapGuestGrant, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "desktop_map_grant_unavailable", "update xDrive Agent")
		return
	}
	grant, err := provider.CloudIssueDesktopMapGuestGrant(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	if len(grant.Ticket) != 64 ||
		strings.Trim(grant.Ticket, "0123456789abcdef") != "" ||
		grant.Username == "" || len(grant.Username) > 128 ||
		grant.ExpiresIn <= 0 || grant.ExpiresIn > 30 {
		writeDesktopIPCError(w, http.StatusBadGateway, "invalid_desktop_map_grant", "invalid Server map grant")
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, grant)
}
