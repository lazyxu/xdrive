package main

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/lazyxu/xdrive/internal/client"
)

// Desktop Agent requires the same bounded WGS84 input semantics as Server.
// All parse errors are generic: never echo original coordinates or URL.
func parseDesktopIPCMediaPlacesViewport(rawQuery string) (client.MediaPlacesViewportBounds, int, int, error) {
	var bounds client.MediaPlacesViewportBounds
	values, err := url.ParseQuery(rawQuery)
	if err != nil {
		return bounds, 0, 0, fmt.Errorf("invalid viewport query")
	}
	for key, data := range values {
		switch key {
		case "west", "south", "east", "north", "limit", "offset":
		default:
			return bounds, 0, 0, fmt.Errorf("unrecognized viewport query")
		}
		if len(data) != 1 || data[0] == "" || strings.TrimSpace(data[0]) != data[0] {
			return bounds, 0, 0, fmt.Errorf("ambiguous viewport query")
		}
	}
	number := func(name string, minimum, maximum float64) (float64, error) {
		v := values[name]
		if len(v) != 1 {
			return 0, fmt.Errorf("missing viewport coordinate")
		}
		n, err := strconv.ParseFloat(v[0], 64)
		if err != nil || math.IsNaN(n) || math.IsInf(n, 0) || n < minimum || n > maximum {
			return 0, fmt.Errorf("invalid viewport coordinate")
		}
		return n, nil
	}
	if bounds.West, err = number("west", -180, 180); err != nil {
		return bounds, 0, 0, err
	}
	if bounds.East, err = number("east", -180, 180); err != nil {
		return bounds, 0, 0, err
	}
	if bounds.South, err = number("south", -90, 90); err != nil {
		return bounds, 0, 0, err
	}
	if bounds.North, err = number("north", -90, 90); err != nil {
		return bounds, 0, 0, err
	}
	if bounds.South >= bounds.North || bounds.West == bounds.East ||
		(bounds.West == 180 && bounds.East == -180) {
		return bounds, 0, 0, fmt.Errorf("degenerate viewport")
	}
	limit, offset := 64, 0
	if raw := values["limit"]; len(raw) == 1 {
		limit, err = strconv.Atoi(raw[0])
		if err != nil || limit < 1 || limit > 100 {
			return bounds, 0, 0, fmt.Errorf("invalid viewport limit")
		}
	}
	if raw := values["offset"]; len(raw) == 1 {
		offset, err = strconv.Atoi(raw[0])
		if err != nil || offset < 0 || offset > 10000000 {
			return bounds, 0, 0, fmt.Errorf("invalid viewport offset")
		}
	}
	return bounds, limit, offset, nil
}

func (h *desktopIPCHandler) mediaPlacesViewport(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	bounds, limit, offset, err := parseDesktopIPCMediaPlacesViewport(r.URL.RawQuery)
	if err != nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_places_viewport", "invalid media viewport")
		return
	}
	// Compatibility: no implicit fallback to unbounded old Places list.
	p, ok := h.ctrl.(interface {
		CloudMediaPlacesViewport(context.Context, client.MediaPlacesViewportBounds, int, int) (client.MediaPlacesViewportPage, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "unsupported_media_places_viewport", "update Agent for map viewport")
		return
	}
	page, err := p.CloudMediaPlacesViewport(r.Context(), bounds, limit, offset)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, page)
}
