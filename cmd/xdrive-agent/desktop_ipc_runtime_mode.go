package main

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

const (
	agentRuntimeFull       = "full"
	agentRuntimeBackupOnly = "backup_only"
)

func desktopIPCRuntimeMode(backupOnly bool) string {
	if backupOnly {
		return agentRuntimeBackupOnly
	}
	return agentRuntimeFull
}

// Backup-only starts the original owning Push worker, not the FUSE/CfAPI mount
// reconciliation or the full client updater. Advertise only common, proven
// Agent operations and owning-device Backup APIs; never advertise mount/update.
func desktopIPCCapabilitiesForRuntime(backupOnly bool) []string {
	capabilities := desktopIPCHelloCapabilities()
	if !backupOnly {
		return capabilities
	}
	allowed := make([]string, 0, 32)
	for _, capability := range capabilities {
		switch {
		case capability == "status", capability == "status-events",
			capability == "auth",
			capability == "device-backup-read",
			capability == "cloud-quota-read",
			capability == "cloud-files-read",
			capability == "cloud-owner-search-read",
			capability == "cloud-folder-create",
			capability == "cloud-owner-small-upload",
			capability == "cloud-node-rename",
			capability == "cloud-node-delete",
			capability == "cloud-node-move",
			capability == "cloud-node-copy",
			capability == "cloud-file-text-preview",
			capability == "cloud-media-range-read",
			capability == "cloud-thumbnail-read",
			capability == "cloud-owner-gallery-read",
			capability == "cloud-owner-places-read",
			capability == "cloud-owner-live-motion-read",
			capability == "device-backup-local-device",
			capability == "local-folder-root-grants",
			strings.HasPrefix(capability, "device-backup-local-"):
			allowed = append(allowed, capability)
		}
	}
	return allowed
}

