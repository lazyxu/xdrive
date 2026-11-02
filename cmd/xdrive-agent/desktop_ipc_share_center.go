package main

import (
    "context"
    "net/http"
    "strconv"
    "strings"

    "github.com/lazyxu/xdrive/internal/client"
)

// Optional Agent surface: existing desktopIPCController test mocks stay intact.
type desktopIPCShareCenterController interface {
    CloudOwnShares(context.Context, uint64, int) (client.OwnerSharePage, error)
    CloudOwnShareLink(context.Context, uint64) (agentOwnerShareLink, error)
}

func (h *desktopIPCHandler) cloudOwnerShares(w http.ResponseWriter, r *http.Request) {
    controller, ok := h.ctrl.(desktopIPCShareCenterController)
    if !ok {
        writeDesktopIPCError(w, http.StatusNotImplemented, "share_center_unavailable", "Share center is unavailable")
        return
    }
    cursor := uint64(0)
    if raw := strings.TrimSpace(r.URL.Query().Get("cursor")); raw != "" {
        value, err := strconv.ParseUint(raw, 10, 64)
        if err != nil || value == 0 {
            writeDesktopIPCError(w, http.StatusBadRequest, "invalid_share_cursor", "Invalid Share cursor")
            return
        }
        cursor = value
    }
    limit := 50
    if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
        value, err := strconv.Atoi(raw)
        if err != nil || value < 1 || value > 100 {
            writeDesktopIPCError(w, http.StatusBadRequest, "invalid_share_limit", "Invalid Share page limit")
            return
        }
        limit = value
    }
    page, err := controller.CloudOwnShares(r.Context(), cursor, limit)
    if err != nil { writeDesktopIPCControllerError(w, err); return }
    w.Header().Set("Cache-Control", "private, no-store")
    writeDesktopIPCJSON(w, http.StatusOK, page)
}

func (h *desktopIPCHandler) cloudOwnShareLink(w http.ResponseWriter, r *http.Request) {
    controller, ok := h.ctrl.(desktopIPCShareCenterController)
    if !ok {
        writeDesktopIPCError(w, http.StatusNotImplemented, "share_center_unavailable", "Share center is unavailable")
        return
    }
    var input struct { ID uint64 `json:"id"` }
    if !decodeDesktopIPCJSON(w, r, &input) { return }
    if input.ID == 0 {
        writeDesktopIPCError(w, http.StatusBadRequest, "invalid_share", "Share id is required")
        return
    }
    link, err := controller.CloudOwnShareLink(r.Context(), input.ID)
    if err != nil { writeDesktopIPCControllerError(w, err); return }
    w.Header().Set("Cache-Control", "private, no-store")
    w.Header().Set("Referrer-Policy", "no-referrer")
    writeDesktopIPCJSON(w, http.StatusOK, link)
}
