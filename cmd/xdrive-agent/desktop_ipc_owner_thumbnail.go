package main

import (
	"context"
	"net/http"
	"net/url"
	"strconv"

	"github.com/lazyxu/xdrive/internal/client"
)

// Separate read capability for DSM. Neither the generic media-thumbnail URL
// nor a File Preview Ticket is permitted to a Backup-only NAS Agent.
type desktopIPCOwnerThumbnailReader interface {
	CloudOwnerThumbnail(context.Context, uint64, uint64) (client.OwnerThumbnail, error)
}

func (h *desktopIPCHandler) cloudOwnerThumbnail(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(q) != 2 || len(q["node_id"]) != 1 || len(q["revision"]) != 1 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_owner_thumbnail", "exact node/revision required")
		return
	}
	id, errID := strconv.ParseUint(q.Get("node_id"), 10, 64)
	revision, errRevision := strconv.ParseUint(q.Get("revision"), 10, 64)
	if errID != nil || errRevision != nil ||
		id == 0 || id > 1<<53-1 || revision == 0 || revision > 1<<53-1 ||
		strconv.FormatUint(id, 10) != q.Get("node_id") ||
		strconv.FormatUint(revision, 10) != q.Get("revision") {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_owner_thumbnail", "noncanonical Owner thumbnail")
		return
	}
	reader, ok := h.ctrl.(desktopIPCOwnerThumbnailReader)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "owner_thumbnail_unavailable", "Agent has no Owner thumbnail capability")
		return
	}
	thumbnail, err := reader.CloudOwnerThumbnail(r.Context(), id, revision)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	if !client.ValidateOwnerThumbnail(thumbnail) {
		writeDesktopIPCError(w, http.StatusBadGateway, "invalid_owner_thumbnail", "Server returned invalid thumbnail")
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, thumbnail)
}
