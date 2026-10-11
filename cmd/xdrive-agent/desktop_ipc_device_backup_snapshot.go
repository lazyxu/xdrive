package main

import (
	"context"
	"net/http"
	"strconv"
	"strings"
)

// Deliberately separate from generic Sources and the remote B-scope viewer.
type desktopIPCLocalBackupSnapshotManager interface {
	CloudSaveLocalBoundBackupSnapshot(context.Context, uint64) (localBackupSnapshotSummary, error)
}

func (h *desktopIPCHandler) saveLocalBoundBackupSnapshot(w http.ResponseWriter, r *http.Request) {
	sourceID, err := strconv.ParseUint(strings.TrimSpace(r.URL.Query().Get("source_id")), 10, 64)
	if err != nil || sourceID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_snapshot_source", "positive Source ID required")
		return
	}
	manager, ok := h.ctrl.(desktopIPCLocalBackupSnapshotManager)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_backup_snapshot_unsupported", "owning Agent local snapshot unavailable")
		return
	}
	result, err := manager.CloudSaveLocalBoundBackupSnapshot(r.Context(), sourceID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeDesktopIPCJSON(w, http.StatusOK, result)
}
