package main

import (
	"context"
	"net/http"

	"github.com/lazyxu/xdrive/internal/client"
)

// The Agent-only removal port cannot fall back to generic Source deletion.
type desktopIPCLocalBoundBackupRemover interface {
	CloudRemoveLocalBoundBackup(context.Context, uint64, uint64) (client.LocalBoundBackupRemoval, error)
}

func (h *desktopIPCHandler) removeLocalBoundBackup(w http.ResponseWriter, r *http.Request) {
	var input struct {
		SourceID uint64 `json:"source_id"`
		Revision uint64 `json:"revision"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.SourceID == 0 || input.Revision == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_backup_remove", "positive Source ID and revision required")
		return
	}
	remover, ok := h.ctrl.(desktopIPCLocalBoundBackupRemover)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_backup_remove_unavailable", "owning Agent removal unavailable")
		return
	}
	result, err := remover.CloudRemoveLocalBoundBackup(r.Context(), input.SourceID, input.Revision)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeDesktopIPCJSON(w, http.StatusOK, result)
}
