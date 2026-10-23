package main

import (
	"context"
	"net/http"
	"runtime"
	"strconv"
	"strings"
	"time"
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
	StopRequested      string `json:"stop_requested,omitempty"`
	BackupComplete     bool   `json:"backup_complete"`
	RetirementSafe     bool   `json:"retirement_safe"`
	CurrentCASVerified bool   `json:"current_cas_verified"`
}

// A private owning-Desktop history projection. There are no file names,
// Root fingerprints, JWTs, content digests or Operation IDs in this payload.
type localBackupCommonBatchHistoryItem struct {
	RunID            string    `json:"run_id"`
	SourceID         uint64    `json:"source_id"`
	Revision         uint64    `json:"revision"`
	State            string    `json:"state"`
	InspectedFiles   int64     `json:"inspected_files"`
	ConfirmedFiles   int64     `json:"confirmed_files"`
	SkippedFiles     int64     `json:"skipped_files"`
	UnsupportedFiles int64     `json:"unsupported_files"`
	UncertainFiles   int64     `json:"uncertain_files"`
	ConfirmedBytes   int64     `json:"confirmed_bytes"`
	StartedAt        time.Time `json:"started_at"`
	FinishedAt       time.Time `json:"finished_at"`
}

type localBackupCommonBatchHistoryPage struct {
	SourceID uint64                              `json:"source_id"`
	Items    []localBackupCommonBatchHistoryItem `json:"items"`
}

type desktopIPCLocalCommonBatchHistoryReader interface {
	CloudLocalBoundBackupCommonBatchHistory(context.Context, uint64) (localBackupCommonBatchHistoryPage, error)
}

// The Desktop IPC accepts only an owning Source ID, never a pathname,
// target Node, digest, Device token or Operation ID supplied by Renderer.
type desktopIPCLocalCommonBatchRunner interface {
	CloudStartLocalBoundBackupCommonBatch(context.Context, uint64) (localBackupCommonBatchSummary, error)
	CloudLocalBoundBackupCommonBatchStatus(context.Context, uint64) (localBackupCommonBatchSummary, error)
	CloudControlLocalBoundBackupCommonBatch(context.Context, uint64, string) (localBackupCommonBatchSummary, error)
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
			result.State != "uncertain" && result.State != "paused" &&
			result.State != "cancelled") ||
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

// Control only the NEXT-file scheduler, not the ongoing SQL/CAS operation.
// Exactly one owning Source ID and one enumerated action are accepted.
func validLocalCommonBatchControlRequest(r *http.Request) (uint64, string, bool) {
	if r == nil || r.ContentLength != 0 {
		return 0, "", false
	}
	q := r.URL.Query()
	sourceValues, actionValues := q["source_id"], q["action"]
	if len(q) != 2 || len(sourceValues) != 1 || len(actionValues) != 1 {
		return 0, "", false
	}
	sourceID, err := strconv.ParseUint(sourceValues[0], 10, 64)
	if err != nil || sourceID == 0 || sourceID > desktopEvidenceMaxSafeID ||
		(actionValues[0] != "pause" && actionValues[0] != "cancel") {
		return 0, "", false
	}
	return sourceID, actionValues[0], true
}

func (h *desktopIPCHandler) controlLocalBoundBackupCommonBatch(w http.ResponseWriter, r *http.Request) {
	if runtime.GOOS != "linux" && runtime.GOOS != "windows" {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_common_batch_platform_unavailable", "local backup unavailable")
		return
	}
	sourceID, action, ok := validLocalCommonBatchControlRequest(r)
	if !ok {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_common_batch_control", "source_id and pause/cancel action only")
		return
	}
	runner, ok := h.ctrl.(desktopIPCLocalCommonBatchRunner)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_common_batch_unavailable", "owning Agent unavailable")
		return
	}
	result, err := runner.CloudControlLocalBoundBackupCommonBatch(r.Context(), sourceID, action)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	if result.SourceID != sourceID || result.State != "running" ||
		!result.Running || (result.StopRequested != "pause" && result.StopRequested != "cancel") ||
		result.BackupComplete || result.RetirementSafe || result.CurrentCASVerified {
		writeDesktopIPCError(w, http.StatusConflict, "local_common_batch_uncertain", "local batch control unavailable")
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeDesktopIPCJSON(w, http.StatusAccepted, result)
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
			result.State != "uncertain" && result.State != "paused" &&
			result.State != "cancelled") {
		writeDesktopIPCError(w, http.StatusConflict, "local_common_batch_uncertain", "local backup state unavailable")
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) localBoundBackupCommonBatchHistory(w http.ResponseWriter, r *http.Request) {
	if runtime.GOOS != "linux" && runtime.GOOS != "windows" {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_common_history_platform_unavailable", "local backup unavailable")
		return
	}
	sourceID, ok := validLocalCommonBatchRequest(r)
	if !ok {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_common_history_request", "source_id only")
		return
	}
	reader, ok := h.ctrl.(desktopIPCLocalCommonBatchHistoryReader)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_common_history_unavailable", "owning Agent unavailable")
		return
	}
	result, err := reader.CloudLocalBoundBackupCommonBatchHistory(r.Context(), sourceID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	if result.SourceID != sourceID || len(result.Items) > 20 {
		writeDesktopIPCError(w, http.StatusConflict, "local_common_history_invalid", "local backup history unavailable")
		return
	}
	for _, item := range result.Items {
		if item.SourceID != sourceID || item.Revision == 0 || item.RunID == "" ||
			(item.State != "partial" && item.State != "uncertain" &&
				item.State != "paused" && item.State != "cancelled") ||
			item.InspectedFiles < 0 || item.ConfirmedFiles < 0 ||
			item.SkippedFiles < 0 || item.UncertainFiles < 0 ||
			item.FinishedAt.IsZero() {
			writeDesktopIPCError(w, http.StatusConflict, "local_common_history_invalid", "invalid private backup attempt")
			return
		}
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeDesktopIPCJSON(w, http.StatusOK, result)
}
