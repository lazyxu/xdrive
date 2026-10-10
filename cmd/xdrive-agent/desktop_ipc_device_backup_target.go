package main

import (
	"context"
	"net/http"

	"github.com/lazyxu/xdrive/internal/client"
)

// The ordinary Source IPC must never substitute for this owning-Agent port.
type desktopIPCLocalBackupTargetWriter interface {
	CloudRetargetLocalBoundBackup(context.Context, uint64, uint64, uint64) (client.LocalBoundBackupSettings, error)
}

func (h *desktopIPCHandler) retargetLocalBoundBackup(w http.ResponseWriter, r *http.Request) {
	var input struct {
		SourceID     uint64 `json:"source_id"`
		Revision     uint64 `json:"revision"`
		TargetNodeID uint64 `json:"target_node_id"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.SourceID == 0 || input.Revision == 0 || input.TargetNodeID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_backup_target", "positive Source, revision and cloud target Node IDs required")
		return
	}
	writer, ok := h.ctrl.(desktopIPCLocalBackupTargetWriter)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_backup_target_unsupported", "owning Agent target editing unavailable")
		return
	}
	result, err := writer.CloudRetargetLocalBoundBackup(r.Context(), input.SourceID, input.Revision, input.TargetNodeID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeDesktopIPCJSON(w, http.StatusOK, result)
}
