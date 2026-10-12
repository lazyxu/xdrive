package main

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/lazyxu/xdrive/internal/client"
)

type desktopIPCAdminStorageController interface {
	CloudAdminStorage(context.Context, client.AdminStorageRequest) (json.RawMessage, error)
}

var desktopAdminStorageOperations = map[string]bool{
	"stats": true, "health": true, "history": true, "legacy": true,
	"unreferenced": true, "staging": true, "cleanup-runs": true,
	"cleanup-failures": true, "cleanup-staging": true, "cleanup-cache": true,
}
var desktopAdminStorageCacheKinds = map[string]bool{
	"media_thumbnail": true, "video_poster": true, "analysis_preview": true,
	"upload_staging": true, "storage_temp": true, "all": true,
}

func validDesktopAdminStorageRequest(input client.AdminStorageRequest) bool {
	if !desktopAdminStorageOperations[input.Operation] ||
		input.Limit < 0 || input.Limit > 200 || input.Offset < 0 ||
		len(input.Cursor) > 2048 {
		return false
	}
	switch input.Operation {
	case "history":
		return input.Days == 30 || input.Days == 90 || input.Days == 180
	case "legacy", "unreferenced", "staging", "cleanup-runs":
		return input.Limit > 0
	case "cleanup-failures":
		return input.Limit > 0 && input.RunID > 0
	case "cleanup-cache":
		return desktopAdminStorageCacheKinds[input.Kind]
	default:
		return input.Kind == ""
	}
}

func (h *desktopIPCHandler) cloudAdminStorage(w http.ResponseWriter, r *http.Request) {
	snapshot, _ := h.ctrl.SnapshotWithRevision()
	if !snapshot.Configured || snapshot.Role != "admin" || snapshot.MustChangePassword {
		writeDesktopIPCError(w, http.StatusForbidden, "admin_required", "administrator session required")
		return
	}
	provider, ok := h.ctrl.(desktopIPCAdminStorageController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "admin_storage_unavailable", "update xDrive Agent to manage global storage")
		return
	}
	var request client.AdminStorageRequest
	if !decodeDesktopIPCJSON(w, r, &request) {
		return
	}
	if !validDesktopAdminStorageRequest(request) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_admin_storage", "invalid bounded global storage request")
		return
	}
	result, err := provider.CloudAdminStorage(r.Context(), request)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeDesktopIPCJSON(w, http.StatusOK, result)
}
