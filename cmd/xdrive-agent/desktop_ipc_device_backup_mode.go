package main

import (
	"context"
	"net/http"

	"github.com/lazyxu/xdrive/internal/client"
)

// An owning-Agent port, never a renderer-accessible generic Source PATCH.
type desktopIPCLocalBackupModeWriter interface {
	CloudSetLocalBoundBackupMode(context.Context, uint64, uint64, string) (client.LocalBoundBackupSettings, error)
}

func (h *desktopIPCHandler) setLocalBoundBackupMode(w http.ResponseWriter, r *http.Request) {
	var input struct {
		SourceID uint64 `json:"source_id"`
		Revision uint64 `json:"revision"`
		SyncMode string `json:"sync_mode"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.SourceID == 0 || input.Revision == 0 || (input.SyncMode != "backup" && input.SyncMode != "mirror") {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_backup_mode", "positive Source and revision with backup or mirror required")
		return
	}
	writer, ok := h.ctrl.(desktopIPCLocalBackupModeWriter)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_backup_mode_unsupported", "owning Agent backup policy editing unavailable")
		return
	}
	result, err := writer.CloudSetLocalBoundBackupMode(r.Context(), input.SourceID, input.Revision, input.SyncMode)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeDesktopIPCJSON(w, http.StatusOK, result)
}
