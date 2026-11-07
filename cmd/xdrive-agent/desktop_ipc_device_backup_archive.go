package main

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/lazyxu/xdrive/internal/client"
)

type desktopIPCLocalBoundBackupArchivePort interface {
	CloudLocalBoundBackupArchiveSettings(context.Context, uint64) (client.LocalBoundBackupSettings, error)
	CloudArchiveLocalBoundBackup(context.Context, uint64, uint64) (client.LocalBoundBackupSettings, error)
	CloudRestoreLocalBoundBackup(context.Context, uint64, uint64) (client.LocalBoundBackupSettings, error)
}

func (h *desktopIPCHandler) localBoundBackupArchiveSettings(w http.ResponseWriter, r *http.Request) {
	sourceID, err := strconv.ParseUint(strings.TrimSpace(r.URL.Query().Get("source_id")), 10, 64)
	if err != nil || sourceID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_backup_source", "positive source_id required")
		return
	}
	port, ok := h.ctrl.(desktopIPCLocalBoundBackupArchivePort)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_backup_archive_unavailable", "owning Agent archive/restore unavailable")
		return
	}
	result, err := port.CloudLocalBoundBackupArchiveSettings(r.Context(), sourceID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) archiveLocalBoundBackup(w http.ResponseWriter, r *http.Request) {
	h.changeLocalBoundBackupArchiveState(w, r, true)
}

func (h *desktopIPCHandler) restoreLocalBoundBackup(w http.ResponseWriter, r *http.Request) {
	h.changeLocalBoundBackupArchiveState(w, r, false)
}

func (h *desktopIPCHandler) changeLocalBoundBackupArchiveState(w http.ResponseWriter, r *http.Request, archive bool) {
	var input struct {
		SourceID uint64 `json:"source_id"`
		Revision uint64 `json:"revision"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.SourceID == 0 || input.Revision == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_backup_revision", "positive Source ID and revision required")
		return
	}
	port, ok := h.ctrl.(desktopIPCLocalBoundBackupArchivePort)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_backup_archive_unavailable", "owning Agent archive/restore unavailable")
		return
	}
	var (
		result client.LocalBoundBackupSettings
		err    error
	)
	if archive {
		result, err = port.CloudArchiveLocalBoundBackup(r.Context(), input.SourceID, input.Revision)
	} else {
		result, err = port.CloudRestoreLocalBoundBackup(r.Context(), input.SourceID, input.Revision)
	}
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeDesktopIPCJSON(w, http.StatusOK, result)
}
