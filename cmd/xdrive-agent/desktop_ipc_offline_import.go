package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/lazyxu/xdrive/internal/client"
)

const desktopOfflineChunkLimit = 8 << 20

var (
	desktopOfflineIDPattern      = regexp.MustCompile("^[a-f0-9]{32}$")
	desktopOfflineDigestPattern  = regexp.MustCompile("^[a-f0-9]{64}$")
	desktopOfflinePackagePattern = regexp.MustCompile("^xdrive-(app|postgres|media-worker|ai-runtime|ai-models)-[a-f0-9]{12}\\.tar\\.gz$")
)

type desktopOfflineImportController interface {
	CloudOfflineImports(context.Context) (client.OfflineImportList, error)
	CloudOfflineImportCreate(context.Context) (client.OfflineImportCreated, error)
	CloudOfflineImportGet(context.Context, string) (client.OfflineImportStatus, error)
	CloudOfflineImportRegister(context.Context, string, string, int64, string) error
	CloudOfflineImportChunk(context.Context, string, string, int, []byte, string) error
	CloudOfflineImportFinalize(context.Context, string, string) (client.OfflineImportFinalizeReceipt, error)
	CloudOfflineImportDelete(context.Context, string) error
	CloudOfflineImportStart(context.Context, string, string, string, bool) (client.ServerUpdateState, error)
}

func validDesktopOfflineName(name string) bool {
	switch name {
	case "manifest.json", "delivery.json", "delivery-attestation.jsonl", "xdrive-offline-linux-amd64":
		return true
	default:
		return desktopOfflinePackagePattern.MatchString(name)
	}
}

// Strict path and digest validation belongs at every boundary: Electron Main,
// Agent IPC, authenticated Go Client, Server requireAdmin, and Host Control.
func (h *desktopIPCHandler) offlineImport(w http.ResponseWriter, r *http.Request) {
	provider, ok := h.ctrl.(desktopOfflineImportController)
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "offline_import_unavailable", "offline import requires a newer Go Agent")
		return
	}
	id, name := r.PathValue("id"), r.PathValue("name")
	if id != "" && !desktopOfflineIDPattern.MatchString(id) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_offline_id", "invalid offline import reference")
		return
	}
	if name != "" && !validDesktopOfflineName(name) {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_offline_name", "invalid offline archive filename")
		return
	}
	ctx := r.Context()
	switch {
	case r.Method == "GET" && id == "":
		out, err := provider.CloudOfflineImports(ctx)
		if err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusOK, out)
	case r.Method == "POST" && id == "":
		out, err := provider.CloudOfflineImportCreate(ctx)
		if err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusCreated, out)
	case r.Method == "GET" && id != "" && name == "":
		out, err := provider.CloudOfflineImportGet(ctx, id)
		if err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusOK, out)
	case r.Method == "DELETE" && id != "" && name == "":
		if err := provider.CloudOfflineImportDelete(ctx, id); err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusNoContent)
	case r.Method == "POST" && id != "" && name != "" && r.PathValue("index") == "" && !strings.HasSuffix(r.URL.Path, "/finalize"):
		var input struct {
			Name   string `json:"name"`
			Size   int64  `json:"size"`
			SHA256 string `json:"sha256"`
		}
		if !decodeDesktopIPCJSON(w, r, &input) {
			return
		}
		if input.Name != name || input.Size <= 0 ||
			(input.SHA256 != "" && !desktopOfflineDigestPattern.MatchString(input.SHA256)) {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_offline_metadata", "offline file identity mismatch")
			return
		}
		if err := provider.CloudOfflineImportRegister(ctx, id, name, input.Size, input.SHA256); err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusOK, map[string]any{"accepted": true})
	case r.Method == "PUT" && id != "" && name != "" && r.PathValue("index") != "":
		index, err := strconv.ParseUint(r.PathValue("index"), 10, 32)
		if err != nil || index > 1<<20 {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_offline_chunk_index", "invalid chunk index")
			return
		}
		sha := strings.TrimSpace(r.Header.Get("X-XDrive-Chunk-SHA256"))
		if !desktopOfflineDigestPattern.MatchString(sha) {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_offline_chunk_sha", "missing valid chunk digest")
			return
		}
		raw, err := io.ReadAll(io.LimitReader(r.Body, desktopOfflineChunkLimit+1))
		if err != nil || len(raw) == 0 || len(raw) > desktopOfflineChunkLimit {
			writeDesktopIPCError(w, http.StatusRequestEntityTooLarge, "invalid_offline_chunk", "offline chunk exceeds limit")
			return
		}
		got := sha256.Sum256(raw)
		if hex.EncodeToString(got[:]) != sha {
			writeDesktopIPCError(w, http.StatusUnprocessableEntity, "invalid_offline_chunk_sha", "offline chunk digest mismatch")
			return
		}
		if err := provider.CloudOfflineImportChunk(ctx, id, name, int(index), raw, sha); err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusOK, map[string]any{"accepted": true})
	case r.Method == "POST" && id != "" && name != "" && strings.HasSuffix(r.URL.Path, "/finalize"):
		out, err := provider.CloudOfflineImportFinalize(ctx, id, name)
		if err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusOK, out)
	case r.Method == "POST" && id != "" && name == "" && strings.HasSuffix(r.URL.Path, "/start"):
		var input struct {
			TrustedManifest string `json:"trusted_manifest_sha256"`
			TrustedGo       string `json:"trusted_installer_sha256"`
			BackupFileData  bool   `json:"backup_file_data"`
		}
		if !decodeDesktopIPCJSON(w, r, &input) {
			return
		}
		if !desktopOfflineDigestPattern.MatchString(input.TrustedManifest) ||
			!desktopOfflineDigestPattern.MatchString(input.TrustedGo) {
			writeDesktopIPCError(w, http.StatusBadRequest, "invalid_offline_trust", "offline publisher SHA-256 is required")
			return
		}
		out, err := provider.CloudOfflineImportStart(ctx, id, input.TrustedManifest, input.TrustedGo, input.BackupFileData)
		if err != nil {
			writeDesktopIPCControllerError(w, err)
			return
		}
		writeDesktopIPCJSON(w, http.StatusAccepted, out)
	default:
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_offline_request", "unsupported offline import action")
	}
}
