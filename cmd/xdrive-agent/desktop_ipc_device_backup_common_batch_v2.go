package main

import (
	"context"
	"net/http"
	"runtime"
	"strconv"
	"strings"
)

type localBackupCommonBatchSummary struct {
	SourceID           uint64 `json:"source_id"`
	Revision           uint64 `json:"revision"`
	State              string `json:"state"`
	Running            bool   `json:"running"`
	InspectedFiles     int64  `json:"inspected_files"`
	ConfirmedFiles     int64  `json:"confirmed_files"`
	SkippedFiles       int64  `json:"skipped_files"`
	UnsupportedFiles   int64  `json:"unsupported_files"`
	UncertainFiles     int64  `json:"uncertain_files"`
	ConfirmedBytes     int64  `json:"confirmed_bytes"`
	BackupComplete     bool   `json:"backup_complete"`
	RetirementSafe     bool   `json:"retirement_safe"`
	CurrentCASVerified bool   `json:"current_cas_verified"`
}

// The Desktop IPC accepts only an owning Source ID, never a pathname,
// target Node, digest, Device token or Operation ID supplied by Renderer.
type desktopIPCLocalCommonBatchRunner interface {
	CloudStartLocalBoundBackupCommonBatch(context.Context, uint64) (localBackupCommonBatchSummary, error)
	CloudLocalBoundBackupCommonBatchStatus(context.Context, uint64) (localBackupCommonBatchSummary, error)
}

func validLocalCommonBatchRequest(r *http.Request) (uint64, bool) {
	if r == nil || r.ContentLength != 0 {
		return 0, false
	}
	query := r.URL.Query()
	values := query["source_id"]
	if len(query) != 1 || len(values) != 1 {
		return 0, false
	}
	sourceID, err := strconv.ParseUint(strings.TrimSpace(values[0]), 10, 64)
	return sourceID, err == nil && sourceID != 0 && sourceID <= desktopEvidenceMaxSafeID
}

func (h *desktopIPCHandler) startLocalBoundBackupCommonBatch(w http.ResponseWriter, r *http.Request) {
	if runtime.GOOS != "linux" && runtime.GOOS != "windows" {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_common_batch_platform_unavailable", "local backup unavailable")
		return
	}
	sourceID, ok := validLocalCommonBatchRequest(r)
	if !ok {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_common_batch_request", "source_id only")
		return
	}
	runner, ok := h.ctrl.(desktopIPCLocalCommonBatchRunner)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_common_batch_unavailable", "owning Agent unavailable")
		return
	}

	result, err := runner.CloudStartLocalBoundBackupCommonBatch(r.Context(), sourceID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	if result.SourceID != sourceID ||
		result.BackupComplete || result.RetirementSafe ||
		result.CurrentCASVerified ||
		(result.State != "running" && result.State != "partial" &&
			result.State != "uncertain") ||
		result.Running != (result.State == "running") ||
		(result.State != "running" && result.Revision == 0) {
		writeDesktopIPCError(w, http.StatusConflict, "local_common_batch_uncertain", "local backup status unavailable")
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	if result.State == "running" {
		writeDesktopIPCJSON(w, http.StatusAccepted, result)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) localBoundBackupCommonBatchStatus(w http.ResponseWriter, r *http.Request) {
	if runtime.GOOS != "linux" && runtime.GOOS != "windows" {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_common_batch_platform_unavailable", "local backup unavailable")
		return
	}
	sourceID, ok := validLocalCommonBatchRequest(r)
	if !ok {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_common_batch_request", "source_id only")
		return
	}
	runner, ok := h.ctrl.(desktopIPCLocalCommonBatchRunner)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_common_batch_unavailable", "owning Agent unavailable")
		return
	}
	result, err := runner.CloudLocalBoundBackupCommonBatchStatus(r.Context(), sourceID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	if result.SourceID != sourceID || result.BackupComplete ||
		result.RetirementSafe || result.CurrentCASVerified ||
		(result.State != "running" && result.State != "partial" &&
			result.State != "uncertain") {
		writeDesktopIPCError(w, http.StatusConflict, "local_common_batch_uncertain", "local backup state unavailable")
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeDesktopIPCJSON(w, http.StatusOK, result)
}
