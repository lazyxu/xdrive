package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/localbackupipc"
	"github.com/lazyxu/xdrive/internal/sourceschedule"
)

// Contract test: the CLI's real authenticated HTTP IPC client goes through
// bootstrap, the original Agent Runner, and a second unchanged-file result.
// The server replies are simulated; SQL/CAS commits have separate tests.
func TestHeadlessCLIInitAndIncrementalsShareOneAuthenticatedAgent(t *testing.T) {
	if runtime.GOOS != "linux" && runtime.GOOS != "windows" {
		t.Skip("native Backup-only Agent is Linux/Windows only")
	}
	path := filepath.Join(t.TempDir(), "photos")
	if err := os.MkdirAll(path, 0o700); err != nil {
		t.Fatal(err)
	}
	token := strings.Repeat("a", 64)
	deviceID, rootID := uuid.NewString(), uuid.NewString()
	var mu sync.Mutex
	var calls []string
	var runs int
	var scheduled bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Header.Get("Authorization") != "Bearer "+token {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.Method == http.MethodGet && r.URL.Path == "/v1/hello" {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"discovery_version": 1, "protocol_min": 2, "protocol_max": 2,
				"pid": os.Getpid(), "platform": runtime.GOOS,
				"capabilities": []string{"device-backup-local-common-batch", "device-backup-local-schedule"},
			})
			return
		}
		mu.Lock()
		defer mu.Unlock()
		call := r.Method + " " + r.URL.Path
		calls = append(calls, call)
		fail := func() { w.WriteHeader(http.StatusForbidden) }
		switch call {
		case "POST /v1/device-backups/local-cli-preflight":
			var input map[string]any
			if json.NewDecoder(r.Body).Decode(&input) != nil || input["path"] != path ||
				len(input) != 1 {
				fail()
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
		case "POST /v1/sources":
			var input map[string]any
			if json.NewDecoder(r.Body).Decode(&input) != nil ||
				input["name"] != "Photos" || input["kind"] != "local_folder" ||
				input["direction"] != "push" || input["sync_mode"] != "backup" ||
				input["target_node_id"] != float64(12) {
				fail()
				return
			}
			target := uint64(12)
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(localbackupipc.LocalBackupSource{
				ID: 42, Name: "Photos", Kind: "local_folder", Direction: "push",
				SyncMode: "backup", Status: "paused", Revision: 1,
				TargetNodeID: &target,
			})
		case "POST /v1/local-folder/authorize":
			var input map[string]any
			if json.NewDecoder(r.Body).Decode(&input) != nil ||
				input["source_id"] != float64(42) || input["path"] != path {
				fail()
				return
			}
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(localbackupipc.LocalBackupRootGrant{
				SourceID: 42, Path: path, RootID: rootID, DeviceID: deviceID,
				Status: "awaiting_executor", StrongIdentity: false,
			})
		case "GET /v1/device-backups/local-schedule":
			if r.URL.Query().Get("source_id") != "42" {
				fail()
				return
			}
			_ = json.NewEncoder(w).Encode(localbackupipc.Schedule{
				SourceID: 42, Revision: 1, ScheduleType: "manual",
			})
		case "PATCH /v1/device-backups/local-schedule":
			var input localbackupipc.Schedule
			if json.NewDecoder(r.Body).Decode(&input) != nil ||
				input.SourceID != 42 || input.Revision != 1 ||
				input.ScheduleType != "interval" || input.ScheduleExpression != "6h" {
				fail()
				return
			}
			scheduled = true
			input.Revision = 2
			_ = json.NewEncoder(w).Encode(input)
		case "POST /v1/device-backups/local-common-batch":
			if r.URL.Query().Get("source_id") != "42" || !scheduled {
				fail()
				return
			}
			runs++
			_ = json.NewEncoder(w).Encode(localbackupipc.Summary{
				SourceID: 42, State: "running", Revision: 2, Running: true,
			})
		case "GET /v1/device-backups/local-common-batch":
			if r.URL.Query().Get("source_id") != "42" || runs == 0 {
				fail()
				return
			}
			summary := localbackupipc.Summary{
				SourceID: 42, Revision: 2, State: "partial", InspectedFiles: 1,
			}
			if runs == 1 {
				summary.ConfirmedFiles = 1
			} else {
				summary.SkippedFiles = 1
			}
			_ = json.NewEncoder(w).Encode(summary)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	discovery, err := json.Marshal(map[string]any{
		"version": 1, "base_url": server.URL, "token": token, "pid": os.Getpid(),
	})
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "desktop-ipc.json"), discovery, 0o600); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	agent, err := localbackupipc.Connect(ctx, dir)
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	id, err := runBackupInitAndMaybeOnce(ctx, agent, "Photos", path, 12,
		sourceschedule.Spec{Type: "interval", Expression: "6h"}, true, &output)
	if err != nil || id != 42 {
		t.Fatalf("CLI bootstrap over same owning Agent failed: %d %v", id, err)
	}
	mu.Lock()
	if runs != 1 {
		t.Fatal("explicit init --run-now failed to start exactly one owning Agent run")
	}
	mu.Unlock()
	var unchanged bytes.Buffer
	// A new xd invocation reconnects through discovery instead of keeping
	// a private in-process upload queue. The owning Agent and Source remain
	// unchanged across this client-side process-equivalent restart.
	reattached, err := localbackupipc.Connect(ctx, dir)
	if err != nil {
		t.Fatalf("second CLI could not reconnect to owning Agent: %v", err)
	}
	if err := runBackupOnce(ctx, reattached, id, 250*time.Millisecond, &unchanged); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "uploaded=1") ||
		!strings.Contains(unchanged.String(), "unchanged=1") ||
		strings.Contains(output.String()+unchanged.String(), "backup_complete") {
		t.Fatalf("CLI lost per-file result or invented full backup: %q %q", output.String(), unchanged.String())
	}
	want := []string{
		"POST /v1/device-backups/local-cli-preflight", "POST /v1/sources",
		"POST /v1/local-folder/authorize", "GET /v1/device-backups/local-schedule",
		"PATCH /v1/device-backups/local-schedule",
		"POST /v1/device-backups/local-common-batch", "GET /v1/device-backups/local-common-batch",
		"POST /v1/device-backups/local-common-batch", "GET /v1/device-backups/local-common-batch",
	}
	mu.Lock()
	defer mu.Unlock()
	if runs != 2 || !reflect.DeepEqual(calls, want) {
		t.Fatalf("CLI escaped original Agent route contract: runs=%d calls=%v", runs, calls)
	}
}
