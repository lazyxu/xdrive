package main

import (
	"context"
	"net/http"

	"github.com/lazyxu/xdrive/internal/client"
)

// An authenticated loopback Agent route, never a renderer network bypass.
// Older controllers safely return unsupported instead of silently sharing GPS.
func (h *desktopIPCHandler) mediaBaiduConsent(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	nodeID, ok := desktopIPCUint64Query(w, r, "node_id")
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		ctrl, ok := h.ctrl.(interface {
			CloudMediaBaiduConsent(context.Context, uint64) (client.MediaBaiduMapConsent, error)
		})
		if !ok {
			writeDesktopIPCError(w, http.StatusNotImplemented, "unsupported_media_baidu_consent", "update Agent for location privacy")
			return
		}
		result, err := ctrl.CloudMediaBaiduConsent(r.Context(), nodeID)
		if err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusOK, result)
	case http.MethodPut:
		var input client.MediaBaiduMapConsentInput
		if !decodeDesktopIPCJSON(w, r, &input) {
			return
		}
		if input.ExpectedRevision == ^uint64(0) ||
			input.ExpiresInSeconds < 600 || input.ExpiresInSeconds > 30*24*60*60 ||
			!input.ConsentToBaidu || !input.ConsentToDerivedIndex {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_baidu_consent", "explicit bounded consent required")
			return
		}
		ctrl, ok := h.ctrl.(interface {
			CloudSaveMediaBaiduConsent(context.Context, uint64, client.MediaBaiduMapConsentInput) (client.MediaBaiduMapConsent, error)
		})
		if !ok {
			writeDesktopIPCError(w, http.StatusNotImplemented, "unsupported_media_baidu_consent", "update Agent for location privacy")
			return
		}
		result, err := ctrl.CloudSaveMediaBaiduConsent(r.Context(), nodeID, input)
		if err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusOK, result)
	case http.MethodDelete:
		revision, ok := desktopIPCUint64Query(w, r, "revision")
		if !ok {
			return
		}
		ctrl, ok := h.ctrl.(interface {
			CloudRevokeMediaBaiduConsent(context.Context, uint64, uint64) (client.MediaBaiduMapConsent, error)
		})
		if !ok {
			writeDesktopIPCError(w, http.StatusNotImplemented, "unsupported_media_baidu_consent", "update Agent for location privacy")
			return
		}
		result, err := ctrl.CloudRevokeMediaBaiduConsent(r.Context(), nodeID, revision)
		if err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusOK, result)
	default:
		writeDesktopIPCError(w, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
	}
}