// Capability filtering is not security enforcement: authenticated IPC must
// reject routes not needed by the owning Backup-only worker and CLI, before
// invoking their controllers. Unrecognized routes fail closed.
func restrictBackupOnlyEndpoints(backupOnly bool, next http.Handler) http.Handler {
	if !backupOnly {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if fullAgentOnlyRequest(r.Method, r.URL.Path) {
			writeDesktopIPCError(w, http.StatusConflict, "agent_backup_only",
				"full Agent operation unavailable in Backup-only mode; the owning backup continues")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// This list intentionally mirrors the existing owned-Device backup routes.
// A new endpoint, including a new local-* route, must be explicitly reviewed
// instead of inheriting backup-only access from a path prefix.
var backupOnlyAllowedIPCRoutes = map[string]struct{}{
	"DELETE /v1/device-backups/local-bound":                     {},
	"GET /v1/cloud/quota":                                       {},
	"GET /v1/cloud/root":                                        {},
	"GET /v1/cloud/owner-search":                                {},
	"GET /v1/cloud/children":                                    {},
	"POST /v1/cloud/directories":                                {},
	"POST /v1/cloud/owner-small-upload":                         {},
	"PATCH /v1/cloud/nodes":                                     {},
	"DELETE /v1/cloud/nodes":                                    {},
	"PATCH /v1/cloud/move":                                      {},
	"POST /v1/cloud/copy":                                       {},
	"GET /v1/cloud/text-preview":                                {},
	"GET /v1/cloud/media-range":                                 {},
	"GET /v1/cloud/thumbnail":                                   {},
	"GET /v1/cloud/owner-gallery-items":                         {},
	"GET /v1/cloud/owner-gallery-albums":                        {},
	"GET /v1/cloud/owner-places-page":                           {},
	"GET /v1/cloud/owner-map-overview":                          {},
	"GET /v1/cloud/owner-place-items":                           {},
	"GET /v1/cloud/owner-live-motion":                           {},
	"GET /v1/device-backups":                                    {},
	"GET /v1/device-backups/folders":                            {},
	"GET /v1/device-backups/local-common-batch":                 {},
	"GET /v1/device-backups/local-common-batch/history":         {},
	"GET /v1/device-backups/local-common-batch/recovery-review": {},
	"GET /v1/device-backups/local-delta":                        {},
	"GET /v1/device-backups/local-device":                       {},
	"GET /v1/device-backups/local-drafts":                       {},
	"GET /v1/device-backups/local-evidence-preflight":           {},
	"GET /v1/device-backups/local-evidence-summary":             {},
	"GET /v1/device-backups/local-first-file-status":            {},
	"GET /v1/device-backups/local-preview":                      {},
	"GET /v1/device-backups/local-rules":                        {},
	"GET /v1/device-backups/local-schedule":                     {},
	"GET /v1/device-backups/local-source":                       {},
	"GET /v1/device-backups/runs":                               {},
	"GET /v1/events":                                            {},
	"GET /v1/hello":                                             {},
	"GET /v1/sources":                                           {},
	"GET /v1/status":                                            {},
	"PATCH /v1/device-backups/local-mode":                       {},
	"PATCH /v1/device-backups/local-rules":                      {},
	"PATCH /v1/device-backups/local-schedule":                   {},
	"PATCH /v1/device-backups/local-source":                     {},
	"PATCH /v1/device-backups/local-target":                     {},
	"POST /v1/auth/change-password":                             {},
	"POST /v1/auth/login":                                       {},
	"POST /v1/auth/logout":                                      {},
	"POST /v1/device-backups/local-cli-preflight":               {},
	"POST /v1/device-backups/local-common-batch":                {},
	"POST /v1/device-backups/local-common-batch/control":        {},
	"POST /v1/device-backups/local-evidence":                    {},
	"POST /v1/device-backups/local-first-file":                  {},
	"POST /v1/device-backups/local-snapshot":                    {},
	"POST /v1/local-folder/authorize":                           {},
	"POST /v1/sources":                                          {},
}

// This is deliberately a narrow Notes-only exception. Backup-only must not
// gain full Desktop Cloud API access just because a URI has a cloud prefix.
// Every admitted route still requires the loopback bearer and Server Owner.
func backupOnlyAllowedNotesRequest(method, path string) bool {
	switch path {
	case "/v1/cloud/notes/namespace", "/v1/cloud/notes/import-ios":
		return method == http.MethodPost
	case "/v1/cloud/notes":
		return method == http.MethodGet || method == http.MethodPost
	case "/v1/cloud/notes/version-content":
		return method == http.MethodGet
	}
	const importImagePrefix = "/v1/cloud/notes/ios-import/"
	if strings.HasPrefix(path, importImagePrefix) && strings.HasSuffix(path, "/images") {
		id := strings.TrimSuffix(strings.TrimPrefix(path, importImagePrefix), "/images")
		return validBackupOnlyNoteID(id) && method == http.MethodPost
	}
	if !strings.HasPrefix(path, "/v1/cloud/notes/") {
		return false
	}
	id := strings.TrimPrefix(path, "/v1/cloud/notes/")
	if strings.HasSuffix(id, "/versions") {
		id = strings.TrimSuffix(id, "/versions")
		return validBackupOnlyNoteID(id) && method == http.MethodGet
	}
	// One immutable image per canonical Note ID. These are the ONLY binary
	// methods admitted for Backup-only; unknown suffixes and verbs fail closed.
	if strings.HasSuffix(id, "/images") {
		id = strings.TrimSuffix(id, "/images")
		return validBackupOnlyNoteID(id) &&
			(method == http.MethodGet || method == http.MethodPost)
	}
	return validBackupOnlyNoteID(id) &&
		(method == http.MethodGet || method == http.MethodPut || method == http.MethodDelete)
}

func validBackupOnlyNoteID(value string) bool {
	parsed, err := uuid.Parse(value)
	return err == nil && parsed.String() == value
}

// Backup-only DSM receives only these explicitly audited six Owner Clipboard
// operations; a path prefix alone never admits unrelated cloud methods.
func backupOnlyAllowedClipboardRequest(method, path string) bool {
	switch path {
	case "/v1/cloud/clipboard/vault", "/v1/cloud/clipboard/items":
		return method == http.MethodGet || (path == "/v1/cloud/clipboard/items" &&
			(method == http.MethodPost || method == http.MethodDelete))
	case "/v1/cloud/clipboard/check":
		return method == http.MethodPut
	}
	const prefix = "/v1/cloud/clipboard/items/"
	if !strings.HasPrefix(path, prefix) || method != http.MethodDelete {
		return false
	}
	raw := strings.TrimPrefix(path, prefix)
	id, err := strconv.ParseUint(raw, 10, 64)
	return err == nil && id > 0 && strconv.FormatUint(id, 10) == raw
}

func fullAgentOnlyRequest(method, path string) bool {
	if backupOnlyAllowedClipboardRequest(method, path) {
		return false
	}
	if backupOnlyAllowedNotesRequest(method, path) {
		return false
	}
	_, allowed := backupOnlyAllowedIPCRoutes[method+" "+path]
	return !allowed
}
