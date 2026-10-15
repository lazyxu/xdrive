//go:build linux

package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// S4D3 uses a genuine persisted FileOperation and the production Server
// worker, not the S4D2 test-only SQL state-advance shortcut.
type pwaS4D3DurableFixture struct {
	ownerID     uint64
	foreignID   uint64
	nodeID      uint64
	operationID string
	startCalls  atomic.Int64
	mutations   atomic.Int64
	mu          sync.Mutex
	stopWorker  context.CancelFunc
}

func pwaS4D3Prepare(
	t *testing.T,
	srv *Server,
	db *gorm.DB,
	router http.Handler,
	ownerToken, foreignToken string,
	ownerID, foreignID, parentID uint64,
) *pwaS4D3DurableFixture {
	t.Helper()
	node := meta.Node{
		ParentID: &parentID,
		Name:     "pwa-s4d3-real-worker-empty-directory",
		Type:     meta.NodeTypeDir,
		OwnerID:  ownerID,
		Revision: 1,
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	body := fmt.Sprintf(
		`{"type":"delete","items":[{"id":%d,"revision":%d}],"parent_id":0}`,
		node.ID, node.Revision,
	)
	response := request(t, router, http.MethodPost,
		"/api/v1/file-operations", ownerToken, strings.NewReader(body),
		http.StatusAccepted)
	var created fileOperationDTO
	if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.ID == "" || created.Status != meta.FileOperationStatusQueued ||
		created.Type != meta.FileOperationTypeDelete ||
		created.TotalItems != 1 || created.ProcessedItems != 0 {
		t.Fatalf("S4D3 genuine API did not enqueue a single queued file operation: %+v", created)
	}
	operation, err := srv.loadOwnedFileOperation(context.Background(), ownerID, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if operation.StartedAt != nil || operation.FinishedAt != nil {
		t.Fatal("S4D3 operation unexpectedly ran before browser process termination")
	}
	request(t, router, http.MethodGet,
		"/api/v1/file-operations/"+created.ID, foreignToken, nil, http.StatusNotFound)
	return &pwaS4D3DurableFixture{
		ownerID:     ownerID,
		foreignID:   foreignID,
		nodeID:      node.ID,
		operationID: created.ID,
	}
}

// Only the isolated Go test HTTP mux exposes this start signal. It never
// mutates operation state: the real Server worker claims and executes SQL work.
func (f *pwaS4D3DurableFixture) startWorker(w http.ResponseWriter, r *http.Request, srv *Server) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if r.Header.Get("X-PWA-Durable-Test-Start") != "s4d3-server-worker-only" {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	if !f.startCalls.CompareAndSwap(0, 1) {
		w.WriteHeader(http.StatusConflict)
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	f.mu.Lock()
	f.stopWorker = cancel
	f.mu.Unlock()
	srv.StartFileOperationWorker(ctx)
	w.WriteHeader(http.StatusNoContent)
}

func (f *pwaS4D3DurableFixture) verify(
	t *testing.T,
	srv *Server,
	db *gorm.DB,
	router http.Handler,
	ownerToken, foreignToken string,
) {
	t.Helper()
	f.mu.Lock()
	cancel := f.stopWorker
	f.mu.Unlock()
	if cancel != nil {
		defer cancel()
	}
	if f.startCalls.Load() != 1 || f.mutations.Load() != 0 {
		t.Fatalf("S4D3 worker-start count or browser task mutations invalid: starts=%d mutations=%d",
			f.startCalls.Load(), f.mutations.Load())
	}
	operation, err := srv.loadOwnedFileOperation(
		context.Background(), f.ownerID, f.operationID)
	if err != nil {
		t.Fatal(err)
	}
	if operation.Status != meta.FileOperationStatusCompleted ||
		operation.ProcessedItems != 1 || operation.StartedAt == nil ||
		operation.FinishedAt == nil || operation.Error != "" {
		t.Fatalf("S4D3 real Server worker did not durably complete operation: %+v", operation)
	}
	var node meta.Node
	if err := db.First(&node, f.nodeID).Error; err != nil {
		t.Fatal(err)
	}
	if node.OwnerID != f.ownerID || node.DeletedAt == nil {
		t.Fatal("S4D3 real file-operation worker did not commit the deleted Node")
	}
	readSummary := func(token string) {
		t.Helper()
		res := request(t, router, http.MethodGet,
			"/api/v1/background-tasks/active-summary", token, nil, http.StatusOK)
		var value backgroundTaskActiveSummaryDTO
		if err := json.Unmarshal(res.Body.Bytes(), &value); err != nil {
			t.Fatal(err)
		}
		if value.FileOperation != 0 || value.ActiveTotal != 0 {
			t.Fatalf("S4D3 Server active task summary was not reconciled: %+v", value)
		}
	}
	readSummary(ownerToken)
	readSummary(foreignToken)
	readPage := func(token string, shouldContain bool) {
		t.Helper()
		res := request(t, router, http.MethodGet,
			"/api/v1/background-tasks/page?limit=50", token, nil, http.StatusOK)
		var page backgroundTaskPageDTO
		if err := json.Unmarshal(res.Body.Bytes(), &page); err != nil {
			t.Fatal(err)
		}
		found := false
		for _, task := range append(page.CurrentItems, page.HistoryItems...) {
			if task.ID == "file-operation:"+f.operationID {
				if task.State != "completed" {
					t.Fatal("S4D3 persisted operation is visible with the wrong state")
				}
				found = true
			}
		}
		if found != shouldContain {
			t.Fatalf("S4D3 owner scoped historical task visibility=%v expected=%v",
				found, shouldContain)
		}
	}
	// A personal task page intentionally excludes file-operation cards. Those
	// are managed by FileOperationCenter and its own authenticated API.
	readPage(ownerToken, false)
	readPage(foreignToken, false)
	ownerRead := request(t, router, http.MethodGet,
		"/api/v1/file-operations/"+f.operationID, ownerToken, nil, http.StatusOK)
	var ownerOperation fileOperationDTO
	if err := json.Unmarshal(ownerRead.Body.Bytes(), &ownerOperation); err != nil {
		t.Fatal(err)
	}
	if ownerOperation.ID != f.operationID ||
		ownerOperation.Status != meta.FileOperationStatusCompleted ||
		ownerOperation.ProcessedItems != 1 ||
		ownerOperation.StartedAt == nil || ownerOperation.FinishedAt == nil {
		t.Fatal("S4D3 authenticated owner file-operation endpoint did not prove completion")
	}
	request(t, router, http.MethodGet,
		"/api/v1/file-operations/"+f.operationID, foreignToken, nil, http.StatusNotFound)
	t.Logf("PWA_S4D3_REAL_WORKER_VERIFIED claimed=1 completed=1 physical_node_deleted=true browser_mutations=0 owner_isolation=true")
}
