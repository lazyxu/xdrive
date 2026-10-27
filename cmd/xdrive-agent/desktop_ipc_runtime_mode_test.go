package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDesktopIPCRuntimeModeCapabilityAndEndpointFence(t *testing.T) {
	ctrl := &fakeDesktopIPCController{revision: 1}
	full := newDesktopIPCHandler(ctrl, "secret", func() {})
	backup := newDesktopIPCHandler(ctrl, "secret", func() {}, true)
	for _, tc := range []struct {
		name            string
		handler         http.Handler
		mode            string
		mountCapability bool
	}{
		{"full", full, agentRuntimeFull, true},
		{"backup_only", backup, agentRuntimeBackupOnly, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			res := desktopIPCRequest(t, tc.handler, http.MethodGet, "/v1/hello", "")
			if res.Code != http.StatusOK {
				t.Fatalf("hello status=%d: %s", res.Code, res.Body.String())
			}
			var result desktopIPCHello
			if err := json.NewDecoder(res.Body).Decode(&result); err != nil {
				t.Fatal(err)
			}
			if result.RuntimeMode != tc.mode {
				t.Fatalf("mode=%q want=%q", result.RuntimeMode, tc.mode)
			}
			seen := make(map[string]bool, len(result.Capabilities))
			for _, capability := range result.Capabilities {
				if seen[capability] {
					t.Fatalf("duplicate capability: %q", capability)
				}
				seen[capability] = true
			}
			for _, required := range []string{"device-backup-local-common-batch", "device-backup-local-schedule", "status"} {
				if !seen[required] {
					t.Fatalf("%s is missing owning Backup capability %q", tc.mode, required)
				}
			}
			for _, fullOnly := range []string{"sync-control", "client-update", "client-update-cancel", "storage-tree", "selective-sync", "open-folder", "lifecycle-shutdown", "diagnostics"} {
				if seen[fullOnly] != tc.mountCapability {
					t.Fatalf("%s claims full-only capability %s: %v", tc.mode, fullOnly, seen[fullOnly])
				}
			}
		})
	}

	for _, path := range []string{
		"/v1/sync/now", "/v1/sync/pause", "/v1/sync/resume",
		"/v1/update/check", "/v1/update/install",
		"/v1/cache/release", "/v1/open-folder", "/v1/lifecycle/shutdown",
	} {
		res := desktopIPCRequest(t, backup, http.MethodPost, path, "")
		if res.Code != http.StatusConflict || !strings.Contains(res.Body.String(), "agent_backup_only") {
			t.Fatalf("unexpected Backup-only gate %s: %d %s", path, res.Code, res.Body.String())
		}
	}
	for _, request := range []struct{ method, path string }{
		{http.MethodPatch, "/v1/settings"},
		{http.MethodPut, "/v1/settings/sync-rule"},
		{http.MethodGet, "/v1/storage-tree"},
		{http.MethodGet, "/v1/update"},
	} {
		res := desktopIPCRequest(t, backup, request.method, request.path, "")
		if res.Code != http.StatusConflict {
			t.Fatalf("backup-only permitted %s %s: %d", request.method, request.path, res.Code)
		}
	}

	// Auth is evaluated before the mode guard; unauthenticated callers cannot
	// use mode-specific error responses as an Agent discovery side channel.
	req := httptest.NewRequest(http.MethodPost, "/v1/sync/now", nil)
	req.RemoteAddr = "127.0.0.1:43210"
	req.Header.Set("Authorization", "Bearer wrong-token")
	untrusted := httptest.NewRecorder()
	backup.ServeHTTP(untrusted, req)
	if untrusted.Code != http.StatusUnauthorized {
		t.Fatalf("mode leaked before auth: %d", untrusted.Code)
	}
	status := desktopIPCRequest(t, backup, http.MethodGet, "/v1/status", "")
	if status.Code != http.StatusOK {
		t.Fatalf("backup-only status read broken: %d %s", status.Code, status.Body.String())
	}
}

