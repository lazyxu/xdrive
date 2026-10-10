package main

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/lazyxu/xdrive/internal/client"
)

// The standalone interface keeps read-only legacy IPC controller mocks valid.
// The actual Agent reads its OS enrollment token; Renderer supplies no
// credential, Root identity or arbitrary device ID.
type desktopIPCLocalDraftReader interface {
	CloudLocalSourceDrafts(context.Context, int, uint64) (client.LocalSourceDraftPage, error)
}

func (h *desktopIPCHandler) deviceBackupLocalDrafts(w http.ResponseWriter, r *http.Request) {
	limit := 20
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_limit", "limit must be between 1 and 100")
			return
		}
		limit = parsed
	}
	var afterID uint64
	if raw := strings.TrimSpace(r.URL.Query().Get("after_id")); raw != "" {
		parsed, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_after_id", "after_id must be nonnegative")
			return
		}
		afterID = parsed
	}
	reader, ok := h.ctrl.(desktopIPCLocalDraftReader)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_drafts_unavailable", "owning Agent local draft listing is unavailable")
		return
	}
	items, err := reader.CloudLocalSourceDrafts(r.Context(), limit, afterID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeDesktopIPCJSON(w, http.StatusOK, items)
}
