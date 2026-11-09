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
	CloudClipboardVault(context.Context) (client.ClipboardVault, error)
	CloudClipboardCheck(context.Context, client.ClipboardCheck) (client.ClipboardVault, error)
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
func (h *desktopIPCHandler) cloudClipboardVault(w http.ResponseWriter, r *http.Request) {
	port, ok := h.clipboardPort(w)
	if !ok {
		return
	}
	value, err := port.CloudClipboardVault(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, value)
}
func (h *desktopIPCHandler) cloudClipboardCheck(w http.ResponseWriter, r *http.Request) {
	port, ok := h.clipboardPort(w)
	if !ok {
		return
	}
	var input client.ClipboardCheck
	if !decodeDesktopIPCJSONLimit(w, r, &input, 1024) {
		return
	}
	value, err := port.CloudClipboardCheck(r.Context(), input)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, value)
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

// The recipient directory exposes only public X25519 keys and requires the
// same signed-in interactive Owner capability as the existing text mailbox.
func (h *desktopIPCHandler) cloudClipboardDevices(w http.ResponseWriter, r *http.Request) {
	// Preserve existing six-operation Agents: this new public-key capability
	// is optional and never grants a previous Agent a generic Owner proxy.
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

// Optional, explicit user-consent enrollment. The Agent looks up the CURRENT
// registered installation credential and stores X25519 private bytes only in
// its OS credential store. Nothing sensitive enters Electron renderer.
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

// An untrusted renderer can only request a single integer item ID. The
// Agent fetches the current scoped encrypted row and validates Owner/device
// proof BEFORE decrypting; no arbitrary ciphertext/private key is accepted.
func (h *desktopIPCHandler) cloudClipboardDecrypt(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.clipboardPort(w); !ok {
		return
	}
	provider, ok := h.ctrl.(interface {
		CloudClipboardDecrypt(context.Context, uint64) (string, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "clipboard_decrypt_unavailable", "Recipient decryption unsupported")
		return
	}
	var input struct {
		ID uint64 `json:"id"`
	}
	if !decodeDesktopIPCJSONLimit(w, r, &input, 1024) {
		return
	}
	if input.ID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_clipboard_id", "invalid Clipboard message ID")
		return
	}
	clear, err := provider.CloudClipboardDecrypt(r.Context(), input.ID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeDesktopIPCJSON(w, http.StatusOK, map[string]string{"text": clear})
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
