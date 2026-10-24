package localbackupipc

import (
	"context"
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestHeadlessBootstrapUsesOriginalOwningAgentEndpoints(t *testing.T) {
	localPath := filepath.Join(t.TempDir(), "photos")
	var methods []string
	rootID := uuid.NewString()
	deviceID := uuid.NewString()
	dir, _ := testEndpoint(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+strings.Repeat("a", 64) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if r.URL.Path == "/v1/hello" {
			testHello(w)
			return
		}
		methods = append(methods, r.Method+" "+r.URL.Path)
		switch r.URL.Path {
		case "/v1/device-backups/local-cli-preflight":
			if r.Method != http.MethodPost {
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			var req localBackupRootRequest
			if json.NewDecoder(r.Body).Decode(&req) != nil ||
				req.Path != localPath || req.SourceID != 0 {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
		case "/v1/sources":
			var request map[string]any
			if json.NewDecoder(r.Body).Decode(&request) != nil ||
				request["kind"] != "local_folder" ||
				request["direction"] != "push" ||
				request["sync_mode"] != "backup" ||
				request["target_node_id"] != float64(12) {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(LocalBackupSource{
				ID: 42, Name: "Photos", Revision: 1, Status: "paused",
				Kind: "local_folder", Direction: "push", SyncMode: "backup",
				TargetNodeID: func() *uint64 { v := uint64(12); return &v }(),
			})
		case "/v1/local-folder/authorize":
			var req localBackupRootRequest
			if json.NewDecoder(r.Body).Decode(&req) != nil ||
				req.Path != localPath || req.SourceID != 42 {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(LocalBackupRootGrant{
				SourceID: 42, Path: localPath, DeviceID: deviceID,
				RootID: rootID, Status: "awaiting_executor",
				StrongIdentity: false, // Linux inode-only identity is valid for Backup-only.
			})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	agent, err := Connect(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := agent.PreflightLocalRoot(ctx, localPath); err != nil {
		t.Fatal(err)
	}
	source, err := agent.CreateLocalBackupSource(ctx, "Photos", 12)
	if err != nil || source.ID != 42 {
		t.Fatalf("existing owning Agent Source endpoint rejected: %+v, %v", source, err)
	}
	grant, err := agent.AuthorizeLocalRoot(ctx, source.ID, localPath)
	if err != nil || grant.RootID != rootID || grant.SourceID != source.ID {
		t.Fatalf("existing owning Agent Root endpoint rejected: %+v, %v", grant, err)
	}
	want := []string{
		"POST /v1/device-backups/local-cli-preflight",
		"POST /v1/sources",
		"POST /v1/local-folder/authorize",
	}
	if len(methods) != len(want) {
		t.Fatalf("second device/Root writer was created: %v", methods)
	}
	for i, method := range want {
		if methods[i] != method {
			t.Fatalf("got %v want %v", methods, want)
		}
	}
}

func TestHeadlessBootstrapRejectsUnsafeOrForeignRootWithoutRequests(t *testing.T) {
	requests := 0
	dir, _ := testEndpoint(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/hello" {
			testHello(w)
			return
		}
		requests++
		w.WriteHeader(http.StatusForbidden)
	}))
	agent, err := Connect(context.Background(), dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := agent.PreflightLocalRoot(context.Background(), "relative"); err == nil {
		t.Fatal("relative local directory accepted")
	}
	if _, err := agent.CreateLocalBackupSource(context.Background(), "Photos", 0); err == nil {
		t.Fatal("cloud target with invalid ID accepted")
	}
	if _, err := agent.AuthorizeLocalRoot(context.Background(), 0, "/tmp/photos"); err == nil {
		t.Fatal("missing Source ownership accepted")
	}
	if requests != 0 {
		t.Fatal("unsafe bootstrap inputs reached protected Agent API")
	}
}
