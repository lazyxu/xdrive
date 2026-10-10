package main

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/lazyxu/xdrive/internal/client"
)

// No generic Source controller fallback when private Agent capability missing.
type desktopIPCBoundBackupConfigurator interface {
	CloudLocalBoundBackupSettings(context.Context, uint64) (client.LocalBoundBackupSettings, error)
	CloudRenameLocalBoundBackup(context.Context, uint64, uint64, string) (client.LocalBoundBackupSettings, error)
}

func (h *desktopIPCHandler) localBoundBackupSettings(w http.ResponseWriter, r *http.Request) {
	sourceID, err := strconv.ParseUint(strings.TrimSpace(r.URL.Query().Get("source_id")), 10, 64)
	if err != nil || sourceID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_source_id", "positive Source ID required")
		return
	}
	manager, ok := h.ctrl.(desktopIPCBoundBackupConfigurator)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_config_unavailable", "owning Agent settings unavailable")
		return
	}
	data, err := manager.CloudLocalBoundBackupSettings(r.Context(), sourceID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeDesktopIPCJSON(w, http.StatusOK, data)
}

func (h *desktopIPCHandler) renameLocalBoundBackup(w http.ResponseWriter, r *http.Request) {
	var input struct {
		SourceID uint64 `json:"source_id"`
		Revision uint64 `json:"revision"`
		Name     string `json:"name"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.SourceID == 0 || input.Revision == 0 || input.Name == "" || len([]byte(input.Name)) > 128 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_rename", "valid Source, revision and name <=128 bytes required")
		return
	}
	manager, ok := h.ctrl.(desktopIPCBoundBackupConfigurator)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_config_unavailable", "owning Agent settings unavailable")
		return
	}
	data, err := manager.CloudRenameLocalBoundBackup(r.Context(), input.SourceID, input.Revision, input.Name)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeDesktopIPCJSON(w, http.StatusOK, data)
}
