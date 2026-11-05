package localbackupipc

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	clientdto "github.com/lazyxu/xdrive/internal/client"
)

func TestLocalBackupManagementUsesDedicatedOwningAgentRoutes(t *testing.T) {
	const sourceID = uint64(42)
	targetID := uint64(7)
	settings := clientdto.LocalBoundBackupSettings{
		SourceID: sourceID, Name: "Photos", Revision: 3, SyncMode: "backup",
		TargetNodeID: &targetID, TargetPath: "/Backup/Photos",
	}
	rules := clientdto.LocalBoundIgnoreRules{
		SourceID: sourceID, Revision: 3, IgnoreRules: "**/*.tmp\n",
	}
	var calls []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.Method+" "+r.URL.String())
		switch r.Method + " " + r.URL.Path {
		case "GET /v1/device-backups/local-source":
			_ = json.NewEncoder(w).Encode(settings)
		case "PATCH /v1/device-backups/local-source":
			var input struct {
				SourceID uint64 `json:"source_id"`
				Revision uint64 `json:"revision"`
				Name     string `json:"name"`
			}
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil ||
				input.SourceID != sourceID || input.Revision != settings.Revision || input.Name == "" {
				t.Errorf("invalid rename payload: %+v err=%v", input, err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			settings.Revision++
			settings.Name = input.Name
			_ = json.NewEncoder(w).Encode(settings)
		case "PATCH /v1/device-backups/local-target":
			var input struct {
				SourceID     uint64 `json:"source_id"`
				Revision     uint64 `json:"revision"`
				TargetNodeID uint64 `json:"target_node_id"`
			}
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil ||
				input.SourceID != sourceID || input.Revision != settings.Revision || input.TargetNodeID == 0 {
				t.Errorf("invalid target payload: %+v err=%v", input, err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			settings.Revision++
			target := input.TargetNodeID
			settings.TargetNodeID = &target
			settings.TargetPath = "/Backup/Retargeted"
			_ = json.NewEncoder(w).Encode(settings)
		case "PATCH /v1/device-backups/local-mode":
			var input struct {
				SourceID uint64 `json:"source_id"`
				Revision uint64 `json:"revision"`
				SyncMode string `json:"sync_mode"`
			}
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil ||
				input.SourceID != sourceID || input.Revision != settings.Revision {
				t.Errorf("invalid mode payload: %+v err=%v", input, err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			settings.Revision++
			settings.SyncMode = input.SyncMode
			_ = json.NewEncoder(w).Encode(settings)
		case "GET /v1/device-backups/local-rules":
			_ = json.NewEncoder(w).Encode(rules)
		case "PATCH /v1/device-backups/local-rules":
			var input struct {
				SourceID    uint64 `json:"source_id"`
				Revision    uint64 `json:"revision"`
				IgnoreRules string `json:"ignore_rules"`
			}
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil ||
				input.SourceID != sourceID || input.Revision != rules.Revision {
				t.Errorf("invalid rules payload: %+v err=%v", input, err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			rules.Revision++
			rules.IgnoreRules = input.IgnoreRules
			_ = json.NewEncoder(w).Encode(rules)
		case "DELETE /v1/device-backups/local-bound":
			var input struct {
				SourceID uint64 `json:"source_id"`
				Revision uint64 `json:"revision"`
			}
			if err := json.NewDecoder(r.Body).Decode(&input); err != nil ||
				input.SourceID != sourceID || input.Revision == 0 {
				t.Errorf("invalid removal payload: %+v err=%v", input, err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(clientdto.LocalBoundBackupRemoval{
				SourceID: sourceID, LocalGrantRemoved: true,
			})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	c := &Client{
		baseURL: server.URL, token: strings.Repeat("a", 64), http: server.Client(),
		capabilities: []string{
			"device-backup-local-config", "device-backup-local-target",
			"device-backup-local-mode", "device-backup-local-rules",
			"device-backup-local-remove",
		},
	}
	ctx := context.Background()
	if got, err := c.LocalBackupSettings(ctx, sourceID); err != nil || got.Name != "Photos" {
		t.Fatalf("settings read failed: %+v %v", got, err)
	}
	if got, err := c.RenameLocalBackupSource(ctx, sourceID, 3, "Photos Archive"); err != nil ||
		got.Name != "Photos Archive" || got.Revision != 4 {
		t.Fatalf("rename failed: %+v %v", got, err)
	}
	if got, err := c.RetargetLocalBackupSource(ctx, sourceID, 4, 8); err != nil ||
		got.TargetNodeID == nil || *got.TargetNodeID != 8 || got.Revision != 5 {
		t.Fatalf("retarget failed: %+v %v", got, err)
	}
	if got, err := c.SetLocalBackupMode(ctx, sourceID, 5, "mirror"); err != nil ||
		got.SyncMode != "mirror" || got.Revision != 6 {
		t.Fatalf("mode update failed: %+v %v", got, err)
	}
	if got, err := c.LocalBackupRules(ctx, sourceID); err != nil || got.IgnoreRules != "**/*.tmp\n" {
		t.Fatalf("rules read failed: %+v %v", got, err)
	}
	if got, err := c.SaveLocalBackupRules(ctx, sourceID, 3, "**/*.log\n"); err != nil ||
		got.IgnoreRules != "**/*.log\n" || got.Revision != 4 {
		t.Fatalf("rules update failed: %+v %v", got, err)
	}
	if got, err := c.RemoveLocalBackupSource(ctx, sourceID, 6); err != nil ||
		got.SourceID != sourceID || !got.LocalGrantRemoved {
		t.Fatalf("removal failed: %+v %v", got, err)
	}
	for _, expected := range []string{
		"GET /v1/device-backups/local-source?source_id=42",
		"PATCH /v1/device-backups/local-source?source_id=42",
		"PATCH /v1/device-backups/local-target?source_id=42",
		"PATCH /v1/device-backups/local-mode?source_id=42",
		"GET /v1/device-backups/local-rules?source_id=42",
		"PATCH /v1/device-backups/local-rules?source_id=42",
		"DELETE /v1/device-backups/local-bound?source_id=42",
	} {
		if !strings.Contains(strings.Join(calls, "\n"), expected) {
			t.Errorf("missing dedicated Agent route %q in %v", expected, calls)
		}
	}
}

func TestLocalBackupManagementFailsClosedWhenCapabilityIsMissing(t *testing.T) {
	c := &Client{capabilities: []string{"device-backup-local-common-batch"}}
	_, err := c.LocalBackupSettings(context.Background(), 42)
	status, ok := err.(*AgentHTTPStatusError)
	if !ok || status.StatusCode != http.StatusNotImplemented {
		t.Fatalf("missing local config capability must be explicit: %v", err)
	}
}
