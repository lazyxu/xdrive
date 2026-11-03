package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"strconv"

	"github.com/lazyxu/xdrive/internal/client"
)

// This optional capability is separate from the existing Desktop update
// interface so older, already-running Agents and test doubles remain valid.
// Only fixed semantic operations are exposed; no renderer-provided URL, host
// path, Docker command, or bearer token is accepted.
type desktopIPCOfflineUpdateController interface {
	CloudOfflineImportList(context.Context) (client.OfflineImportList, error)
	CloudOfflineImportCreate(context.Context) (client.OfflineImportCreated, error)
	CloudOfflineImportGet(context.Context, string) (client.OfflineImportStatus, error)
	CloudOfflineImportRegister(context.Context, string, string, int64, string) error
	CloudOfflineImportChunk(context.Context, string, string, uint32, []byte, string) error
	CloudOfflineImportFinalize(context.Context, string, string) (client.OfflineImportFinalized, error)
	CloudOfflineImportDelete(context.Context, string) error
	CloudStartOfflineServerUpdate(context.Context, string, string, string, bool) (client.ServerUpdateState, error)
}

func (h *desktopIPCHandler) offlineUpdateProvider(w http.ResponseWriter) (desktopIPCOfflineUpdateController, bool) {
	provider, ok := h.ctrl.(desktopIPCOfflineUpdateController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "offline_update_unavailable",
			"this Agent does not support server offline imports")
		return nil, false
	}
	return provider, true
}

func desktopOfflineTarget(w http.ResponseWriter, r *http.Request, withFile bool) (id, name string, ok bool) {
	id = r.PathValue("id")
	name = r.PathValue("name")
	if !client.ValidOfflineImportID(id) || (withFile && !client.ValidOfflineImportFile(name)) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_offline_target",
			"offline imports require a fixed ID and permitted release filename")
		return "", "", false
	}
	return id, name, true
}

func (h *desktopIPCHandler) offlineImportList(w http.ResponseWriter, r *http.Request) {
	provider, ok := h.offlineUpdateProvider(w)
	if !ok {
		return
	}
	items, err := provider.CloudOfflineImportList(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, items)
}

func (h *desktopIPCHandler) offlineImportCreate(w http.ResponseWriter, r *http.Request) {
	provider, ok := h.offlineUpdateProvider(w)
	if !ok {
		return
	}
	created, err := provider.CloudOfflineImportCreate(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusCreated, created)
}

func (h *desktopIPCHandler) offlineImportGet(w http.ResponseWriter, r *http.Request) {
	id, _, ok := desktopOfflineTarget(w, r, false)
	if !ok {
		return
	}
	provider, ok := h.offlineUpdateProvider(w)
	if !ok {
		return
	}
	status, err := provider.CloudOfflineImportGet(r.Context(), id)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, status)
}

func (h *desktopIPCHandler) offlineImportRegister(w http.ResponseWriter, r *http.Request) {
	id, name, ok := desktopOfflineTarget(w, r, true)
	if !ok {
		return
	}
	var input struct {
		Name   string `json:"name"`
		Size   int64  `json:"size"`
		SHA256 string `json:"sha256"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if input.Name != name || input.Size <= 0 || input.Size > 8<<30 ||
		(input.SHA256 != "" && !client.ValidOfflineImportSHA256(input.SHA256)) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_offline_file",
			"release filename, size or upload SHA-256 is invalid")
		return
	}
	provider, ok := h.offlineUpdateProvider(w)
	if !ok {
		return
	}
	if err := provider.CloudOfflineImportRegister(r.Context(), id, name, input.Size, input.SHA256); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *desktopIPCHandler) offlineImportChunk(w http.ResponseWriter, r *http.Request) {
	id, name, ok := desktopOfflineTarget(w, r, true)
	if !ok {
		return
	}
	index, err := strconv.ParseUint(r.PathValue("index"), 10, 32)
	if err != nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_offline_chunk_index", "invalid chunk index")
		return
	}
	claimedSHA := r.Header.Get("X-XDrive-Chunk-SHA256")
	if !client.ValidOfflineImportSHA256(claimedSHA) || r.ContentLength > client.OfflineImportChunkBytes {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_offline_chunk", "invalid chunk digest or length")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, client.OfflineImportChunkBytes+1)
	data, err := io.ReadAll(r.Body)
	if err != nil || len(data) == 0 || len(data) > client.OfflineImportChunkBytes {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_offline_chunk", "chunk exceeds byte limit")
		return
	}
	actual := sha256.Sum256(data)
	if hex.EncodeToString(actual[:]) != claimedSHA {
		writeDesktopIPCError(w, http.StatusUnprocessableEntity, "offline_chunk_digest_mismatch",
			"received chunk SHA-256 does not match")
		return
	}
	provider, ok := h.offlineUpdateProvider(w)
	if !ok {
		return
	}
	if err := provider.CloudOfflineImportChunk(r.Context(), id, name, uint32(index), data, claimedSHA); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *desktopIPCHandler) offlineImportFinalize(w http.ResponseWriter, r *http.Request) {
	id, name, ok := desktopOfflineTarget(w, r, true)
	if !ok {
		return
	}
	provider, ok := h.offlineUpdateProvider(w)
	if !ok {
		return
	}
	result, err := provider.CloudOfflineImportFinalize(r.Context(), id, name)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, result)
}

func (h *desktopIPCHandler) offlineImportDelete(w http.ResponseWriter, r *http.Request) {
	id, _, ok := desktopOfflineTarget(w, r, false)
	if !ok {
		return
	}
	provider, ok := h.offlineUpdateProvider(w)
	if !ok {
		return
	}
	if err := provider.CloudOfflineImportDelete(r.Context(), id); err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *desktopIPCHandler) offlineImportActivate(w http.ResponseWriter, r *http.Request) {
	id, _, ok := desktopOfflineTarget(w, r, false)
	if !ok {
		return
	}
	var input struct {
		ManifestSHA256 string `json:"trusted_manifest_sha256"`
		GoSHA256       string `json:"trusted_installer_sha256"`
		BackupFileData bool   `json:"backup_file_data"`
	}
	if !decodeDesktopIPCJSON(w, r, &input) {
		return
	}
	if !client.ValidOfflineImportSHA256(input.ManifestSHA256) ||
		!client.ValidOfflineImportSHA256(input.GoSHA256) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_offline_trust",
			"two independently trusted SHA-256 digests are required")
		return
	}
	provider, ok := h.offlineUpdateProvider(w)
	if !ok {
		return
	}
	result, err := provider.CloudStartOfflineServerUpdate(r.Context(), id,
		input.ManifestSHA256, input.GoSHA256, input.BackupFileData)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusAccepted, result)
}
