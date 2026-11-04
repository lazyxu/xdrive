package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/url"
	"strings"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
)

// Images are a deliberately separate optional capability. Backup-only Notes
// keeps its existing text/history routes but must not inherit a new binary
// write operation or become a general Server/file proxy.
type desktopIPCNotesImagePort interface {
	CloudNotesUploadImage(context.Context, string, []byte) (client.NotesImageReceipt, error)
	CloudNotesImportIOSImage(context.Context, string, []byte) (client.NotesImageReceipt, error)
	CloudNotesReadImage(context.Context, string, string) ([]byte, error)
}

func validDesktopNotesImageID(id string) bool {
	parsed, err := uuid.Parse(id)
	return err == nil && parsed.String() == id
}

func (h *desktopIPCHandler) notesImagePort(w http.ResponseWriter) (desktopIPCNotesImagePort, bool) {
	// Backup-only is permitted only through restrictBackupOnlyEndpoints'
	// exact method + canonical Note UUID /images gate. desktopIPCAuth still
	// requires same-user loopback bearer before reaching this handler.
	if _, ok := h.ctrl.(desktopIPCNotesPort); !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "notes_unavailable",
			"Owner Notes transport is unavailable")
		return nil, false
	}
	port, ok := h.ctrl.(desktopIPCNotesImagePort)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "notes_images_unavailable",
			"Owner Notes image transport is unavailable")
		return nil, false
	}
	return port, true
}

// POST body is bounded JSON with ONE base64-encoded image field. Go's json
// decoder bounds decoded bytes; unknown fields are rejected by the shared IPC
// decoder. This transport neither accepts a Server URL nor a filesystem path.
// The upload goes to the existing Owner-only Notes/mine API at most once.
func (h *desktopIPCHandler) cloudNotesUploadImage(w http.ResponseWriter, r *http.Request) {
	port, ok := h.notesImagePort(w)
	if !ok {
		return
	}
	id := r.PathValue("id")
	if !validDesktopNotesImageID(id) || r.URL.RawQuery != "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_notes_image",
			"invalid Note identity or query")
		return
	}
	var payload struct {
		Image []byte
	}
	// 20 MiB encoded as base64 + a short JSON envelope.
	const maxPayload = client.NotesMaxImageBytes*4/3 + 8192
	if !decodeDesktopIPCJSONLimit(w, r, &payload, maxPayload) {
		return
	}
	if len(payload.Image) == 0 || len(payload.Image) > client.NotesMaxImageBytes {
		writeDesktopIPCError(w, http.StatusRequestEntityTooLarge, "invalid_notes_image",
			"Notes image must be nonempty and at most 20 MiB")
		return
	}
	receipt, err := port.CloudNotesUploadImage(r.Context(), id, payload.Image)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	name, mime, valid := client.NotesImageFilename(id, receipt.RelativePath)
	hash := sha256.Sum256(payload.Image)
	if !valid || receipt.NodeID == 0 || receipt.Filename != name ||
		receipt.ContentType != mime || receipt.Bytes != int64(len(payload.Image)) ||
		!strings.EqualFold(receipt.SHA256, hex.EncodeToString(hash[:])) {
		writeDesktopIPCError(w, http.StatusBadGateway, "notes_image_receipt_invalid",
			"Owner Notes image receipt mismatch; check the Note before retry")
		return
	}
	writeDesktopIPCJSON(w, http.StatusCreated, receipt)
}

// POST imports one selected immutable image into the read-only iOS archive.
// It is separate from the editable Mine-image route and never accepts a path.
func (h *desktopIPCHandler) cloudNotesImportIOSImage(w http.ResponseWriter, r *http.Request) {
	port, ok := h.notesImagePort(w)
	if !ok {
		return
	}
	id := r.PathValue("id")
	if !validDesktopNotesImageID(id) || r.URL.RawQuery != "" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_notes_image",
			"invalid Note identity or query")
		return
	}
	var payload struct {
		Image []byte
	}
	const maxPayload = client.NotesMaxImageBytes*4/3 + 8192
	if !decodeDesktopIPCJSONLimit(w, r, &payload, maxPayload) {
		return
	}
	if len(payload.Image) == 0 || len(payload.Image) > client.NotesMaxImageBytes {
		writeDesktopIPCError(w, http.StatusRequestEntityTooLarge, "invalid_notes_image",
			"iOS Notes image must be nonempty and at most 20 MiB")
		return
	}
	receipt, err := port.CloudNotesImportIOSImage(r.Context(), id, payload.Image)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	name, mime, valid := client.NotesImageFilename(id, receipt.RelativePath)
	hash := sha256.Sum256(payload.Image)
	if !valid || receipt.NodeID == 0 || receipt.Filename != name ||
		receipt.ContentType != mime || receipt.Bytes != int64(len(payload.Image)) ||
		!strings.EqualFold(receipt.SHA256, hex.EncodeToString(hash[:])) {
		writeDesktopIPCError(w, http.StatusBadGateway, "notes_image_receipt_invalid",
			"Owner iOS Notes image receipt mismatch; check the backup before retry")
		return
	}
	writeDesktopIPCJSON(w, http.StatusCreated, receipt)
}

// GET only accepts an immutable _assets/<note-uuid>/<image-uuid>.ext selector.
// The Go Client verifies the returned image MIME and SHA-256 ETag before any
// content can reach the Electron caller. The IPC response uses JSON bytes
// (base64 in transit) so no arbitrary URL or bearer enters the renderer.
func (h *desktopIPCHandler) cloudNotesReadImage(w http.ResponseWriter, r *http.Request) {
	port, ok := h.notesImagePort(w)
	if !ok {
		return
	}
	id := r.PathValue("id")
	if !validDesktopNotesImageID(id) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_notes_image",
			"invalid Note identity")
		return
	}
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(q) != 1 || len(q["relative_path"]) != 1 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_notes_image",
			"invalid Note image selector")
		return
	}
	relative := q.Get("relative_path")
	_, mime, valid := client.NotesImageFilename(id, relative)
	if !valid {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_notes_image",
			"unsafe or cross-Note image path")
		return
	}
	data, err := port.CloudNotesReadImage(r.Context(), id, relative)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	if len(data) == 0 || len(data) > client.NotesMaxImageBytes {
		writeDesktopIPCError(w, http.StatusBadGateway, "notes_image_invalid",
			"Owner Notes image exceeds the bounded transport")
		return
	}
	hash := sha256.Sum256(data)
	writeDesktopIPCJSON(w, http.StatusOK, map[string]any{
		"content_type": mime,
		"bytes":        len(data),
		"sha256":       hex.EncodeToString(hash[:]),
		"image":        data,
	})
}
