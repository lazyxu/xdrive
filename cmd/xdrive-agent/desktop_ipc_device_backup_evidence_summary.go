package main

import (
	"context"
	"net/http"
	"strconv"
	"strings"
)

// The owning Agent must opt in to this narrow, private COUNT-only read.
// Generic Sources and other devices cannot provide the same capability.
type desktopIPCLocalBackupEvidenceSummaryManager interface {
	CloudReadLocalBoundBackupEvidenceSummary(context.Context, uint64) (localBackupPersistedEvidenceSummary, error)
}

func (h *desktopIPCHandler) localBoundBackupEvidenceSummary(w http.ResponseWriter, r *http.Request) {
	ids := r.URL.Query()["source_id"]
	if r.ContentLength != 0 || len(r.URL.Query()) != 1 || len(ids) != 1 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_evidence_summary_request", "source_id only")
		return
	}
	sourceID, err := strconv.ParseUint(strings.TrimSpace(ids[0]), 10, 64)
	if err != nil || sourceID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_evidence_summary_source", "positive Source ID required")
		return
	}
	manager, ok := h.ctrl.(desktopIPCLocalBackupEvidenceSummaryManager)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_backup_evidence_summary_unsupported", "owning Agent private evidence read unavailable")
		return
	}
	result, err := manager.CloudReadLocalBoundBackupEvidenceSummary(r.Context(), sourceID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeDesktopIPCJSON(w, http.StatusOK, result)
}
