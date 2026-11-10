package main

import (
	"context"
	"net/http"
	"net/url"
	"strconv"

	"github.com/lazyxu/xdrive/internal/localbackupipc"
)

// A fixed read-only Files bridge: no arbitrary path, URL, Device credential
// or ciphertext can be requested through Clipboard's one-shot Viewer handoff.
func (h *desktopIPCHandler) cloudClipboardFile(w http.ResponseWriter, r *http.Request) {
	values, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(values) != 1 || len(values["node_id"]) != 1 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_node_id", "one file Node ID required")
		return
	}
	raw := values.Get("node_id")
	id, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || !localbackupipc.ValidOwnerFileID(id) ||
		strconv.FormatUint(id, 10) != raw {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_node_id", "invalid file Node identity")
		return
	}
	provider, ok := h.ctrl.(interface {
		CloudClipboardFileReference(context.Context, uint64) (localbackupipc.OwnerClipboardFileReference, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "clipboard_file_unavailable", "Owner Files bridge unavailable")
		return
	}
	file, err := provider.CloudClipboardFileReference(r.Context(), id)
	if err != nil || !localbackupipc.ValidateOwnerClipboardFileReference(file, id) {
		writeDesktopIPCError(w, http.StatusForbidden, "clipboard_file_unavailable", "current Owner Files read not verified")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeDesktopIPCJSON(w, http.StatusOK, file)
}
