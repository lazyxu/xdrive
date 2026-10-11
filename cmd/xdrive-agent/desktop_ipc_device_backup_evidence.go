package main

import (
	"context"
	"net/http"
	"strconv"
	"strings"
)

// This capability only exists on the owning Agent. The caller cannot provide
// an OS path, Root grant, device ID, Source revision or native identity.
type desktopIPCLocalBackupEvidenceManager interface {
	CloudStageLocalBoundBackupEvidence(context.Context, uint64) (localBackupEvidenceStageSummary, error)
}

func (h *desktopIPCHandler) stageLocalBoundBackupEvidence(w http.ResponseWriter, r *http.Request) {
	if r.ContentLength != 0 || len(r.URL.Query()) != 1 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_evidence_request", "source_id only")
		return
	}
	sourceID, err := strconv.ParseUint(strings.TrimSpace(r.URL.Query().Get("source_id")), 10, 64)
	if err != nil || sourceID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_evidence_source", "positive Source ID required")
		return
	}
	manager, ok := h.ctrl.(desktopIPCLocalBackupEvidenceManager)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_backup_evidence_unsupported", "owning Agent evidence staging unavailable")
		return
	}
	result, err := manager.CloudStageLocalBoundBackupEvidence(r.Context(), sourceID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeDesktopIPCJSON(w, http.StatusOK, result)
}
