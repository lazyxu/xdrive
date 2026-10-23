//go:build linux || windows

package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

// An already-committed file must NOT be skipped just because its cloud parent
// was cached earlier in the run. A stale Source-relative chain must be checked
// without recreating any missing directory or issuing a new file Operation.
func TestLocalCommonIncrementalSkipRechecksCurrentParentWithoutWrites(t *testing.T) {
	const sourceID, revision, sourceRoot uint64 = 42, 7, 100
	proof := client.LocalBoundSourceProof{
		DeviceID: "owning-fixture-device", DeviceToken: "owner-device-secret",
		RootID: "local-root-fixture", RootFingerprint: strings.Repeat("a", 64),
	}
	var verifyRequests, unsafeRequests atomic.Int32
	var moved, replaced atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			ParentID  uint64 `json:"parent_id"`
			Name      string `json:"name"`
			CheckOnly bool   `json:"check_only"`
		}
		if r.Method != http.MethodPost ||
			r.URL.Path != "/api/v1/sources/42/local-common-upload/directory" ||
			r.Header.Get("If-Match") != strconv.Quote("7") ||
			r.Header.Get("X-XDrive-Device-ID") != proof.DeviceID ||
			r.Header.Get("X-XDrive-Device-Token") != proof.DeviceToken ||
			r.Header.Get("X-XDrive-Local-Root-ID") != proof.RootID ||
			r.Header.Get("X-XDrive-Local-Root-Fingerprint") != proof.RootFingerprint ||
			json.NewDecoder(r.Body).Decode(&input) != nil || !input.CheckOnly {
			unsafeRequests.Add(1)
			http.Error(w, "non-read-only or unscoped lookup", http.StatusForbidden)
			return
		}
		verifyRequests.Add(1)
		var nodeID uint64
		switch {
		case input.ParentID == sourceRoot && input.Name == "trips":
			if moved.Load() {
				http.Error(w, "cloud folder moved out of Source", http.StatusConflict)
				return
			}
			nodeID = 101
		case input.ParentID == 101 && input.Name == "autumn":
			nodeID = 102
			if replaced.Load() {
				nodeID = 103
			}
		default:
			http.Error(w, "missing cloud directory", http.StatusConflict)
			return
		}
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Set("ETag", strconv.Quote("7"))
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"source_id": sourceID, "revision": revision,
			"node_id": nodeID, "parent_id": input.ParentID,
			"node_revision": 1, "name": input.Name, "type": "dir",
			"backup_complete": false, "retirement_safe": false,
			"current_cas_verified": false,
		})
	}))
	defer srv.Close()
	api := client.New(srv.URL, "owner-access-token")
	ctx := context.Background()
	if err := localCommonVerifyCloudParent(ctx, api, sourceID, revision,
		sourceRoot, proof, "trips/autumn/memory.jpg", 102); err != nil {
		t.Fatalf("verified Source directory chain was refused: %v", err)
	}
	if verifyRequests.Load() != 2 || unsafeRequests.Load() != 0 {
		t.Fatalf("cached folder was not rechecked strictly read-only: verified=%d unsafe=%d",
			verifyRequests.Load(), unsafeRequests.Load())
	}
	parent, name, err := localCommonFindExistingCloudParent(
		ctx, api, sourceID, revision, sourceRoot, proof, "trips/autumn/memory.jpg")
	if err != nil || parent != 102 || name != "memory.jpg" {
		t.Fatalf("historical nested path was not read-only resolved: id=%d name=%q err=%v",
			parent, name, err)
	}
	moved.Store(true)
	if _, _, err := localCommonFindExistingCloudParent(
		ctx, api, sourceID, revision, sourceRoot, proof,
		"trips/autumn/memory.jpg"); err == nil {
		t.Fatal("stale historical path was recreated rather than rejected")
	}
	if err := localCommonVerifyCloudParent(ctx, api, sourceID, revision,
		sourceRoot, proof, "trips/autumn/memory.jpg", 102); err == nil {
		t.Fatal("stale cached parent after moving cloud folder out of Source was skipped")
	}
	moved.Store(false)
	replaced.Store(true)
	if err := localCommonVerifyCloudParent(ctx, api, sourceID, revision,
		sourceRoot, proof, "trips/autumn/memory.jpg", 102); err == nil {
		t.Fatal("new folder at identical name replaced original historical Node")
	}
	replaced.Store(false)
	if err := localCommonVerifyCloudParent(ctx, api, sourceID, revision,
		sourceRoot, proof, "trips/autumn/memory.jpg", 777); err == nil {
		t.Fatal("wrong stored final parent ID was treated as current")
	}
	before := verifyRequests.Load()
	if err := localCommonVerifyCloudParent(ctx, api, sourceID, revision,
		sourceRoot, proof, "rootfile.jpg", sourceRoot); err != nil {
		t.Fatalf("Root child incorrectly required a phantom directory: %v", err)
	}
	if verifyRequests.Load() != before {
		t.Fatal("root-level file triggered an unnecessary directory mutation")
	}
	if err := localCommonVerifyCloudParent(ctx, api, sourceID, revision,
		sourceRoot, proof, "../escape.jpg", sourceRoot); err == nil {
		t.Fatal("unsafe path escaped the verified native Source")
	}
	if unsafeRequests.Load() != 0 {
		t.Fatalf("skip-only lookup attempted %d unscoped or write requests", unsafeRequests.Load())
	}
}

