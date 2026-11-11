package main

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
)

// Explicit six-operation loopback allowlist, never a generic Owner HTTP proxy.
type desktopIPCClipboardPort interface {
	CloudClipboardList(context.Context, uint64) (client.ClipboardPage, error)
	CloudClipboardCreate(context.Context, client.ClipboardWrite) (client.ClipboardItem, error)
	CloudClipboardDelete(context.Context, uint64) error
	CloudClipboardClear(context.Context) error
}

func (h *desktopIPCHandler) clipboardPort(w http.ResponseWriter) (desktopIPCClipboardPort, bool) {
	port, ok := h.ctrl.(desktopIPCClipboardPort)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "clipboard_unavailable", "Owner Clipboard is unavailable")
	}
	return port, ok
}
func (h *desktopIPCHandler) cloudClipboardList(w http.ResponseWriter, r *http.Request) {
	port, ok := h.clipboardPort(w)
	if !ok {
		return
	}
	before := uint64(0)
	if raw := r.URL.Query().Get("before"); raw != "" {
		parsed, err := strconv.ParseUint(raw, 10, 64)
		if err != nil || parsed == 0 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_clipboard_cursor", "invalid clipboard cursor")
			return
		}
		before = parsed
	}
	value, err := port.CloudClipboardList(r.Context(), before)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, value)
}

// Recipient directory requires the same signed-in Owner capability.
func (h *desktopIPCHandler) cloudClipboardDevices(w http.ResponseWriter, r *http.Request) {
	// Recipient directory cannot grant a generic Owner proxy.
	if _, ok := h.clipboardPort(w); !ok {
		return
	}
	lister, ok := h.ctrl.(interface {
		CloudClipboardDevices(context.Context) (client.ClipboardDevices, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "clipboard_devices_unavailable", "Clipboard recipient directory unavailable")
		return
	}
	value, err := lister.CloudClipboardDevices(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, value)
}
func (h *desktopIPCHandler) cloudClipboardCreate(w http.ResponseWriter, r *http.Request) {
	port, ok := h.clipboardPort(w)
	if !ok {
		return
	}
	var input client.ClipboardWrite
	if !decodeDesktopIPCJSONLimit(w, r, &input, 128<<10) {
		return
	}
	value, err := port.CloudClipboardCreate(r.Context(), input)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusCreated, value)
}
func (h *desktopIPCHandler) cloudClipboardDelete(w http.ResponseWriter, r *http.Request) {
	port, ok := h.clipboardPort(w)
	if !ok {
		return
	}
	raw := strings.TrimSpace(r.PathValue("id"))
	id, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || id == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_clipboard_id", "invalid clipboard item")
		return
	}
	if err := port.CloudClipboardDelete(r.Context(), id); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (h *desktopIPCHandler) cloudClipboardClear(w http.ResponseWriter, r *http.Request) {
	port, ok := h.clipboardPort(w)
	if !ok {
		return
	}
	if err := port.CloudClipboardClear(r.Context()); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Recipient enrollment verifies the registered Owner installation.
func (h *desktopIPCHandler) cloudClipboardEnableDevice(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.clipboardPort(w); !ok {
		return
	}
	provider, ok := h.ctrl.(interface {
		CloudClipboardEnableDevice(context.Context) (client.ClipboardDevice, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "clipboard_device_unavailable", "Device enrollment unsupported")
		return
	}
	value, err := provider.CloudClipboardEnableDevice(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, value)
}

// Only the exact UUID in a bounded JSON body may be revoked. The current
// interactive Owner decides; the OS installation token has no revoke grant.
func (h *desktopIPCHandler) cloudClipboardRevokeDevice(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.clipboardPort(w); !ok {
		return
	}
	provider, ok := h.ctrl.(interface {
		CloudClipboardRevokeDevice(context.Context, string) error
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "clipboard_revoke_unavailable", "Clipboard recipient revocation unsupported")
		return
	}
	var input struct {
		DeviceID string `json:"device_id"`
	}
	if !decodeDesktopIPCJSONLimit(w, r, &input, 1024) {
		return
	}
	id, err := uuid.Parse(input.DeviceID)
	if err != nil || id.String() != input.DeviceID {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_clipboard_device", "Invalid recipient identity")
		return
	}
	if err := provider.CloudClipboardRevokeDevice(r.Context(), input.DeviceID); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Cloud Clipboard events are Owner-authenticated Server SSE converted into
// one bounded change cursor. Never relay the Server bearer or message bytes.
func (h *desktopIPCHandler) cloudClipboardNextEvent(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.clipboardPort(w); !ok {
		return
	}
	notifier, ok := h.ctrl.(interface {
		CloudClipboardWaitForChange(context.Context, uint64) (client.ClipboardChangeEvent, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "clipboard_events_unavailable", "Clipboard event stream unavailable")
		return
	}
	query := r.URL.Query()
	if len(query) != 1 || len(query["after"]) != 1 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_clipboard_cursor", "invalid Clipboard event selector")
		return
	}
	raw := query.Get("after")
	cursor, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || cursor > 1<<53-1 || strconv.FormatUint(cursor, 10) != raw {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_clipboard_cursor", "invalid Clipboard event cursor")
		return
	}
	event, err := notifier.CloudClipboardWaitForChange(r.Context(), cursor)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, event)
}