func TestBackupOnlyStrictRouteAllowlist(t *testing.T) {
	// New/future full-only endpoints cannot silently become usable in
	// Backup-only just because they were omitted from a static denylist.
	ctrl := &fakeDesktopIPCController{revision: 1}
	backup := newDesktopIPCHandler(ctrl, "secret", func() {}, true)
	for _, request := range []struct{ method, path string }{
		{http.MethodPost, "/v1/lifecycle/shutdown"},
		{http.MethodPost, "/v1/sources/trigger"},
		{http.MethodPatch, "/v1/sources"},
		{http.MethodDelete, "/v1/sources"},
		{http.MethodPost, "/v1/cloud/root"},
		{http.MethodPost, "/v1/cloud/children"},
		{http.MethodGet, "/v1/cloud/children/position"},
		{http.MethodPost, "/v1/cloud/admin-users"},
		{http.MethodGet, "/v1/settings"},
		{http.MethodGet, "/v1/diagnostics"},
		{http.MethodPost, "/v1/new-future-full-agent-operation"},
		{http.MethodGet, "/v1/device-backups/local-future-unsafe-route"},
		{http.MethodPost, "/v1/device-backups/local-future-unsafe-route"},
	} {
		if !fullAgentOnlyRequest(request.method, request.path) {
			t.Fatalf("Backup-only implicitly permitted %s %s", request.method, request.path)
		}
		response := desktopIPCRequest(t, backup, request.method, request.path, "")
		if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "agent_backup_only") {
			t.Fatalf("Backup-only endpoint escaped guard %s %s: %d %s",
				request.method, request.path, response.Code, response.Body.String())
		}
	}
	for _, request := range []struct{ method, path string }{
		{http.MethodGet, "/v1/hello"},
		{http.MethodGet, "/v1/status"},
		{http.MethodGet, "/v1/events"},
		{http.MethodPost, "/v1/auth/login"},
		{http.MethodPost, "/v1/auth/logout"},
		{http.MethodGet, "/v1/sources"},
		{http.MethodPost, "/v1/sources"},
		{http.MethodPost, "/v1/local-folder/authorize"},
		{http.MethodGet, "/v1/device-backups/local-drafts"},
		{http.MethodPost, "/v1/device-backups/local-cli-preflight"},
		{http.MethodGet, "/v1/device-backups/local-schedule"},
		{http.MethodPatch, "/v1/device-backups/local-schedule"},
		{http.MethodGet, "/v1/device-backups/local-common-batch"},
		{http.MethodPost, "/v1/device-backups/local-common-batch"},
		{http.MethodPost, "/v1/device-backups/local-common-batch/control"},
		{http.MethodGet, "/v1/device-backups/local-common-batch/history"},
		{http.MethodGet, "/v1/device-backups/local-common-batch/recovery-review"},
		{http.MethodGet, "/v1/device-backups"},
		{http.MethodGet, "/v1/device-backups/folders"},
		{http.MethodDelete, "/v1/device-backups/local-bound"},
	} {
		if fullAgentOnlyRequest(request.method, request.path) {
			t.Fatalf("original owning Backup IPC blocked: %s %s", request.method, request.path)
		}
	}
}

func TestBackupOnlyCapSetCannotClaimMountOrUpdater(t *testing.T) {
	for _, capability := range desktopIPCCapabilitiesForRuntime(true) {
		if strings.Contains(capability, "update") || strings.Contains(capability, "sync-control") ||
			strings.Contains(capability, "storage-tree") || strings.Contains(capability, "file-availability") {
			t.Fatalf("unstarted service advertised in backup-only: %s", capability)
		}
	}
}

func TestBackupOnlyCloudQuotaIsExplicitlyReadOnly(t *testing.T) {
	capabilities := desktopIPCCapabilitiesForRuntime(true)
	approved := false
	for _, capability := range capabilities {
		if capability == "cloud-quota-read" {
			approved = true
		}
	}
	if !approved {
		t.Fatal("Backup-only Agent did not declare fixed owner quota read capability")
	}
	if fullAgentOnlyRequest(http.MethodGet, "/v1/cloud/quota") {
		t.Fatal("Owner quota read unexpectedly blocked in Backup-only mode")
	}
	for _, operation := range []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/v1/cloud/quota"},
		{http.MethodGet, "/v1/cloud/storage-stats"},
		{http.MethodPost, "/v1/cloud/storage-cache/cleanup"},
		{http.MethodPost, "/v1/cloud/root"},
		{http.MethodGet, "/v1/cloud/admin-storage"},
	} {
		if !fullAgentOnlyRequest(operation.method, operation.path) {
			t.Fatalf("Backup-only exposed an unauthorized cloud/storage operation: %s %s", operation.method, operation.path)
		}
	}
}

func TestBackupOnlyCloudFileReadIsLimitedToRootChildrenAndTextPreview(t *testing.T) {
	seen := false
	preview := false
	for _, capability := range desktopIPCCapabilitiesForRuntime(true) {
		if capability == "cloud-files-read" {
			seen = true
		}
		if capability == "cloud-file-text-preview" {
			preview = true
		}
		if capability == "cloud-files" {
			t.Fatal("Backup-only cannot claim the full FileExplorer capability")
		}
	}
	if !seen || !preview {
		t.Fatal("missing bounded Owner cloud files/text-preview capabilities")
	}
	for _, route := range []string{"/v1/cloud/root", "/v1/cloud/children", "/v1/cloud/text-preview"} {
		if fullAgentOnlyRequest(http.MethodGet, route) {
			t.Fatalf("Owner GET unexpectedly blocked in Backup-only runtime: %s", route)
		}
		for _, method := range []string{http.MethodPost, http.MethodPatch, http.MethodPut, http.MethodDelete} {
			if !fullAgentOnlyRequest(method, route) {
				t.Fatalf("unapproved cloud write %s %s", method, route)
			}
		}
	}
	for _, route := range []string{
		"/v1/cloud/children/position", "/v1/cloud/search", "/v1/cloud/changes",
		"/v1/cloud/download", "/v1/cloud/file-preview-ticket",
		"/v1/cloud/directories", "/v1/cloud/nodes", "/v1/cloud/media/items",
		"/v1/cloud/storage-cache/cleanup", "/v1/cloud/admin-users",
	} {
		if !fullAgentOnlyRequest(http.MethodGet, route) {
			t.Fatalf("full Agent feature unexpectedly enabled in Backup-only: %s", route)
		}
	}
}
