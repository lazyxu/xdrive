//go:build windows

package mount

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestWindowsRemoteJournalDirectoryCreateAvoidsFullWalk(t *testing.T) {
	const (
		rootID   = uint64(1)
		folderID = uint64(2)
	)
	var walkCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/v1/changes":
			parentID := rootID
			_ = json.NewEncoder(w).Encode(client.NodeChangePage{
				Changes: []client.NodeChange{{
					Cursor:    8,
					NodeID:    folderID,
					Operation: "upsert",
					Path:      "folder",
					Node: &client.Node{
						ID:       folderID,
						ParentID: &parentID,
						Name:     "folder",
						Type:     "dir",
						Revision: 1,
					},
				}},
				NextCursor:   8,
				LatestCursor: 8,
			})
		case r.URL.Path == "/api/v1/nodes/root" || strings.Contains(r.URL.Path, "/children"):
			walkCalls.Add(1)
			http.Error(w, "unexpected full walk", http.StatusInternalServerError)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	p := newRemoteJournalTestProvider(t, server.URL)
	p.remoteJournal = true
	p.remoteCursor = 7
	if err := p.reconcileRemote(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := walkCalls.Load(); got != 0 {
		t.Fatalf("full walk calls=%d want=0", got)
	}
	info, err := os.Stat(filepath.Join(p.root, "folder"))
	if err != nil {
		t.Fatal(err)
	}
	if !info.IsDir() {
		t.Fatal("remote directory create did not create a local directory")
	}
	p.mu.Lock()
	state, ok := p.baseline["folder"]
	p.mu.Unlock()
	if !ok || state.node.ID != folderID || state.node.Type != "dir" {
		t.Fatalf("folder baseline=%+v exists=%t", state.node, ok)
	}
	enabled, cursor := p.remoteJournalState()
	if !enabled || cursor != 8 {
		t.Fatalf("journal enabled=%t cursor=%d want=true,8", enabled, cursor)
	}
}

func TestWindowsRemoteJournalDirectoryDeleteAvoidsFullWalk(t *testing.T) {
	const (
		rootID   = uint64(1)
		folderID = uint64(2)
		subID    = uint64(3)
		fileID   = uint64(4)
	)
	var walkCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/v1/changes":
			_ = json.NewEncoder(w).Encode(client.NodeChangePage{
				Changes: []client.NodeChange{
					{Cursor: 11, NodeID: fileID, Operation: "delete"},
					{Cursor: 12, NodeID: folderID, Operation: "delete"},
				},
				NextCursor:   12,
				LatestCursor: 12,
			})
		case r.URL.Path == "/api/v1/nodes/root" || strings.Contains(r.URL.Path, "/children"):
			walkCalls.Add(1)
			http.Error(w, "unexpected full walk", http.StatusInternalServerError)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	p := newRemoteJournalTestProvider(t, server.URL)
	rootParent := rootID
	folderParent := folderID
	subParent := subID
	p.baseline = map[string]winState{
		"": {
			node: client.Node{ID: rootID, Type: "dir", Revision: 1},
		},
		"folder": {
			node: client.Node{ID: folderID, ParentID: &rootParent, Name: "folder", Type: "dir", Revision: 1},
		},
		"folder/sub": {
			node: client.Node{ID: subID, ParentID: &folderParent, Name: "sub", Type: "dir", Revision: 1},
		},
		"folder/sub/file.txt": {
			node: client.Node{ID: fileID, ParentID: &subParent, Name: "file.txt", Type: "file", Revision: 1, Size: 4},
			// Deliberately stale so processing the child delete independently
			// would report an unsynchronized-local-change conflict. The parent
			// directory delete must suppress that redundant child event.
			localSize: 1,
		},
	}
	if err := os.MkdirAll(filepath.Join(p.root, "folder", "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(p.root, "folder", "sub", "file.txt"), []byte("data"), 0o644); err != nil {
		t.Fatal(err)
	}
	p.remoteJournal = true
	p.remoteCursor = 11

	if err := p.reconcileRemote(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := walkCalls.Load(); got != 0 {
		t.Fatalf("full walk calls=%d want=0", got)
	}
	if _, err := os.Stat(filepath.Join(p.root, "folder")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("deleted directory stat err=%v want os.ErrNotExist", err)
	}
	p.mu.Lock()
	for rel := range p.baseline {
		if rel == "folder" || strings.HasPrefix(rel, "folder/") {
			p.mu.Unlock()
			t.Fatalf("deleted directory baseline still contains %q", rel)
		}
	}
	p.mu.Unlock()
	enabled, cursor := p.remoteJournalState()
	if !enabled || cursor != 12 {
		t.Fatalf("journal enabled=%t cursor=%d want=true,12", enabled, cursor)
	}
}

func TestWindowsRemoteJournalUnknownDirectoryUpsertKeepsFullReconcile(t *testing.T) {
	const (
		rootID   = uint64(1)
		folderID = uint64(2)
	)
	parentID := rootID
	p := &winProvider{
		root: t.TempDir(),
		baseline: map[string]winState{
			"": {node: client.Node{ID: rootID, Type: "dir", Revision: 1}},
		},
		hydrated: map[uint64]time.Time{},
		accessed: map[uint64]time.Time{},
		policy:   newSyncPolicy(Options{}),
	}
	needFull, err := p.applyRemoteChangePage(context.Background(), []client.NodeChange{{
		Cursor:    20,
		NodeID:    folderID,
		Operation: "upsert",
		Path:      "folder",
		Node: &client.Node{
			ID:       folderID,
			ParentID: &parentID,
			Name:     "folder",
			Type:     "dir",
			Revision: 2,
		},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if !needFull {
		t.Fatal("unknown revision>1 directory must keep full reconciliation")
	}
}