// A committed SQL receipt and a verified cloud DIRECTORY do not establish
// that the FILE is still current: another client could update or move it.
// No new file Operation and no write endpoint may be reached on this path.
func TestLocalCommonSkipRechecksCurrentFileBeforeCountingUnchanged(t *testing.T) {
	const parentID uint64 = 102
	sha := strings.Repeat("a", 64)
	initial := client.Node{
		ID: 234, ParentID: func() *uint64 { v := parentID; return &v }(),
		Name: "memory.jpg", Type: "file", Size: 1234, Revision: 3, SHA256: sha,
	}
	var actual atomic.Pointer[client.Node]
	actual.Store(&initial)
	var reads, unsafe atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/nodes/102/children" ||
			r.URL.Query().Get("name_ci") != initial.Name || r.URL.Query().Get("limit") != "200" {
			unsafe.Add(1)
			http.Error(w, "unexpected write or unscoped lookup", http.StatusForbidden)
			return
		}
		reads.Add(1)
		items := []client.Node{}
		if node := actual.Load(); node != nil {
			items = append(items, *node)
		}
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(client.ChildrenPage{Items: items})
	}))
	defer srv.Close()
	api := client.New(srv.URL, "owner-access-token")
	ctx := context.Background()
	if err := localCommonVerifyCloudFileUnchanged(ctx, api, parentID, &initial); err != nil {
		t.Fatalf("stable current file was rejected: %v", err)
	}
	for _, test := range []struct {
		name string
		edit func(*client.Node)
	}{
		{"replacement-node", func(n *client.Node) { n.ID++ }},
		{"new-revision", func(n *client.Node) { n.Revision++ }},
		{"new-bytes", func(n *client.Node) { n.SHA256 = strings.Repeat("b", 64) }},
		{"new-size", func(n *client.Node) { n.Size++ }},
		{"different-case", func(n *client.Node) { n.Name = "Memory.jpg" }},
		{"moved-parent", func(n *client.Node) { v := uint64(999); n.ParentID = &v }},
	} {
		t.Run(test.name, func(t *testing.T) {
			changed := initial
			test.edit(&changed)
			actual.Store(&changed)
			if err := localCommonVerifyCloudFileUnchanged(ctx, api, parentID, &initial); err == nil {
				t.Fatal("stale cloud file was counted as unchanged")
			}
		})
	}
	actual.Store(nil)
	if err := localCommonVerifyCloudFileUnchanged(ctx, api, parentID, &initial); err == nil {
		t.Fatal("missing cloud file was counted as unchanged")
	}
	if reads.Load() != 8 || unsafe.Load() != 0 {
		t.Fatalf("skip check used unscoped or mutating requests: reads=%d unsafe=%d", reads.Load(), unsafe.Load())
	}
}
