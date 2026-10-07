//go:build windows

package mount

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestWindowsRemoteJournalNoChangesAvoidsFullWalk(t *testing.T) {
	var walkCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/changes":
			_ = json.NewEncoder(w).Encode(client.NodeChangePage{
				Changes: []client.NodeChange{}, NextCursor: 7, LatestCursor: 7,
			})
		case "/api/v1/nodes/root", "/api/v1/nodes/1/children":
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
	enabled, cursor := p.remoteJournalState()
	if !enabled || cursor != 7 {
		t.Fatalf("journal enabled=%t cursor=%d", enabled, cursor)
	}
}

func TestWindowsRemoteJournal404FallsBackToFullWalk(t *testing.T) {
	var rootCalls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/changes":
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "not found"})
		case "/api/v1/nodes/root":
			rootCalls.Add(1)
			_ = json.NewEncoder(w).Encode(client.Node{ID: 1, Type: "dir", Revision: 1})
		case "/api/v1/nodes/1/children":
			writeEmptyWindowsWalkChildrenPage(t, w, r)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	p := newRemoteJournalTestProvider(t, server.URL)
	p.remoteJournal = true
	p.remoteCursor = 3
	if err := p.reconcileRemote(context.Background()); err != nil {
		t.Fatal(err)
	}
	if rootCalls.Load() != 1 {
		t.Fatalf("root calls=%d want=1", rootCalls.Load())
	}
	enabled, cursor := p.remoteJournalState()
	if enabled || cursor != 3 {
		t.Fatalf("journal enabled=%t cursor=%d", enabled, cursor)
	}
}

func TestWindowsRemoteJournalResetFallsBackAndAdvancesCheckpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/changes":
			_ = json.NewEncoder(w).Encode(client.NodeChangePage{
				Changes: []client.NodeChange{}, NextCursor: 9, LatestCursor: 9, ResetRequired: true,
			})
		case "/api/v1/nodes/root":
			_ = json.NewEncoder(w).Encode(client.Node{ID: 1, Type: "dir", Revision: 1})
		case "/api/v1/nodes/1/children":
			writeEmptyWindowsWalkChildrenPage(t, w, r)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	p := newRemoteJournalTestProvider(t, server.URL)
	p.remoteJournal = true
	p.remoteCursor = 12
	if err := p.reconcileRemote(context.Background()); err != nil {
		t.Fatal(err)
	}
	enabled, cursor := p.remoteJournalState()
	if !enabled || cursor != 9 {
		t.Fatalf("journal enabled=%t cursor=%d want=true,9", enabled, cursor)
	}
}

func TestWindowsRemoteJournalDirectoryMoveRequestsFullReconcile(t *testing.T) {
	parentID := uint64(1)
	p := &winProvider{
		root: t.TempDir(),
		baseline: map[string]winState{
			"": {node: client.Node{ID: 1, Type: "dir", Revision: 1}},
			"old": {
				node: client.Node{ID: 2, ParentID: &parentID, Name: "old", Type: "dir", Revision: 1},
			},
		},
		hydrated: map[uint64]time.Time{},
		accessed: map[uint64]time.Time{},
		policy:   newSyncPolicy(Options{}),
	}
	needFull, err := p.applyRemoteChangePage(context.Background(), []client.NodeChange{{
		Cursor: 4, NodeID: 2, Operation: "upsert", Path: "new",
		Node: &client.Node{ID: 2, ParentID: &parentID, Name: "new", Type: "dir", Revision: 2},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if !needFull {
		t.Fatal("directory move must request full reconciliation")
	}
}

func TestWindowsRemoteJournalBootstrapCapturesCheckpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/changes" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(client.NodeChangePage{
			Changes: []client.NodeChange{}, NextCursor: 1, LatestCursor: 44, HasMore: true,
		})
	}))
	defer server.Close()

	p := newRemoteJournalTestProvider(t, server.URL)
	p.bootstrapRemoteJournal(context.Background())
	enabled, cursor := p.remoteJournalState()
	if !enabled || cursor != 44 {
		t.Fatalf("journal enabled=%t cursor=%d want=true,44", enabled, cursor)
	}
}

func writeEmptyWindowsWalkChildrenPage(t *testing.T, w http.ResponseWriter, r *http.Request) {
	t.Helper()
	query := r.URL.Query()
	if query.Get("limit") != "500" || query.Get("sort") != "name" || query.Get("order") != "asc" {
		t.Errorf("full walk children query=%q", r.URL.RawQuery)
	}
	_ = json.NewEncoder(w).Encode(client.ChildrenPage{
		Items:   []client.Node{},
		HasMore: false,
		Sort:    "name",
		Order:   "asc",
	})
}

func newRemoteJournalTestProvider(t *testing.T, serverURL string) *winProvider {
	t.Helper()
	root := t.TempDir()
	return &winProvider{
		cli:        client.New(serverURL, "token"),
		root:       root,
		baseline:   map[string]winState{"": {node: client.Node{ID: 1, Type: "dir", Revision: 1}}},
		hydrated:   map[uint64]time.Time{},
		accessed:   map[uint64]time.Time{},
		policy:     newSyncPolicy(Options{}),
		cacheGrace: 30 * time.Second,
	}
}
