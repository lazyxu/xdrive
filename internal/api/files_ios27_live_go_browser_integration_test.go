//go:build linux

package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

// TestIOS27FilesLiveGoFixture serves the actual production Gin Router, a
// private PostgreSQL schema and physical Local CAS to a built-Web browser.
// No /api/v1 response is mocked. The /__test endpoint only stops the fixture.
func TestIOS27FilesLiveGoFixture(t *testing.T) {
	if os.Getenv("XD_FILES_IOS27_LIVE_GO") != "1" {
		t.Skip("explicit live-Go browser acceptance only")
	}
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	readyPath := os.Getenv("XD_FILES_IOS27_READY_FILE")
	dist := os.Getenv("XD_FILES_IOS27_DIST")
	if dsn == "" || readyPath == "" || dist == "" {
		t.Fatal("PostgreSQL DSN, private ready path and built Web dist are required")
	}
	if _, err := os.Stat(filepath.Join(dist, "index.html")); err != nil {
		t.Fatal(err)
	}

	gin.SetMode(gin.TestMode)
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{},
		&meta.File{}, &meta.FileVersion{}, &meta.ContentBlob{},
		&meta.Share{}, &meta.UploadSession{}, &meta.UploadPart{},
		&meta.DownloadProgress{}, &meta.AuditEvent{},
		&meta.FileOperation{}, &meta.FileRecentAccess{},
		&meta.FileFavorite{}, &meta.FileQuickAccess{},
		&meta.FileTag{}, &meta.FileNodeTag{}, &meta.FileSavedSearch{},
		&meta.Source{}, &meta.SyncRun{},
		&meta.PhotoIntelligenceReanalyzeIntent{},
		&meta.BackgroundOwnerCancellation{}, &meta.ArchivePrepareRun{},
	); err != nil {
		t.Fatal(err)
	}
	for _, index := range []string{
		"CREATE UNIQUE INDEX idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL",
		"CREATE UNIQUE INDEX idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL",
		"CREATE INDEX idx_xd_nodes_children_name ON xd_nodes(owner_id, parent_id, type, lower(name), id) WHERE parent_id IS NOT NULL AND deleted_at IS NULL",
	} {
		if err := db.Exec(index).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := meta.InstallNodeChangeJournal(db); err != nil {
		t.Fatal(err)
	}
	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	srv := &Server{
		DB: db, Store: local,
		Auth:           auth.New("files-ios27-real-go-isolated", time.Hour),
		RefreshTTL:     24 * time.Hour,
		AllowedOrigin:  "http://localhost",
		MaxUploadBytes: 10 << 20,
	}
	router := srv.Router()
	username := "ios27-files-owner"
	token := createTestUser(t, db, router, username, "test-only-owner-password")
	foreignToken := createTestUser(t, db, router, "ios27-files-other", "test-only-other-password")
	foreignRoot := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", foreignToken, nil, http.StatusOK)
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	file := uploadTestFile(t, router, token, root.ID, "document-001.txt", "actual PostgreSQL/CAS document")
	occupied := uploadTestFile(t, router, token, root.ID, "occupied.txt", "immutable collision sentinel")
	mobileTarget := requestNode(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID), token,
		strings.NewReader(`{"name":"mobile-copy-target"}`), http.StatusCreated)
	wideTarget := requestNode(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID), token,
		strings.NewReader(`{"name":"wide-copy-target"}`), http.StatusCreated)
	mobileMove := uploadTestFile(t, router, token, root.ID, "a-mobile-move.txt", "real mobile move source")
	wideMove := uploadTestFile(t, router, token, root.ID, "b-wide-move.txt", "real wide move source")
	mobileDelete := uploadTestFile(t, router, token, root.ID, "c-mobile-delete.txt", "real mobile delete source")
	wideDelete := uploadTestFile(t, router, token, root.ID, "d-wide-delete.txt", "real wide delete source")
	mobileBatchA := uploadTestFile(t, router, token, root.ID, "e-mobile-batch-a.txt", "real Mobile bulk delete one")
	mobileBatchB := uploadTestFile(t, router, token, root.ID, "f-mobile-batch-b.txt", "real Mobile bulk delete two")
	wideBatchA := uploadTestFile(t, router, token, root.ID, "g-wide-batch-a.txt", "real Wide bulk delete one")
	wideBatchB := uploadTestFile(t, router, token, root.ID, "h-wide-batch-b.txt", "real Wide bulk delete two")
	batchSource := requestNode(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID), token,
		strings.NewReader("{\"name\":\"batch-operation-sources\"}"), http.StatusCreated)
	mobileBatchCopyA := uploadTestFile(t, router, token, batchSource.ID, "i-mobile-batch-copy-a.txt", "real Mobile batch copy one")
	mobileBatchCopyB := uploadTestFile(t, router, token, batchSource.ID, "j-mobile-batch-copy-b.txt", "real Mobile batch copy two")
	wideBatchCopyA := uploadTestFile(t, router, token, batchSource.ID, "k-wide-batch-copy-a.txt", "real Wide batch copy one")
	wideBatchCopyB := uploadTestFile(t, router, token, batchSource.ID, "l-wide-batch-copy-b.txt", "real Wide batch copy two")
	mobileBatchMoveA := uploadTestFile(t, router, token, batchSource.ID, "m-mobile-batch-move-a.txt", "real Mobile batch move one")
	mobileBatchMoveB := uploadTestFile(t, router, token, batchSource.ID, "n-mobile-batch-move-b.txt", "real Mobile batch move two")
	wideBatchMoveA := uploadTestFile(t, router, token, batchSource.ID, "o-wide-batch-move-a.txt", "real Wide batch move one")
	wideBatchMoveB := uploadTestFile(t, router, token, batchSource.ID, "p-wide-batch-move-b.txt", "real Wide batch move two")
	mobileMoveTarget := requestNode(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID), token,
		strings.NewReader(`{"name":"mobile-move-target"}`), http.StatusCreated)
	wideMoveTarget := requestNode(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID), token,
		strings.NewReader(`{"name":"wide-move-target"}`), http.StatusCreated)
	// Cross-owner responses are the genuine product's 404 semantics, NOT the
	// synthetic 403 used by the earlier intercepted-HTTP Chrome matrix.
	request(t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/nodes/%d", file.ID), foreignToken, nil, http.StatusNotFound)
	requestWithHeaders(t, router, http.MethodPatch,
		fmt.Sprintf("/api/v1/nodes/%d", file.ID), foreignToken,
		strings.NewReader("{\"name\":\"foreign-rewrite.txt\"}"), http.StatusNotFound,
		map[string]string{"If-Match": fmt.Sprintf("\"%d\"", file.Revision)})

	stopped := make(chan struct{})
	var stopOnce sync.Once
	// Test-only barrier: the browser queues real requests before D3/D4
	// assertions, then remains live for Mobile/Wide Undo/Redo taps.
	executeStarted := make(chan struct{})
	executeDone := make(chan struct{})
	var executeOnce sync.Once
	var tapMu sync.Mutex
	tapIDs := make([]string, 0, 4)
	fileServer := http.FileServer(http.Dir(dist))
	mux := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/__test/files/execute" {
			if r.Method != http.MethodPost {
				http.Error(w, "POST required", http.StatusMethodNotAllowed)
				return
			}
			executeOnce.Do(func() { close(executeStarted) })
			select {
			case <-executeDone:
				w.WriteHeader(http.StatusNoContent)
			case <-r.Context().Done():
				return
			}
			return
		}
		if r.URL.Path == "/__test/files/process-next" {
			if r.Method != http.MethodPost {
				http.Error(w, "POST required", http.StatusMethodNotAllowed)
				return
			}
			select {
			case <-executeDone:
			default:
				http.Error(w, "original real-browser operation queue not yet verified", http.StatusConflict)
				return
			}
			tapMu.Lock()
			defer tapMu.Unlock()
			if len(tapIDs) >= 4 {
				http.Error(w, "real tap limit exceeded", http.StatusConflict)
				return
			}
			var pending []meta.FileOperation
			if err := db.Where("status = ?", meta.FileOperationStatusQueued).
				Find(&pending).Error; err != nil || len(pending) != 1 {
				http.Error(w, fmt.Sprintf("expected one queued UI task, got %d: %v", len(pending), err), http.StatusConflict)
				return
			}
			operationID := pending[0].ID
			processed, err := srv.processNextFileOperation(r.Context())
			if err != nil || !processed {
				http.Error(w, fmt.Sprintf("real Worker failed: processed=%v err=%v", processed, err), http.StatusInternalServerError)
				return
			}
			var done meta.FileOperation
			if err := db.Where("id = ?", operationID).First(&done).Error; err != nil ||
				done.Status != meta.FileOperationStatusCompleted {
				http.Error(w, fmt.Sprintf("real Worker did not complete UI task: %v %+v", err, done), http.StatusInternalServerError)
				return
			}
			tapIDs = append(tapIDs, operationID)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id": operationID, "type": done.Type, "status": done.Status,
			})
			return
		}
		if r.URL.Path == "/__test/files/finish" {
			if r.Method != http.MethodPost {
				http.Error(w, "POST required", http.StatusMethodNotAllowed)
				return
			}
			stopOnce.Do(func() { close(stopped) })
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			router.ServeHTTP(w, r)
			return
		}
		fileServer.ServeHTTP(w, r)
	})
	peer := httptest.NewServer(mux)
	defer peer.Close()
	// Only a private, non-artifact runner file contains the real JWTs.
	ready := map[string]any{
		"url":             peer.URL,
		"username":        username,
		"token":           token,
		"foreign_token":   foreignToken,
		"root_id":         root.ID,
		"node_id":         file.ID,
		"node_revision":   file.Revision,
		"collision_id":    occupied.ID,
		"postgresql":      true,
		"real_gin":        true,
		"intercepted_api": false,
	}
	ready["mobile_copy_target_id"] = mobileTarget.ID
	ready["wide_copy_target_id"] = wideTarget.ID
	ready["foreign_root_id"] = foreignRoot.ID
	ready["mobile_move_id"], ready["mobile_move_revision"] = mobileMove.ID, mobileMove.Revision
	ready["wide_move_id"], ready["wide_move_revision"] = wideMove.ID, wideMove.Revision
	ready["mobile_delete_id"], ready["mobile_delete_revision"] = mobileDelete.ID, mobileDelete.Revision
	ready["wide_delete_id"], ready["wide_delete_revision"] = wideDelete.ID, wideDelete.Revision
	ready["mobile_move_target_id"], ready["wide_move_target_id"] = mobileMoveTarget.ID, wideMoveTarget.ID
	ready["mobile_batch_delete_nodes"] = []map[string]any{
		{"id": mobileBatchA.ID, "revision": mobileBatchA.Revision, "name": mobileBatchA.Name},
		{"id": mobileBatchB.ID, "revision": mobileBatchB.Revision, "name": mobileBatchB.Name},
	}
	ready["wide_batch_delete_nodes"] = []map[string]any{
		{"id": wideBatchA.ID, "revision": wideBatchA.Revision, "name": wideBatchA.Name},
		{"id": wideBatchB.ID, "revision": wideBatchB.Revision, "name": wideBatchB.Name},
	}
	ready["batch_source_id"] = batchSource.ID
	ready["mobile_batch_copy_nodes"] = []map[string]any{
		{"id": mobileBatchCopyA.ID, "revision": mobileBatchCopyA.Revision, "name": mobileBatchCopyA.Name},
		{"id": mobileBatchCopyB.ID, "revision": mobileBatchCopyB.Revision, "name": mobileBatchCopyB.Name},
	}
	ready["wide_batch_copy_nodes"] = []map[string]any{
		{"id": wideBatchCopyA.ID, "revision": wideBatchCopyA.Revision, "name": wideBatchCopyA.Name},
		{"id": wideBatchCopyB.ID, "revision": wideBatchCopyB.Revision, "name": wideBatchCopyB.Name},
	}
	ready["mobile_batch_move_nodes"] = []map[string]any{
		{"id": mobileBatchMoveA.ID, "revision": mobileBatchMoveA.Revision, "name": mobileBatchMoveA.Name},
		{"id": mobileBatchMoveB.ID, "revision": mobileBatchMoveB.Revision, "name": mobileBatchMoveB.Name},
	}
	ready["wide_batch_move_nodes"] = []map[string]any{
		{"id": wideBatchMoveA.ID, "revision": wideBatchMoveA.Revision, "name": wideBatchMoveA.Name},
		{"id": wideBatchMoveB.ID, "revision": wideBatchMoveB.Revision, "name": wideBatchMoveB.Name},
	}
	payload, err := json.Marshal(ready)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(readyPath), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(readyPath, payload, 0600); err != nil {
		t.Fatal(err)
	}
	t.Logf("IOS27_FILES_LIVE_GO_READY url=%s root=%d node=%d revision=%d",
		peer.URL, root.ID, file.ID, file.Revision)

	select {
	case <-executeStarted:
		var after, collision meta.Node
		if err := db.First(&after, file.ID).Error; err != nil {
			t.Fatal(err)
		}
		if after.Name != "wide-accepted.txt" || after.Revision != file.Revision+2 ||
			after.ID != file.ID || after.OwnerID == 0 {
			t.Fatalf("live UI rename did not preserve Node ID, owner and two revisions: %+v", after)
		}
		if err := db.First(&collision, occupied.ID).Error; err != nil {
			t.Fatal(err)
		}
		if collision.Name != "occupied.txt" || collision.Revision != occupied.Revision {
			t.Fatalf("failed rename changed collision sentinel: %+v", collision)
		}
		// F09I-D6: real 375px Mobile and 1600px Wide created folders with
		// the same production Gin endpoint. Neither retry may clone the
		// existing collision sentinel or persist a cross-owner mutation.
		createdFolderIDs := make(map[uint64]bool)
		for _, name := range []string{"ios27-mobile-created", "ios27-wide-created"} {
			var children []meta.Node
			if err := db.Where("owner_id = ? AND parent_id = ? AND name = ?",
				after.OwnerID, root.ID, name).Find(&children).Error; err != nil {
				t.Fatal(err)
			}
			if len(children) != 1 || children[0].ID == 0 ||
				children[0].Type != meta.NodeTypeDir || createdFolderIDs[children[0].ID] {
				t.Fatalf("genuine UI create must persist one distinct owner directory: %s %+v",
					name, children)
			}
			createdFolderIDs[children[0].ID] = true
			request(t, router, http.MethodGet,
				fmt.Sprintf("/api/v1/nodes/%d", children[0].ID),
				foreignToken, nil, http.StatusNotFound)
			t.Logf("IOS27_FILES_REAL_FOLDER_CREATED name=%s id=%d parent=%d",
				name, children[0].ID, root.ID)
		}
		for _, original := range []nodeDTO{mobileTarget, wideTarget} {
			var unchanged meta.Node
			if err := db.First(&unchanged, original.ID).Error; err != nil {
				t.Fatal(err)
			}
			if unchanged.ID != original.ID || unchanged.Name != original.Name ||
				unchanged.Revision != original.Revision ||
				unchanged.ParentID == nil || *unchanged.ParentID != root.ID {
				t.Fatalf("409 duplicate must not change the original directory: before=%+v after=%+v",
					original, unchanged)
			}
		}
		var unauthorizedCreates int64
		if err := db.Model(&meta.Node{}).Where(
			"parent_id = ? AND name = ?", root.ID, "ios27-foreign-forbidden",
		).Count(&unauthorizedCreates).Error; err != nil || unauthorizedCreates != 0 {
			t.Fatalf("foreign-owner folder POST must not persist: count=%d err=%v",
				unauthorizedCreates, err)
		}
		t.Logf("IOS27_FILES_REAL_FOLDER_CREATES_VERIFIED count=%d", len(createdFolderIDs))
		var queued []meta.FileOperation
		if err := db.Where("owner_id = ? AND type = ? AND total_items = ?", after.OwnerID, meta.FileOperationTypeCopy, 1).
			Find(&queued).Error; err != nil {
			t.Fatal(err)
		}
		if len(queued) != 2 {
			t.Fatalf("expected exactly two genuine UI copy operations in PostgreSQL, got %d", len(queued))
		}
		targets := map[uint64]bool{mobileTarget.ID: false, wideTarget.ID: false}
		for _, operation := range queued {
			if operation.ParentID == nil {
				t.Fatalf("copy operation missing target: %+v", operation)
			}
			visited, allowed := targets[*operation.ParentID]
			if !allowed || visited || operation.TotalItems != 1 {
				t.Fatalf("unexpected duplicate/target/count in copy operation: %+v", operation)
			}
			var refs []batchNodeRef
			if err := json.Unmarshal([]byte(operation.ItemsJSON), &refs); err != nil {
				t.Fatal(err)
			}
			if len(refs) != 1 || refs[0].ID != after.ID || refs[0].Revision != after.Revision {
				t.Fatalf("copy operation did not persist the exact renamed Node revision: %+v", operation)
			}
			targets[*operation.ParentID] = true
		}
		for target, visited := range targets {
			if !visited {
				t.Fatalf("no UI copy operation persisted for target %d", target)
			}
		}
		// The queue is intentionally not executed in this fixture. Persisted
		// Move/Delete operation intents still must preserve exact source
		// identities, revisions, intended targets and owner boundaries.
		type mutationSource struct {
			revision uint64
			parentID uint64
		}
		for _, spec := range []struct {
			operation string
			expected  map[uint64]mutationSource
		}{
			{operation: meta.FileOperationTypeMove, expected: map[uint64]mutationSource{
				mobileMove.ID: {revision: mobileMove.Revision, parentID: mobileMoveTarget.ID},
				wideMove.ID:   {revision: wideMove.Revision, parentID: wideMoveTarget.ID},
			}},
			{operation: meta.FileOperationTypeDelete, expected: map[uint64]mutationSource{
				mobileDelete.ID: {revision: mobileDelete.Revision},
				wideDelete.ID:   {revision: wideDelete.Revision},
			}},
		} {
			var operations []meta.FileOperation
			if err := db.Where("owner_id = ? AND type = ? AND total_items = ?", after.OwnerID, spec.operation, 1).
				Find(&operations).Error; err != nil {
				t.Fatal(err)
			}
			if len(operations) != 2 {
				t.Fatalf("%s: expected exactly two UI operation rows, got %d", spec.operation, len(operations))
			}
			for _, operation := range operations {
				if operation.TotalItems != 1 {
					t.Fatalf("%s: unexpected batch count %+v", spec.operation, operation)
				}
				var refs []batchNodeRef
				if err := json.Unmarshal([]byte(operation.ItemsJSON), &refs); err != nil {
					t.Fatal(err)
				}
				if len(refs) != 1 {
					t.Fatalf("%s: expected one source ref, got %+v", spec.operation, refs)
				}
				want, ok := spec.expected[refs[0].ID]
				if !ok || refs[0].Revision != want.revision {
					t.Fatalf("%s: unauthorized, duplicate or stale source %+v", spec.operation, refs)
				}
				if spec.operation == meta.FileOperationTypeMove {
					if operation.ParentID == nil || *operation.ParentID != want.parentID {
						t.Fatalf("real UI Move target differs from PostgreSQL target: %+v", operation)
					}
				} else if operation.ParentID != nil {
					t.Fatalf("real UI Delete must not have a destination: %+v", operation)
				}
				delete(spec.expected, refs[0].ID)
			}
			if len(spec.expected) != 0 {
				t.Fatalf("%s: some UI mutation sources were not enqueued: %+v", spec.operation, spec.expected)
			}
			t.Logf("IOS27_FILES_LIVE_GO_MUTATION_QUEUED type=%s count=%d", spec.operation, len(operations))
		}
		// F09I-D1: independently verify the two REAL multi-select UI DELETEs
		// persisted as exactly two separate two-source queue records.
		var batchDeletes []meta.FileOperation
		if err := db.Where("owner_id = ? AND type = ? AND total_items = ?",
			after.OwnerID, meta.FileOperationTypeDelete, 2).
			Find(&batchDeletes).Error; err != nil {
			t.Fatal(err)
		}
		if len(batchDeletes) != 2 {
			t.Fatalf("expected two UI 2-item Delete queue records, got %d", len(batchDeletes))
		}
		expectedGroups := []map[uint64]uint64{
			{mobileBatchA.ID: mobileBatchA.Revision, mobileBatchB.ID: mobileBatchB.Revision},
			{wideBatchA.ID: wideBatchA.Revision, wideBatchB.ID: wideBatchB.Revision},
		}
		seenGroups := make([]bool, len(expectedGroups))
		for _, operation := range batchDeletes {
			if operation.ParentID != nil || operation.Status != meta.FileOperationStatusQueued ||
				operation.TotalItems != 2 {
				t.Fatalf("real UI batch Delete queued unexpected payload: %+v", operation)
			}
			var refs []batchNodeRef
			if err := json.Unmarshal([]byte(operation.ItemsJSON), &refs); err != nil {
				t.Fatal(err)
			}
			if len(refs) != 2 || refs[0].ID == refs[1].ID {
				t.Fatalf("multi-selection must persist two distinct Node refs: %+v", refs)
			}
			matched := -1
			for i, expected := range expectedGroups {
				wholeGroup := true
				for _, ref := range refs {
					revision, ok := expected[ref.ID]
					if !ok || revision != ref.Revision {
						wholeGroup = false
						break
					}
				}
				if wholeGroup {
					matched = i
					break
				}
			}
			if matched < 0 || seenGroups[matched] {
				t.Fatalf("mixed, duplicate or foreign batch Delete group: %+v", refs)
			}
			seenGroups[matched] = true
		}
		for index, seen := range seenGroups {
			if !seen {
				t.Fatalf("no persisted real UI batch Delete for group %d", index)
			}
		}
		t.Logf("IOS27_FILES_LIVE_GO_BATCH_DELETE_QUEUED count=%d items_per_operation=2", len(batchDeletes))
		// F09I-D2: exact four real two-file destination queue records.
		type destinationGroup struct {
			targetID  uint64
			revisions map[uint64]uint64
		}
		for _, spec := range []struct {
			kind   string
			groups []destinationGroup
		}{
			{kind: meta.FileOperationTypeCopy, groups: []destinationGroup{
				{targetID: mobileTarget.ID, revisions: map[uint64]uint64{
					mobileBatchCopyA.ID: mobileBatchCopyA.Revision, mobileBatchCopyB.ID: mobileBatchCopyB.Revision}},
				{targetID: wideTarget.ID, revisions: map[uint64]uint64{
					wideBatchCopyA.ID: wideBatchCopyA.Revision, wideBatchCopyB.ID: wideBatchCopyB.Revision}},
			}},
			{kind: meta.FileOperationTypeMove, groups: []destinationGroup{
				{targetID: mobileMoveTarget.ID, revisions: map[uint64]uint64{
					mobileBatchMoveA.ID: mobileBatchMoveA.Revision, mobileBatchMoveB.ID: mobileBatchMoveB.Revision}},
				{targetID: wideMoveTarget.ID, revisions: map[uint64]uint64{
					wideBatchMoveA.ID: wideBatchMoveA.Revision, wideBatchMoveB.ID: wideBatchMoveB.Revision}},
			}},
		} {
			var operations []meta.FileOperation
			if err := db.Where("owner_id = ? AND type = ? AND total_items = ?",
				after.OwnerID, spec.kind, 2).Find(&operations).Error; err != nil {
				t.Fatal(err)
			}
			if len(operations) != 2 {
				t.Fatalf("%s: expected two 2-source queue records, got %d", spec.kind, len(operations))
			}
			seen := make([]bool, len(spec.groups))
			for _, operation := range operations {
				if operation.Status != meta.FileOperationStatusQueued || operation.TotalItems != 2 ||
					operation.ParentID == nil {
					t.Fatalf("%s: incorrect destination/status: %+v", spec.kind, operation)
				}
				var refs []batchNodeRef
				if err := json.Unmarshal([]byte(operation.ItemsJSON), &refs); err != nil {
					t.Fatal(err)
				}
				if len(refs) != 2 || refs[0].ID == refs[1].ID {
					t.Fatalf("%s: two distinct source references required: %+v", spec.kind, refs)
				}
				matched := -1
				for i, group := range spec.groups {
					if *operation.ParentID != group.targetID {
						continue
					}
					valid := true
					for _, ref := range refs {
						want, ok := group.revisions[ref.ID]
						if !ok || ref.Revision != want {
							valid = false
							break
						}
					}
					if valid {
						matched = i
						break
					}
				}
				if matched < 0 || seen[matched] {
					t.Fatalf("%s: mixed/duplicate/foreign/stale batch destination: %+v", spec.kind, operation)
				}
				seen[matched] = true
			}
			for i, got := range seen {
				if !got {
					t.Fatalf("%s: missing persisted batch destination group %d", spec.kind, i)
				}
			}
			t.Logf("IOS27_FILES_LIVE_GO_BATCH_DESTINATION_QUEUED kind=%s count=2 items_per_operation=2", spec.kind)
		}
		var foreignAccount meta.User
		if err := db.Where("username = ?", "ios27-files-other").First(&foreignAccount).Error; err != nil {
			t.Fatal(err)
		}
		// The public Node DTO intentionally has no owner_id. Resolve the
		// foreign account from the real authentication database instead.
		var foreignOperations int64
		if err := db.Model(&meta.FileOperation{}).
			Where("owner_id = ?", foreignAccount.ID).Count(&foreignOperations).Error; err != nil {
			t.Fatal(err)
		}
		if foreignOperations != 0 {
			t.Fatalf("foreign owner must not persist a failed source mutation, got %d", foreignOperations)
		}
		t.Logf("IOS27_FILES_LIVE_GO_COPY_QUEUED count=%d source=%d revision=%d", len(queued), after.ID, after.Revision)
		t.Logf("IOS27_FILES_LIVE_GO_VERIFIED id=%d revision=%d name=%s owner=%d",
			after.ID, after.Revision, after.Name, after.OwnerID)
		// F09I-D3: only after genuine Chromium, owner-scoped queue and
		// PostgreSQL intent assertions, execute the production Worker.
		assertIOS27FilesLiveWorkerEffects(t, srv, db, router, peer.URL, token, after.OwnerID,
			[]ios27FilesWorkerEffect{
				{ID: file.ID, Revision: after.Revision, SourceParent: root.ID, TargetParent: mobileTarget.ID, Name: after.Name, Body: "actual PostgreSQL/CAS document"},
				{ID: file.ID, Revision: after.Revision, SourceParent: root.ID, TargetParent: wideTarget.ID, Name: after.Name, Body: "actual PostgreSQL/CAS document"},
				{ID: mobileBatchCopyA.ID, Revision: mobileBatchCopyA.Revision, SourceParent: batchSource.ID, TargetParent: mobileTarget.ID, Name: mobileBatchCopyA.Name, Body: "real Mobile batch copy one"},
				{ID: mobileBatchCopyB.ID, Revision: mobileBatchCopyB.Revision, SourceParent: batchSource.ID, TargetParent: mobileTarget.ID, Name: mobileBatchCopyB.Name, Body: "real Mobile batch copy two"},
				{ID: wideBatchCopyA.ID, Revision: wideBatchCopyA.Revision, SourceParent: batchSource.ID, TargetParent: wideTarget.ID, Name: wideBatchCopyA.Name, Body: "real Wide batch copy one"},
				{ID: wideBatchCopyB.ID, Revision: wideBatchCopyB.Revision, SourceParent: batchSource.ID, TargetParent: wideTarget.ID, Name: wideBatchCopyB.Name, Body: "real Wide batch copy two"},
			},
			[]ios27FilesWorkerEffect{
				{ID: mobileMove.ID, Revision: mobileMove.Revision, SourceParent: root.ID, TargetParent: mobileMoveTarget.ID, Name: mobileMove.Name, Body: "real mobile move source"},
				{ID: wideMove.ID, Revision: wideMove.Revision, SourceParent: root.ID, TargetParent: wideMoveTarget.ID, Name: wideMove.Name, Body: "real wide move source"},
				{ID: mobileBatchMoveA.ID, Revision: mobileBatchMoveA.Revision, SourceParent: batchSource.ID, TargetParent: mobileMoveTarget.ID, Name: mobileBatchMoveA.Name, Body: "real Mobile batch move one"},
				{ID: mobileBatchMoveB.ID, Revision: mobileBatchMoveB.Revision, SourceParent: batchSource.ID, TargetParent: mobileMoveTarget.ID, Name: mobileBatchMoveB.Name, Body: "real Mobile batch move two"},
				{ID: wideBatchMoveA.ID, Revision: wideBatchMoveA.Revision, SourceParent: batchSource.ID, TargetParent: wideMoveTarget.ID, Name: wideBatchMoveA.Name, Body: "real Wide batch move one"},
				{ID: wideBatchMoveB.ID, Revision: wideBatchMoveB.Revision, SourceParent: batchSource.ID, TargetParent: wideMoveTarget.ID, Name: wideBatchMoveB.Name, Body: "real Wide batch move two"},
			},
			[]ios27FilesWorkerEffect{
				{ID: mobileDelete.ID, Revision: mobileDelete.Revision, SourceParent: root.ID, Name: mobileDelete.Name, Body: "real mobile delete source"},
				{ID: wideDelete.ID, Revision: wideDelete.Revision, SourceParent: root.ID, Name: wideDelete.Name, Body: "real wide delete source"},
				{ID: mobileBatchA.ID, Revision: mobileBatchA.Revision, SourceParent: root.ID, Name: mobileBatchA.Name, Body: "real Mobile bulk delete one"},
				{ID: mobileBatchB.ID, Revision: mobileBatchB.Revision, SourceParent: root.ID, Name: mobileBatchB.Name, Body: "real Mobile bulk delete two"},
				{ID: wideBatchA.ID, Revision: wideBatchA.Revision, SourceParent: root.ID, Name: wideBatchA.Name, Body: "real Wide bulk delete one"},
				{ID: wideBatchB.ID, Revision: wideBatchB.Revision, SourceParent: root.ID, Name: wideBatchB.Name, Body: "real Wide bulk delete two"},
			})
		// F09I-D4: these two representative 2-source operations were submitted
		// by actual Mobile/Wide Chromium and completed by D3's real Worker.
		// Undo and Redo use authenticated HTTP + the SAME production executor.
		assertIOS27FilesLiveUndoRedo(t, srv, db, router, peer.URL, token, foreignToken,
			after.OwnerID,
			[]ios27FilesWorkerEffect{
				{ID: mobileBatchCopyA.ID, Revision: mobileBatchCopyA.Revision, SourceParent: batchSource.ID, TargetParent: mobileTarget.ID, Name: mobileBatchCopyA.Name, Body: "real Mobile batch copy one"},
				{ID: mobileBatchCopyB.ID, Revision: mobileBatchCopyB.Revision, SourceParent: batchSource.ID, TargetParent: mobileTarget.ID, Name: mobileBatchCopyB.Name, Body: "real Mobile batch copy two"},
			},
			[]ios27FilesWorkerEffect{
				{ID: wideBatchMoveA.ID, Revision: wideBatchMoveA.Revision, SourceParent: batchSource.ID, TargetParent: wideMoveTarget.ID, Name: wideBatchMoveA.Name, Body: "real Wide batch move one"},
				{ID: wideBatchMoveB.ID, Revision: wideBatchMoveB.Revision, SourceParent: batchSource.ID, TargetParent: wideMoveTarget.ID, Name: wideBatchMoveB.Name, Body: "real Wide batch move two"},
			})
		var casBeforeTaps int64
		if err := db.Model(&meta.ContentBlob{}).Count(&casBeforeTaps).Error; err != nil {
			t.Fatal(err)
		}
		close(executeDone)
		select {
		case <-stopped:
		case <-time.After(2 * time.Minute):
			t.Fatal("real Mobile/Wide Undo/Redo taps did not finish")
		}
		tapMu.Lock()
		observedTapIDs := append([]string(nil), tapIDs...)
		tapMu.Unlock()
		assertIOS27FilesLiveTapUndoRedo(t, db, peer.URL, token, after.OwnerID,
			observedTapIDs, casBeforeTaps, []ios27FilesWorkerEffect{
				{ID: wideBatchMoveA.ID, Revision: wideBatchMoveA.Revision, TargetParent: wideMoveTarget.ID, Body: "real Wide batch move one"},
				{ID: wideBatchMoveB.ID, Revision: wideBatchMoveB.Revision, TargetParent: wideMoveTarget.ID, Body: "real Wide batch move two"},
			})
	case <-stopped:
		t.Fatal("browser stopped before genuine Worker/Undo/Redo phases")
	case <-time.After(4 * time.Minute):
		t.Fatal("live browser did not finish the real Gin/PostgreSQL fixture")
	}
}
