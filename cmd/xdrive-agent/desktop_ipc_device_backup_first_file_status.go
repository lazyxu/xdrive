package main

import (
	"context"
	"net/http"
	"runtime"
	"strconv"
	"strings"

	"github.com/lazyxu/xdrive/internal/localpushrunner"
)

type desktopIPCLocalFirstFileStatusReader interface {
	CloudReadLocalBoundBackupFirstFileStatus(context.Context, uint64) (localBackupFirstFileJobStatus, error)
}

// Only the same authenticated owning Desktop->Agent loopback IPC used for the
// real first-file upload can inspect its process-local status. This GET never
// invokes the writer, Stage, preparation, COMMIT, cancellation or retry.
func (h *desktopIPCHandler) readLocalBoundBackupFirstFileStatus(w http.ResponseWriter, r *http.Request) {
	if runtime.GOOS != "linux" && runtime.GOOS != "windows" {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_first_file_status_platform_unavailable", "local first-file status unavailable")
		return
	}
	query := r.URL.Query()
	values := query["source_id"]
	if r.ContentLength != 0 || len(query) != 1 || len(values) != 1 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_first_file_status_request", "source_id only")
		return
	}
	sourceID, err := strconv.ParseUint(strings.TrimSpace(values[0]), 10, 64)
	if err != nil || sourceID == 0 || sourceID > desktopEvidenceMaxSafeID {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_first_file_status_source", "valid Source ID required")
		return
	}
	reader, ok := h.ctrl.(desktopIPCLocalFirstFileStatusReader)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_first_file_status_unavailable", "owning Agent first-file status unavailable")
		return
	}
	view, err := reader.CloudReadLocalBoundBackupFirstFileStatus(r.Context(), sourceID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	if view.SourceID != sourceID || view.BackupComplete || view.RetirementSafe {
		writeDesktopIPCError(w, http.StatusConflict, "local_first_file_status_uncertain", "first-file status is not authoritative")
		return
	}
	switch view.Phase {
	case "observed":
		if !view.PhysicalObserved || view.Revision == 0 ||
			view.Revision > desktopEvidenceMaxSafeID || view.ObservedBytes < 0 ||
			view.ObservedBytes > localpushrunner.MaxFirstLeafBytes {
			writeDesktopIPCError(w, http.StatusConflict, "local_first_file_status_uncertain", "invalid physical observation")
			return
		}
	case "running", "uncertain", "not-recorded":
		if view.PhysicalObserved || view.Revision != 0 || view.ObservedBytes != 0 {
			writeDesktopIPCError(w, http.StatusConflict, "local_first_file_status_uncertain", "untrusted observation")
			return
		}
	default:
		writeDesktopIPCError(w, http.StatusConflict, "local_first_file_status_uncertain", "unknown first-file phase")
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeDesktopIPCJSON(w, http.StatusOK, view)
}
