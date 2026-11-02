package synologyui

import (
    "context"
    "net/http"
    "net/url"

    "github.com/lazyxu/xdrive/internal/localbackupipc"
)

// Only an authenticated DSM principal and the same owning Agent can search
// Server Owner files. The browser never supplies a NAS path or Server token.
type OwnerSearchReader interface {
    OwnerSearchPage(context.Context, string, string) (localbackupipc.OwnerSearchPage, error)
}

func serveDSMOwnerSearch(w http.ResponseWriter, r *http.Request, agent Agent) {
    reader, ok := agent.(OwnerSearchReader)
    if !ok {
        http.Error(w, "Owner search not supported by this Agent", http.StatusNotImplemented)
        return
    }
    q, err := url.ParseQuery(r.URL.RawQuery)
    if err != nil || len(q) < 1 || len(q) > 2 ||
        len(q["q"]) != 1 || len(q["cursor"]) > 1 {
        http.Error(w, "invalid Owner search parameters", http.StatusBadRequest)
        return
    }
    for key := range q {
        if key != "q" && key != "cursor" {
            http.Error(w, "unknown Owner search parameter", http.StatusBadRequest)
            return
        }
    }
    query, cursor := q.Get("q"), q.Get("cursor")
    if !localbackupipc.ValidOwnerSearchQuery(query) ||
        !localbackupipc.ValidOwnerFileCursor(cursor) ||
        (len(q["cursor"]) != 0 && cursor == "") {
        http.Error(w, "invalid Owner search selector", http.StatusBadRequest)
        return
    }
    page, err := reader.OwnerSearchPage(r.Context(), query, cursor)
    if err != nil || !localbackupipc.ValidateOwnerSearchPage(page, cursor) {
        http.Error(w, "verified Owner search unavailable", http.StatusServiceUnavailable)
        return
    }
    sendJSON(w, page)
}
