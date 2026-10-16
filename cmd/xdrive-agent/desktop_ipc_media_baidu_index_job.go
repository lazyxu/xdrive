package main

import (
	"context"
	"net/http"

	"github.com/lazyxu/xdrive/internal/client"
)

// This route runs only under the Agent's loopback/Bearer middleware; the
// renderer never receives the Agent's credential or raw/photo GPS.
func (h *desktopIPCHandler) mediaBaiduIndexJob(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	nodeID, ok := desktopIPCUint64Query(w, r, "node_id")
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		ctrl, ok := h.ctrl.(interface {
			CloudMediaBaiduIndexJob(context.Context, uint64) (client.MediaBaiduMapIndexJob, error)
		})
		if !ok {
			writeDesktopIPCError(w, http.StatusNotImplemented, "unsupported_media_baidu_index_job", "update Agent for photo map tasks")
			return
		}
		result, err := ctrl.CloudMediaBaiduIndexJob(r.Context(), nodeID)
		if err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusOK, result)
	case http.MethodPost:
		var input client.MediaBaiduMapIndexJobInput
		if !decodeDesktopIPCJSONLimit(w, r, &input, 512) {
			return
		}
		if input.ExpectedRevision == 0 || input.ExpectedRevision == ^uint64(0) || !input.Confirm {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_baidu_index_job", "current revision and explicit job confirmation required")
			return
		}
		ctrl, ok := h.ctrl.(interface {
			CloudEnqueueMediaBaiduIndexJob(context.Context, uint64, client.MediaBaiduMapIndexJobInput) (client.MediaBaiduMapIndexJob, error)
		})
		if !ok {
			writeDesktopIPCError(w, http.StatusNotImplemented, "unsupported_media_baidu_index_job", "update Agent for photo map tasks")
			return
		}
		result, err := ctrl.CloudEnqueueMediaBaiduIndexJob(r.Context(), nodeID, input)
		if err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusAccepted, result)
	case http.MethodDelete:
		if r.ContentLength != 0 || len(r.TransferEncoding) != 0 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_baidu_index_job", "cancellation body must be empty")
			return
		}
		revision, ok := desktopIPCUint64Query(w, r, "revision")
		if !ok {
			return
		}
		ctrl, ok := h.ctrl.(interface {
			CloudCancelMediaBaiduIndexJob(context.Context, uint64, uint64) (client.MediaBaiduMapIndexJob, error)
		})
		if !ok {
			writeDesktopIPCError(w, http.StatusNotImplemented, "unsupported_media_baidu_index_job", "update Agent for photo map tasks")
			return
		}
		result, err := ctrl.CloudCancelMediaBaiduIndexJob(r.Context(), nodeID, revision)
		if err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusOK, result)
	default:
		writeDesktopIPCError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	}
}
