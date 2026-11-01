package synologyui

import (
	"context"
	"net/http"

	"github.com/lazyxu/xdrive/internal/client"
)

type OwnerMapOverviewReader interface {
	OwnerMapOverview(context.Context, client.MediaPlacesViewportBounds) (client.OwnerMapOverview, error)
}

// One same-DSM-principal, same-owning-Agent, read-only WGS84 viewport.
// No browser-provided Owner, arbitrary URL, third-party SDK ticket or media.
func serveOwnerMapOverview(w http.ResponseWriter, r *http.Request, agent Agent) {
	reader, ok := agent.(OwnerMapOverviewReader)
	if !ok {
		http.Error(w, "Owner map capability unavailable", http.StatusNotImplemented)
		return
	}
	bounds, err := client.ParseOwnerMapBoundsQuery(r.URL.RawQuery)
	if err != nil {
		http.Error(w, "invalid Owner map viewport", http.StatusBadRequest)
		return
	}
	page, err := reader.OwnerMapOverview(r.Context(), bounds)
	if err != nil || !client.ValidOwnerMapOverview(page, bounds) {
		http.Error(w, "current Owner GPS map unavailable", http.StatusServiceUnavailable)
		return
	}
	sendJSON(w, page)
}
