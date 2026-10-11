package main

import (
	"context"
	"net/http"
	"strconv"
	"strings"
)

// The authenticated loopback Agent IPC has no generic Source fallback.
type desktopIPCLocalBackupPreviewManager interface {
	CloudLocalBoundBackupPreview(context.Context, uint64) (localBackupPreviewSummary, error)
}

func (h *desktopIPCHandler) localBoundBackupPreview(w http.ResponseWriter, r *http.Request) {
	sourceID, err := strconv.ParseUint(strings.TrimSpace(r.URL.Query().Get("source_id")), 10, 64)
	if err != nil || sourceID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_preview_source", "positive Source ID required")
		return
	}
	manager, ok := h.ctrl.(desktopIPCLocalBackupPreviewManager)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_backup_preview_unsupported", "owning Agent preview unavailable")
		return
	}
	result, err := manager.CloudLocalBoundBackupPreview(r.Context(), sourceID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeDesktopIPCJSON(w, http.StatusOK, result)
}
