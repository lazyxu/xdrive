package main

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/sourceschedule"
)

// Never fall back to generic Source IPC for local-only schedule reads/writes.
type desktopIPCLocalBackupScheduleManager interface {
	CloudLocalBoundBackupSchedule(context.Context, uint64) (client.LocalBoundBackupSchedule, error)
	CloudSetLocalBoundBackupSchedule(context.Context, uint64, uint64, sourceschedule.Spec) (client.LocalBoundBackupSchedule, error)
}

func (h *desktopIPCHandler) localBoundBackupSchedule(w http.ResponseWriter, r *http.Request) {
	sourceID, err := strconv.ParseUint(strings.TrimSpace(r.URL.Query().Get("source_id")), 10, 64)
	if err != nil || sourceID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_schedule_source", "positive Source ID required")
		return
	}
	manager, ok := h.ctrl.(desktopIPCLocalBackupScheduleManager)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_backup_schedule_unsupported", "owning Agent schedule unavailable")
		return
	}
	result, err := manager.CloudLocalBoundBackupSchedule(r.Context(), sourceID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) setLocalBoundBackupSchedule(w http.ResponseWriter, r *http.Request) {
	var input struct {
		SourceID           uint64 `json:"source_id"`
		Revision           uint64 `json:"revision"`
		ScheduleType       string `json:"schedule_type"`
		ScheduleExpression string `json:"schedule_expression"`
		ScheduleTimezone   string `json:"schedule_timezone"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.SourceID == 0 || input.Revision == 0 ||
		len([]byte(input.ScheduleType)) > 16 || len([]byte(input.ScheduleExpression)) > 256 ||
		len([]byte(input.ScheduleTimezone)) > 128 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_backup_schedule", "invalid schedule field bounds or Source revision")
		return
	}
	spec, err := sourceschedule.Normalize(input.ScheduleType, input.ScheduleExpression, input.ScheduleTimezone)
	if err != nil || spec.Type == "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_backup_schedule", "manual, interval or cron with valid expression and timezone required")
		return
	}
	manager, ok := h.ctrl.(desktopIPCLocalBackupScheduleManager)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_backup_schedule_unsupported", "owning Agent schedule unavailable")
		return
	}
	result, err := manager.CloudSetLocalBoundBackupSchedule(r.Context(), input.SourceID, input.Revision, spec)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeDesktopIPCJSON(w, http.StatusOK, result)
}
