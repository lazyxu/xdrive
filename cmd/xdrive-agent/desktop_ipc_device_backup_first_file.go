package main

import (
	"context"
	"net/http"
	"runtime"
	"strconv"
	"strings"

	"github.com/lazyxu/xdrive/internal/localpushrunner"
)

// This is an owning-device-only, real first-file upload, not a generic
// Source trigger. The Agent chooses the file from its verified private
// inventory; renderer/Web never provide an OS path, hash or credential.
type desktopIPCLocalFirstFileRunner interface {
	CloudStartLocalBoundBackupFirstFile(context.Context, uint64) (localBackupFirstFileSummary, error)
}

func (h *desktopIPCHandler) startLocalBoundBackupFirstFile(w http.ResponseWriter, r *http.Request) {
	if runtime.GOOS != "linux" && runtime.GOOS != "windows" {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_first_file_platform_unavailable", "local first-file upload unavailable on this device")
		return
	}
	query := r.URL.Query()
	values := query["source_id"]
	if r.ContentLength != 0 || len(query) != 1 || len(values) != 1 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_first_file_request", "source_id only")
		return
	}
	sourceID, err := strconv.ParseUint(strings.TrimSpace(values[0]), 10, 64)
	if err != nil || sourceID == 0 || sourceID > desktopEvidenceMaxSafeID {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_first_file_source", "valid Source ID required")
		return
	}
	manager, ok := h.ctrl.(desktopIPCLocalFirstFileRunner)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_first_file_unavailable", "owning Agent first-file uploader unavailable")
		return
	}
	result, err := manager.CloudStartLocalBoundBackupFirstFile(r.Context(), sourceID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	if result.SourceID != sourceID || result.Revision == 0 ||
		result.Revision > desktopEvidenceMaxSafeID ||
		result.ObservedFiles != 1 || result.ObservedBytes < 0 ||
		result.ObservedBytes > localpushrunner.MaxFirstLeafBytes ||
		!result.PhysicalObserved || result.BackupComplete || result.RetirementSafe {
		writeDesktopIPCError(w, http.StatusConflict, "local_first_file_uncertain", "first-file observation not authoritative")
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeDesktopIPCJSON(w, http.StatusOK, result)
}
