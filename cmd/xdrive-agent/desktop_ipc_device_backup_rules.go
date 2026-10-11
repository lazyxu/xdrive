package main

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/lazyxu/xdrive/internal/client"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
)

// Separate, capability-gated, private Agent-only read/edit surface.
// Never borrow generic Sources IPC when owning-Agent capability is missing.
type desktopIPCLocalBackupRulesManager interface {
	CloudLocalBoundBackupRules(context.Context, uint64) (client.LocalBoundIgnoreRules, error)
	CloudSetLocalBoundBackupRules(context.Context, uint64, uint64, string) (client.LocalBoundIgnoreRules, error)
}

func (h *desktopIPCHandler) localBoundBackupRules(w http.ResponseWriter, r *http.Request) {
	sourceID, err := strconv.ParseUint(strings.TrimSpace(r.URL.Query().Get("source_id")), 10, 64)
	if err != nil || sourceID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_rules_source", "positive Source ID required")
		return
	}
	manager, ok := h.ctrl.(desktopIPCLocalBackupRulesManager)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_backup_rules_unsupported", "owning Agent rules unavailable")
		return
	}
	result, err := manager.CloudLocalBoundBackupRules(r.Context(), sourceID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) setLocalBoundBackupRules(w http.ResponseWriter, r *http.Request) {
	var input struct {
		SourceID    uint64 `json:"source_id"`
		Revision    uint64 `json:"revision"`
		IgnoreRules string `json:"ignore_rules"`
	}
	// 64KiB of rules plus bounded JSON escaping/field metadata.
	if !decodeDesktopIPCJSONLimit(w, r, &input, 4*sourcepkg.MaxIgnoreRulesBytes+2048) {
		return
	}
	if input.SourceID == 0 || input.Revision == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_rules_source", "positive Source ID and revision required")
		return
	}
	if _, err := sourcepkg.CompileIgnoreRules(input.IgnoreRules); err != nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_rules", "invalid ignore rule syntax or size")
		return
	}
	manager, ok := h.ctrl.(desktopIPCLocalBackupRulesManager)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_backup_rules_unsupported", "owning Agent rules unavailable")
		return
	}
	result, err := manager.CloudSetLocalBoundBackupRules(r.Context(), input.SourceID, input.Revision, input.IgnoreRules)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeDesktopIPCJSON(w, http.StatusOK, result)
}
