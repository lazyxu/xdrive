package main

import (
	"context"
	"net/http"
	"path/filepath"
)

type desktopIPCLocalBackupPathPreflighter interface {
	PreflightLocalFolderPath(context.Context, string) error
}

// Only an authenticated, same-user loopback IPC caller may request local
// preflight. No Source, token or Root grant is created by this read-only call.
func (h *desktopIPCHandler) preflightLocalBackupCLI(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Path string `json:"path"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if len([]byte(input.Path)) == 0 || len([]byte(input.Path)) > 4096 ||
		!filepath.IsAbs(input.Path) || filepath.Clean(input.Path) != input.Path {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_local_backup_root",
			"explicit, canonical absolute local directory required")
		return
	}
	checker, ok := h.ctrl.(desktopIPCLocalBackupPathPreflighter)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "local_backup_preflight_unavailable",
			"owning Agent local path preflight unsupported")
		return
	}
	if err := checker.PreflightLocalFolderPath(r.Context(), input.Path); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
