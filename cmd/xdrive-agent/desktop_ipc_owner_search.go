package main

import (
    "net/http"
    "net/url"

    "github.com/lazyxu/xdrive/internal/localbackupipc"
)

// A bounded Owner-only search route for DSM's backup-only runtime.
// This does not grant the general Desktop cloud search/filter API.
func (h *desktopIPCHandler) cloudOwnerSearch(w http.ResponseWriter, r *http.Request) {
    q, err := url.ParseQuery(r.URL.RawQuery)
    if err != nil || len(q) < 1 || len(q) > 2 || len(q["q"]) != 1 ||
        len(q["cursor"]) > 1 {
        writeDesktopIPCError(w, http.StatusBadRequest, "invalid_owner_search", "invalid Owner search selector")
        return
    }
    for key := range q {
        if key != "q" && key != "cursor" {
            writeDesktopIPCError(w, http.StatusBadRequest, "invalid_owner_search", "unknown Owner search parameter")
            return
        }
    }
    query, cursor := q.Get("q"), q.Get("cursor")
    if !localbackupipc.ValidOwnerSearchQuery(query) ||
        !localbackupipc.ValidOwnerFileCursor(cursor) ||
        (len(q["cursor"]) > 0 && cursor == "") {
        writeDesktopIPCError(w, http.StatusBadRequest, "invalid_owner_search", "invalid Owner search query")
        return
    }
    page, err := h.ctrl.CloudSearch(r.Context(), query, cursor, "name", "asc", agentCloudSearchFilters{})
    if err != nil {
        writeDesktopIPCControllerError(w, err)
        return
    }
    writeDesktopIPCJSON(w, http.StatusOK, page)
}
