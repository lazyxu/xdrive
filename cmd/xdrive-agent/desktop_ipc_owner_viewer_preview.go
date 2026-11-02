package main

import (
	"context"
	"net/http"
	"net/url"
	"strconv"

	"github.com/lazyxu/xdrive/internal/client"
)

type desktopIPCOwnerViewerPreviewReader interface {
	CloudOwnerViewerPreviewRange(context.Context, uint64, uint64, string, int64, int) (
		client.OwnerViewerPreviewRange, error)
}

func (h *desktopIPCHandler) cloudOwnerViewerPreviewRange(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(q) != 5 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_owner_viewer_preview", "exact Viewer preview selector required")
		return
	}
	for _, field := range []string{"node_id", "revision", "format", "offset", "length"} {
		if len(q[field]) != 1 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_owner_viewer_preview", "missing or duplicate field")
			return
		}
	}
	id, e1 := strconv.ParseUint(q.Get("node_id"), 10, 64)
	revision, e2 := strconv.ParseUint(q.Get("revision"), 10, 64)
	offset, e3 := strconv.ParseInt(q.Get("offset"), 10, 64)
	length, e4 := strconv.Atoi(q.Get("length"))
	format := q.Get("format")
	if e1 != nil || e2 != nil || e3 != nil || e4 != nil ||
		id < 1 || id > 1<<53-1 || revision < 1 || revision > 1<<53-1 ||
		offset < 0 || offset >= client.OwnerViewerPreviewMaxBytes ||
		length < 1 || length > client.OwnerViewerPreviewChunkBytes ||
		(format != "webp" && format != "jpeg") ||
		strconv.FormatUint(id, 10) != q.Get("node_id") ||
		strconv.FormatUint(revision, 10) != q.Get("revision") ||
		strconv.FormatInt(offset, 10) != q.Get("offset") ||
		strconv.Itoa(length) != q.Get("length") {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_owner_viewer_preview", "noncanonical Viewer preview selector")
		return
	}
	ctrl, ok := h.ctrl.(desktopIPCOwnerViewerPreviewReader)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "owner_viewer_preview_unavailable", "Agent does not support viewer derivative")
		return
	}
	data, err := ctrl.CloudOwnerViewerPreviewRange(r.Context(), id, revision, format, offset, length)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	if !client.ValidOwnerViewerPreviewRange(data, id, revision, format, offset, length) {
		writeDesktopIPCError(w, http.StatusBadGateway, "invalid_owner_viewer_preview", "unsafe Agent Viewer preview body")
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, data)
}
