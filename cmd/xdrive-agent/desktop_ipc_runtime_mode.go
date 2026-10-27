package main

import (
	"net/http"
	"strings"
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
			capability == "cloud-file-text-preview",
			capability == "cloud-media-range-read",
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
	"GET /v1/cloud/children":                                    {},
	"GET /v1/cloud/text-preview":                                {},
	"GET /v1/cloud/media-range":                                 {},
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

func fullAgentOnlyRequest(method, path string) bool {
	_, allowed := backupOnlyAllowedIPCRoutes[method+" "+path]
	return !allowed
}
