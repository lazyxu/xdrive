package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestSourceScanProtocolIsIdempotentAndMissingSafe(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(
		&meta.SyncRun{}, &meta.SourceItem{}, &meta.Source{}, &meta.AuditEvent{}, &meta.Share{},
		&meta.UploadPart{}, &meta.UploadSession{}, &meta.ContentBlob{}, &meta.FileVersion{}, &meta.File{},
		&meta.Node{}, &meta.RefreshToken{}, &meta.User{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.AuditEvent{},
		&meta.Source{}, &meta.SourceItem{}, &meta.SyncRun{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_sources_owner_name ON xd_sources(owner_id, lower(name))`).Error; err != nil {
		t.Fatal(err)
	}

	router := (&Server{
		DB: db, Auth: auth.New("source-run-test-secret", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost",
	}).Router()
	token := createTestUser(t, db, router, "source-run-user", "password-a")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	target := requestNode(t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID),
		token, strings.NewReader(`{"name":"Synology"}`), http.StatusCreated)

	createBody := fmt.Sprintf(`{
		"name":"Synology Photos",
		"kind":"synology_photos",
		"direction":"push",
		"sync_mode":"backup",
		"run_mode":"scan",
		"target_node_id":%d,
		"ignore_rules":"@eaDir/\n"
	}`, target.ID)
	createdRes := request(t, router, http.MethodPost, "/api/v1/sources", token, strings.NewReader(createBody), http.StatusCreated)
	var source sourceDTO
	if err := json.Unmarshal(createdRes.Body.Bytes(), &source); err != nil {
		t.Fatal(err)
	}

	base := time.Date(2026, 9, 26, 1, 2, 3, 0, time.UTC)
	var owner meta.User
	if err := db.Where("username = ?", "source-run-user").First(&owner).Error; err != nil {
		t.Fatal(err)
	}
	makeMapped := func(name, externalID, path string, size int64) meta.SourceItem {
		n := meta.Node{ParentID: &target.ID, Name: name, Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1}
		if err := db.Create(&n).Error; err != nil {
			t.Fatal(err)
		}
		item := meta.SourceItem{
			SourceID: source.ID, ExternalID: externalID, NodeID: &n.ID, NodeRevision: n.Revision,
			Kind: meta.SourceItemKindFile, Path: path, Size: size, ModifiedAt: &base,
			State: meta.SourceItemStateSynced, LastSeenAt: base, LastSyncedAt: &base,
		}
		if err := db.Create(&item).Error; err != nil {
			t.Fatal(err)
		}
		return item
	}

	same := makeMapped("same.jpg", "same", "same.jpg", 100)
	changed := makeMapped("changed.jpg", "changed", "changed.jpg", 100)
	moved := makeMapped("moved.jpg", "moved", "old/moved.jpg", 50)
	missing := makeMapped("missing.jpg", "missing", "missing.jpg", 30)
	ignoredOld := makeMapped("ignored-old.jpg", "ignored-old", "@eaDir/old.jpg", 10)

	runID := uuid.NewString()
	beginBody := fmt.Sprintf(`{"run_id":%q,"trigger":"scheduled"}`, runID)
	beginRes := request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/sources/%d/runs", source.ID),
		token, strings.NewReader(beginBody), http.StatusCreated)
	var run syncRunDTO
	if err := json.Unmarshal(beginRes.Body.Bytes(), &run); err != nil {
		t.Fatal(err)
	}
	if run.ID != runID || run.Mode != meta.SourceRunModeScan || run.SourceRevision != source.Revision ||
		run.TargetNodeID == nil || *run.TargetNodeID != target.ID || run.IgnoreRules != "@eaDir/\n" {
		t.Fatalf("unexpected run snapshot: %+v", run)
	}

	// A lost begin response is safe to retry with the same client-generated run ID.
	request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/sources/%d/runs", source.ID),
		token, strings.NewReader(beginBody), http.StatusOK)
	heartbeatPath := fmt.Sprintf("/api/v1/sources/%d/runs/%s/heartbeat", source.ID, runID)
	request(t, router, http.MethodPost, heartbeatPath, token, strings.NewReader(`{}`), http.StatusNoContent)
	otherRun := fmt.Sprintf(`{"run_id":%q,"trigger":"scheduled"}`, uuid.NewString())
	request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/sources/%d/runs", source.ID),
		token, strings.NewReader(otherRun), http.StatusConflict)

	observeBody := fmt.Sprintf(`{"items":[
		{"external_id":"new","kind":"file","path":"new.jpg","size":200,"modified_at":%q},
		{"external_id":"ignored-new","kind":"file","path":"@eaDir/thumb.jpg","size":9,"modified_at":%q},
		{"external_id":"same","kind":"file","path":"same.jpg","size":100,"modified_at":%q},
		{"external_id":"changed","kind":"file","path":"changed.jpg","size":101,"modified_at":%q},
		{"external_id":"moved","kind":"file","path":"new/moved.jpg","size":50,"modified_at":%q}
	]}`, base.Format(time.RFC3339Nano), base.Format(time.RFC3339Nano), base.Format(time.RFC3339Nano),
		base.Add(time.Minute).Format(time.RFC3339Nano), base.Format(time.RFC3339Nano))
	observePath := fmt.Sprintf("/api/v1/sources/%d/runs/%s/observe", source.ID, runID)
	observed := request(t, router, http.MethodPost, observePath, token, strings.NewReader(observeBody), http.StatusOK)
	var planResp observeSourceRunResponse
	if err := json.Unmarshal(observed.Body.Bytes(), &planResp); err != nil {
		t.Fatal(err)
	}
	assertSourcePlans(t, planResp.Plans, map[string]string{
		"new": "create", "ignored-new": "ignore", "same": "unchanged", "changed": "update", "moved": "move",
	})

	// Observation retries do not advance the managed baseline, so they return the same plans.
	retried := request(t, router, http.MethodPost, observePath, token, strings.NewReader(observeBody), http.StatusOK)
	var retryPlans observeSourceRunResponse
	if err := json.Unmarshal(retried.Body.Bytes(), &retryPlans); err != nil {
		t.Fatal(err)
	}
	assertSourcePlans(t, retryPlans.Plans, map[string]string{
		"new": "create", "ignored-new": "ignore", "same": "unchanged", "changed": "update", "moved": "move",
	})

	var ignoredNewCount int64
	if err := db.Model(&meta.SourceItem{}).Where("source_id = ? AND external_id = ?", source.ID, "ignored-new").
		Count(&ignoredNewCount).Error; err != nil {
		t.Fatal(err)
	}
	if ignoredNewCount != 0 {
		t.Fatalf("first-seen ignored item was persisted: %d", ignoredNewCount)
	}

	finishBody := `{
		"status":"completed",
		"complete_inventory":true,
		"summary":{
			"scanned_items":5,
			"scanned_bytes":460,
			"ignored_items":1,
			"ignored_bytes":9,
			"new_items":1,
			"new_bytes":200,
			"changed_items":1,
			"changed_bytes":101,
			"moved_items":1,
			"unchanged_items":1,
			"unchanged_bytes":100,
			"planned_transfer_items":2,
			"planned_transfer_bytes":301,
			"failed_items":0
		}
	}`
	finishPath := fmt.Sprintf("/api/v1/sources/%d/runs/%s/finish", source.ID, runID)
	finishedRes := request(t, router, http.MethodPost, finishPath, token, strings.NewReader(finishBody), http.StatusOK)
	var finished syncRunDTO
	if err := json.Unmarshal(finishedRes.Body.Bytes(), &finished); err != nil {
		t.Fatal(err)
	}
	if finished.Status != meta.SyncRunStatusCompleted || finished.MissingItems != 1 || finished.MissingBytes != 30 ||
		finished.PlannedTransferItems != 2 || finished.PlannedTransferBytes != 301 {
		t.Fatalf("unexpected finished run: %+v", finished)
	}

	// Finish is idempotent when the response is lost.
	request(t, router, http.MethodPost, finishPath, token, strings.NewReader(finishBody), http.StatusOK)
	request(t, router, http.MethodPost, heartbeatPath, token, strings.NewReader(`{}`), http.StatusConflict)

	assertSourceItemState(t, db, same.ID, meta.SourceItemStateSynced, "same.jpg", 100)
	assertSourceItemState(t, db, changed.ID, meta.SourceItemStatePending, "changed.jpg", 100)
	assertSourceItemState(t, db, moved.ID, meta.SourceItemStatePending, "old/moved.jpg", 50)
	assertSourceItemState(t, db, missing.ID, meta.SourceItemStateMissing, "missing.jpg", 30)
	assertSourceItemState(t, db, ignoredOld.ID, meta.SourceItemStateIgnored, "@eaDir/old.jpg", 10)

	var latestSource meta.Source
	if err := db.First(&latestSource, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if latestSource.LastSuccessAt == nil || latestSource.LastError != "" {
		t.Fatalf("source success state not recorded: %+v", latestSource)
	}

	// A failed traversal must never infer source-side deletion, even if a buggy
	// connector incorrectly claims complete_inventory=true.
	run2 := uuid.NewString()
	begin2 := fmt.Sprintf(`{"run_id":%q,"trigger":"scheduled"}`, run2)
	request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/sources/%d/runs", source.ID),
		token, strings.NewReader(begin2), http.StatusCreated)
	finish2 := fmt.Sprintf(`{"status":"failed","complete_inventory":true,"error":"scan interrupted","summary":{"failed_items":1}}`)
	request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/sources/%d/runs/%s/finish", source.ID, run2),
		token, strings.NewReader(finish2), http.StatusOK)
	var sameAfter meta.SourceItem
	if err := db.First(&sameAfter, same.ID).Error; err != nil {
		t.Fatal(err)
	}
	if sameAfter.State != meta.SourceItemStateSynced {
		t.Fatalf("incomplete scan changed unseen synced item to %q", sameAfter.State)
	}
}

func assertSourcePlans(t *testing.T, plans []sourcePlanDTO, want map[string]string) {
	t.Helper()
	if len(plans) != len(want) {
		t.Fatalf("plans=%d want=%d: %+v", len(plans), len(want), plans)
	}
	for _, plan := range plans {
		action, ok := want[plan.ExternalID]
		if !ok {
			t.Fatalf("unexpected plan: %+v", plan)
		}
		if plan.Action != action {
			t.Fatalf("plan %q action=%q want=%q", plan.ExternalID, plan.Action, action)
		}
		if action != "create" && action != "ignore" && plan.NodeID == nil {
			t.Fatalf("managed plan %q did not expose node identity: %+v", plan.ExternalID, plan)
		}
	}
}

func assertSourceItemState(t *testing.T, db *gorm.DB, id uint64, state, path string, size int64) {
	t.Helper()
	var item meta.SourceItem
	if err := db.First(&item, id).Error; err != nil {
		t.Fatal(err)
	}
	if item.State != state || item.Path != path || item.Size != size {
		t.Fatalf("source item %d = state=%q path=%q size=%d; want %q %q %d",
			id, item.State, item.Path, item.Size, state, path, size)
	}
}

func TestSourceExecutionCommitIsIdempotentAndRevisionAware(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(
		&meta.SyncRun{}, &meta.SourceItem{}, &meta.Source{}, &meta.AuditEvent{}, &meta.Share{},
		&meta.UploadPart{}, &meta.UploadSession{}, &meta.ContentBlob{}, &meta.FileVersion{}, &meta.File{},
		&meta.Node{}, &meta.RefreshToken{}, &meta.User{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}, &meta.AuditEvent{},
		&meta.Source{}, &meta.SourceItem{}, &meta.SyncRun{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_sources_owner_name ON xd_sources(owner_id, lower(name))`).Error; err != nil {
		t.Fatal(err)
	}

	router := (&Server{
		DB: db, Auth: auth.New("source-commit-test-secret", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost",
	}).Router()
	token := createTestUser(t, db, router, "source-commit-user", "password-a")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	target := requestNode(t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID),
		token, strings.NewReader(`{"name":"Synology"}`), http.StatusCreated)

	createBody := fmt.Sprintf(`{
		"name":"Synology Photos",
		"kind":"synology_photos",
		"direction":"push",
		"sync_mode":"backup",
		"run_mode":"sync",
		"target_node_id":%d
	}`, target.ID)
	createdRes := request(t, router, http.MethodPost, "/api/v1/sources", token, strings.NewReader(createBody), http.StatusCreated)
	var source sourceDTO
	if err := json.Unmarshal(createdRes.Body.Bytes(), &source); err != nil {
		t.Fatal(err)
	}

	var owner meta.User
	if err := db.Where("username = ?", "source-commit-user").First(&owner).Error; err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 9, 26, 3, 0, 0, 0, time.UTC)
	const sourceHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	const changedHash = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

	photoNode := meta.Node{
		ParentID: &target.ID, Name: "photo.jpg", Type: meta.NodeTypeFile,
		OwnerID: owner.ID, Revision: 1,
	}
	if err := db.Create(&photoNode).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{
		NodeID: photoNode.ID, Size: 10, StorageKey: "test/photo", SHA256: sourceHash,
	}).Error; err != nil {
		t.Fatal(err)
	}
	photoItem := meta.SourceItem{
		SourceID: source.ID, ExternalID: "photo", NodeID: &photoNode.ID, NodeRevision: 1,
		Kind: meta.SourceItemKindFile, Path: "photo.jpg", Size: 10, ModifiedAt: &base,
		SHA256: sourceHash, State: meta.SourceItemStateSynced,
		LastSeenAt: base, LastSyncedAt: &base,
	}
	if err := db.Create(&photoItem).Error; err != nil {
		t.Fatal(err)
	}

	// Simulate an xDrive-side edit after the previous source sync.
	if err := db.Model(&meta.File{}).Where("node_id = ?", photoNode.ID).
		Updates(map[string]any{"size": 11, "sha256": changedHash}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.Node{}).Where("id = ?", photoNode.ID).
		Update("revision", 2).Error; err != nil {
		t.Fatal(err)
	}

	runID := uuid.NewString()
	beginBody := fmt.Sprintf(`{"run_id":%q,"trigger":"scheduled"}`, runID)
	request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/sources/%d/runs", source.ID),
		token, strings.NewReader(beginBody), http.StatusCreated)

	observeBody := fmt.Sprintf(`{"items":[
		{"external_id":"photo","kind":"file","path":"photo.jpg","size":10,"modified_at":%q},
		{"external_id":"newdir","kind":"directory","path":"newdir","size":0},
		{"external_id":"leftpending","kind":"directory","path":"leftpending","size":0}
	]}`, base.Format(time.RFC3339Nano))
	observePath := fmt.Sprintf("/api/v1/sources/%d/runs/%s/observe", source.ID, runID)
	observed := request(t, router, http.MethodPost, observePath, token, strings.NewReader(observeBody), http.StatusOK)
	var plans observeSourceRunResponse
	if err := json.Unmarshal(observed.Body.Bytes(), &plans); err != nil {
		t.Fatal(err)
	}
	assertSourcePlans(t, plans.Plans, map[string]string{
		"photo":       "move_update",
		"newdir":      "create",
		"leftpending": "create",
	})

	// Simulate the executor restoring source content. Generic node/file mutation
	// already uses revision preconditions; commit records only the final state.
	if err := db.Model(&meta.File{}).Where("node_id = ?", photoNode.ID).
		Updates(map[string]any{"size": 10, "sha256": sourceHash}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.Node{}).Where("id = ?", photoNode.ID).
		Update("revision", 3).Error; err != nil {
		t.Fatal(err)
	}

	commitPath := fmt.Sprintf("/api/v1/sources/%d/runs/%s/commit", source.ID, runID)
	photoCommit := fmt.Sprintf(`{"items":[{
		"external_id":"photo",
		"action":"move_update",
		"node_id":%d,
		"node_revision":3,
		"kind":"file",
		"path":"photo.jpg",
		"size":10,
		"modified_at":%q,
		"sha256":"%s",
		"transferred":true,
		"transferred_bytes":10
	}]}`, photoNode.ID, base.Format(time.RFC3339Nano), sourceHash)
	request(t, router, http.MethodPost, commitPath, token, strings.NewReader(photoCommit), http.StatusNoContent)

	var synced meta.SourceItem
	if err := db.First(&synced, photoItem.ID).Error; err != nil {
		t.Fatal(err)
	}
	if synced.State != meta.SourceItemStateSynced || synced.NodeRevision != 3 ||
		synced.LastSyncedRunID != runID || synced.SHA256 != sourceHash {
		t.Fatalf("unexpected committed source item: %+v", synced)
	}
	var run meta.SyncRun
	if err := db.First(&run, "id = ?", runID).Error; err != nil {
		t.Fatal(err)
	}
	if run.UpdatedItems != 1 || run.TransferredItems != 1 || run.TransferredBytes != 10 {
		t.Fatalf("unexpected execution counters: %+v", run)
	}

	// A lost commit response can be retried without double-counting.
	request(t, router, http.MethodPost, commitPath, token, strings.NewReader(photoCommit), http.StatusNoContent)
	if err := db.First(&run, "id = ?", runID).Error; err != nil {
		t.Fatal(err)
	}
	if run.UpdatedItems != 1 || run.TransferredItems != 1 || run.TransferredBytes != 10 {
		t.Fatalf("idempotent commit changed counters: %+v", run)
	}

	wrongDir := meta.Node{
		ParentID: &target.ID, Name: "wrongdir", Type: meta.NodeTypeDir,
		OwnerID: owner.ID, Revision: 1,
	}
	if err := db.Create(&wrongDir).Error; err != nil {
		t.Fatal(err)
	}
	wrongCommit := fmt.Sprintf(`{"items":[{
		"external_id":"newdir",
		"action":"create",
		"node_id":%d,
		"node_revision":1,
		"kind":"directory",
		"path":"newdir",
		"size":0
	}]}`, wrongDir.ID)
	request(t, router, http.MethodPost, commitPath, token, strings.NewReader(wrongCommit), http.StatusConflict)

	if err := db.Model(&meta.Node{}).Where("id = ?", wrongDir.ID).
		Updates(map[string]any{"name": "newdir", "revision": 2}).Error; err != nil {
		t.Fatal(err)
	}
	goodCommit := fmt.Sprintf(`{"items":[{
		"external_id":"newdir",
		"action":"create",
		"node_id":%d,
		"node_revision":2,
		"kind":"directory",
		"path":"newdir",
		"size":0
	}]}`, wrongDir.ID)
	request(t, router, http.MethodPost, commitPath, token, strings.NewReader(goodCommit), http.StatusNoContent)

	var newDirItem meta.SourceItem
	if err := db.Where("source_id = ? AND external_id = ?", source.ID, "newdir").First(&newDirItem).Error; err != nil {
		t.Fatal(err)
	}
	if newDirItem.NodeID == nil || *newDirItem.NodeID != wrongDir.ID ||
		newDirItem.NodeRevision != 2 || newDirItem.State != meta.SourceItemStateSynced {
		t.Fatalf("unexpected created source mapping: %+v", newDirItem)
	}
	if err := db.First(&run, "id = ?", runID).Error; err != nil {
		t.Fatal(err)
	}
	if run.CreatedItems != 1 || run.UpdatedItems != 1 {
		t.Fatalf("unexpected create/update counters: %+v", run)
	}

	// A buggy executor cannot report a successful sync while planned work remains
	// pending. The server derives this from persisted SourceItem state.
	finishBody := `{
		"status":"completed",
		"complete_inventory":true,
		"summary":{
			"scanned_items":3,
			"scanned_bytes":10,
			"new_items":2,
			"new_bytes":0,
			"changed_items":1,
			"changed_bytes":10,
			"moved_items":1,
			"planned_transfer_items":1,
			"planned_transfer_bytes":10,
			"failed_items":0
		}
	}`
	finishPath := fmt.Sprintf("/api/v1/sources/%d/runs/%s/finish", source.ID, runID)
	finishRes := request(t, router, http.MethodPost, finishPath, token, strings.NewReader(finishBody), http.StatusOK)
	var finished syncRunDTO
	if err := json.Unmarshal(finishRes.Body.Bytes(), &finished); err != nil {
		t.Fatal(err)
	}
	if finished.Status != meta.SyncRunStatusPartial || finished.FailedItems != 1 {
		t.Fatalf("pending execution did not downgrade run: %+v", finished)
	}

	var latestSource meta.Source
	if err := db.First(&latestSource, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if latestSource.LastSuccessAt != nil {
		t.Fatalf("partial sync unexpectedly advanced last_success_at: %+v", latestSource)
	}
}
