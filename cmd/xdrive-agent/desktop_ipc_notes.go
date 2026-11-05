package main

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/lazyxu/xdrive/internal/client"
)

// This interface is intentionally optional. Older Agents and backup-only
// hosts never gain a fake Notes capability. Every method delegates to the
// same Owner-proven cloud client used by Desktop Files.
type desktopIPCNotesPort interface {
	CloudNotesInitialize(context.Context) (client.NotesNamespace, error)
	CloudNotesList(context.Context, string, string, int) (client.NotesPage, error)
	CloudNotesRead(context.Context, string) (client.NotesDetail, error)
	CloudNotesCreate(context.Context, client.NotesWrite) (client.NotesRow, error)
	CloudNotesUpdate(context.Context, string, client.NotesWrite) (client.NotesRow, error)
	CloudNotesDelete(context.Context, string, uint64) error
	CloudNotesVersions(context.Context, string) (client.NotesVersions, error)
	CloudNotesReadVersion(context.Context, uint64, uint64) (string, error)
}

type desktopIPCNotesImportPort interface {
	CloudNotesImportIOS(context.Context, client.NotesImportWrite) (client.NotesRow, error)
}

func (h *desktopIPCHandler) notesImportPort(w http.ResponseWriter) (desktopIPCNotesImportPort, bool) {
	port, ok := h.ctrl.(desktopIPCNotesImportPort)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "notes_import_unavailable",
			"Owner iOS Notes import transport is unavailable")
		return nil, false
	}
	return port, true
}

func (h *desktopIPCHandler) notesPort(w http.ResponseWriter) (desktopIPCNotesPort, bool) {
	// Backup-only Notes are admitted only by the exact route allowlist in
	// restrictBackupOnlyEndpoints. The loopback bearer and current Owner
	// cloudClient() still authorize every request; no arbitrary proxy exists.
	port, ok := h.ctrl.(desktopIPCNotesPort)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "notes_unavailable", "Owner Notes transport is unavailable")
		return nil, false
	}
	return port, true
}

func (h *desktopIPCHandler) cloudNotesNamespace(w http.ResponseWriter, r *http.Request) {
	port, ok := h.notesPort(w)
	if !ok {
		return
	}
	value, err := port.CloudNotesInitialize(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, value)
}

func (h *desktopIPCHandler) cloudNotesList(w http.ResponseWriter, r *http.Request) {
	port, ok := h.notesPort(w)
	if !ok {
		return
	}
	source := r.URL.Query().Get("source")
	if source != "mine" && source != "ios_notes" {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_notes_source", "invalid Notes source")
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	offset := 0
	if raw := r.URL.Query().Get("offset"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_notes_offset", "invalid Notes offset")
			return
		}
		offset = parsed
	}
	if offset < 0 || offset > 10000000 || offset%client.NotesMaxPageSize != 0 ||
		len([]byte(query)) > 200 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_notes_query", "invalid Notes query or range")
		return
	}
	value, err := port.CloudNotesList(r.Context(), source, query, offset)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, value)
}

func (h *desktopIPCHandler) cloudNotesRead(w http.ResponseWriter, r *http.Request) {
	port, ok := h.notesPort(w)
	if !ok {
		return
	}
	value, err := port.CloudNotesRead(r.Context(), r.PathValue("id"))
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, value)
}

func (h *desktopIPCHandler) cloudNotesImportIOS(w http.ResponseWriter, r *http.Request) {
	port, ok := h.notesImportPort(w)
	if !ok {
		return
	}
	var input client.NotesImportWrite
	if !decodeDesktopIPCJSONLimit(w, r, &input, 6*client.NotesMaxMarkdownBytes+8192) {
		return
	}
	// Validate before invoking an optional controller implementation. The
	// IPC boundary must reject native Apple IDs and malformed manual transaction
	// keys even when a test fixture or alternate port does not use client.Client.
	if err := client.ValidateNotesImportWrite(input); err != nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_notes_import", "invalid iOS Notes import")
		return
	}
	value, err := port.CloudNotesImportIOS(r.Context(), input)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusCreated, value)
}

func (h *desktopIPCHandler) cloudNotesCreate(w http.ResponseWriter, r *http.Request) {
	port, ok := h.notesPort(w)
	if !ok {
		return
	}
	var input client.NotesWrite
	if !decodeDesktopIPCJSONLimit(w, r, &input, 6*client.NotesMaxMarkdownBytes+8192) {
		return
	}
	input.ExpectedRevision = 0
	value, err := port.CloudNotesCreate(r.Context(), input)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusCreated, value)
}

func (h *desktopIPCHandler) cloudNotesUpdate(w http.ResponseWriter, r *http.Request) {
	port, ok := h.notesPort(w)
	if !ok {
		return
	}
	var input client.NotesWrite
	if !decodeDesktopIPCJSONLimit(w, r, &input, 6*client.NotesMaxMarkdownBytes+8192) {
		return
	}
	if input.ExpectedRevision == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_notes_revision", "expected_revision is required")
		return
	}
	value, err := port.CloudNotesUpdate(r.Context(), r.PathValue("id"), input)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, value)
}

func (h *desktopIPCHandler) cloudNotesDelete(w http.ResponseWriter, r *http.Request) {
	port, ok := h.notesPort(w)
	if !ok {
		return
	}
	raw := strings.TrimSpace(r.URL.Query().Get("revision"))
	revision, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || revision == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_notes_revision", "revision is required")
		return
	}
	if err := port.CloudNotesDelete(r.Context(), r.PathValue("id"), revision); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *desktopIPCHandler) cloudNotesVersions(w http.ResponseWriter, r *http.Request) {
	port, ok := h.notesPort(w)
	if !ok {
		return
	}
	value, err := port.CloudNotesVersions(r.Context(), r.PathValue("id"))
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, value)
}

func (h *desktopIPCHandler) cloudNotesVersionContent(w http.ResponseWriter, r *http.Request) {
	port, ok := h.notesPort(w)
	if !ok {
		return
	}
	q := r.URL.Query()
	nodeID, nodeErr := strconv.ParseUint(q.Get("node_id"), 10, 64)
	versionID, versionErr := strconv.ParseUint(q.Get("version_id"), 10, 64)
	if nodeErr != nil || versionErr != nil || nodeID == 0 || versionID == 0 {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_notes_version", "invalid Notes version request")
		return
	}
	content, err := port.CloudNotesReadVersion(r.Context(), nodeID, versionID)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]string{"markdown": content})
}
