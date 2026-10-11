package main

import (
	"context"
	"net/http"
	"strconv"
	"strings"
)

// Not a generic Source read: the controller must expose this private method.
type desktopIPCLocalBackupDeltaManager interface {
	CloudLocalBoundBackupDelta(context.Context, uint64) (localBackupDeltaSummary, error)
}

func (h *desktopIPCHandler) localBoundBackupDelta(w http.ResponseWriter, r *http.Request) {
	sourceID, err := strconv.ParseUint(strings.TrimSpace(r.URL.Query().Get("source_id")), 10, 64)
	if err != nil || sourceID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_delta_source", "positive Source ID required")
		return
	}
	manager, ok := h.ctrl.(desktopIPCLocalBackupDeltaManager)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_backup_delta_unsupported", "owning Agent local delta unavailable")
		return
	}
	result, err := manager.CloudLocalBoundBackupDelta(r.Context(), sourceID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeDesktopIPCJSON(w, http.StatusOK, result)
}
