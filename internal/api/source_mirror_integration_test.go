package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func openMirrorTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := strings.TrimSpace(os.Getenv("XD_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	base, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "source_mirror_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := base.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = base.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error
	})

	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{},
		&meta.Share{}, &meta.AuditEvent{},
		&meta.Source{}, &meta.SourceItem{}, &meta.SourceItemAlias{},
		&meta.SyncRun{}, &meta.SourceRunFailure{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_parent_name
		ON xd_nodes(owner_id, parent_id, lower(name))
		WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_root_owner
		ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_sources_owner_name
		ON xd_sources(owner_id, lower(name))`).Error; err != nil {
		t.Fatal(err)
	}
	return db
}

func TestMirrorFinishRequiresTwoCompleteSuccessfulInventoriesAndGrace(t *testing.T) {
	db := openMirrorTestDB(t)
	router := (&Server{
		DB:            db,
		Auth:          auth.New("source-mirror-test-secret", time.Hour),
		RefreshTTL:    24 * time.Hour,
		AllowedOrigin: "http://localhost",
	}).Router()
	token := createTestUser(t, db, router, "source-mirror-user", "password-a")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	target := requestNode(
		t,
		router,
		http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID),
		token,
		strings.NewReader(`{"name":"Mirror"}`),
		http.StatusCreated,
	)

	createBody := fmt.Sprintf(`{
		"name":"Mirror Source",
		"kind":"synology_photos",
		"direction":"push",
		"sync_mode":"mirror",
		"run_mode":"sync",
		"target_node_id":%d
	}`, target.ID)
	createdRes := request(
		t, router, http.MethodPost, "/api/v1/sources",
		token, strings.NewReader(createBody), http.StatusCreated,
	)
	var source sourceDTO
	if err := json.Unmarshal(createdRes.Body.Bytes(), &source); err != nil {
		t.Fatal(err)
	}
	if source.SyncMode != meta.SourceSyncModeMirror {
		t.Fatalf("sync mode=%q want mirror", source.SyncMode)
	}

	var owner meta.User
	if err := db.Where("username = ?", "source-mirror-user").First(&owner).Error; err != nil {
		t.Fatal(err)
	}
	node := meta.Node{
		ParentID: &target.ID,
		Name:     "deleted-remotely.jpg",
		Type:     meta.NodeTypeFile,
		OwnerID:  owner.ID,
		Revision: 1,
	}
	returnedNode := meta.Node{
		ParentID: &target.ID,
		Name:     "returned.jpg",
		Type:     meta.NodeTypeFile,
		OwnerID:  owner.ID,
		Revision: 1,
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&returnedNode).Error; err != nil {
		t.Fatal(err)
	}
	item := meta.SourceItem{
		SourceID:     source.ID,
		ExternalID:   "remote:file-1",
		NodeID:       &node.ID,
		NodeRevision: node.Revision,
		Kind:         meta.SourceItemKindFile,
		Path:         node.Name,
		Size:         10,
		State:        meta.SourceItemStateSynced,
		LastSeenAt:   time.Now().UTC().Add(-48 * time.Hour),
	}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}
	finishComplete := `{"status":"completed","complete_inventory":true,"summary":{}}`
	firstRunID := uuid.NewString()
	firstRun := request(
		t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/sources/%d/runs", source.ID),
		token,
		strings.NewReader(fmt.Sprintf(`{"run_id":%q,"trigger":"scheduled"}`, firstRunID)),
		http.StatusCreated,
	)
	var firstSnapshot syncRunDTO
	if err := json.Unmarshal(firstRun.Body.Bytes(), &firstSnapshot); err != nil {
		t.Fatal(err)
	}
	if firstSnapshot.SyncMode != meta.SourceSyncModeMirror {
		t.Fatalf("run sync mode=%q want mirror", firstSnapshot.SyncMode)
	}
	request(
		t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/sources/%d/runs/%s/finish", source.ID, firstRunID),
		token, strings.NewReader(finishComplete), http.StatusOK,
	)

	var afterFirst meta.SourceItem
	if err := db.First(&afterFirst, item.ID).Error; err != nil {
		t.Fatal(err)
	}
	if afterFirst.State != meta.SourceItemStateMissing ||
		afterFirst.MirrorMissingFullScans != 1 ||
		afterFirst.MirrorMissingSince == nil {
		t.Fatalf("first mirror evidence=%+v", afterFirst)
	}
	var activeAfterFirst int64
	if err := db.Model(&meta.Node{}).
		Where("id = ? AND deleted_at IS NULL", node.ID).
		Count(&activeAfterFirst).Error; err != nil {
		t.Fatal(err)
	}
	if activeAfterFirst != 1 {
		t.Fatal("first missing inventory trashed the node")
	}

	matureSince := time.Now().UTC().Add(-sourcepkg.MirrorMissingGrace - time.Minute)
	if err := db.Model(&meta.SourceItem{}).
		Where("id = ?", item.ID).
		Update("mirror_missing_since", matureSince).Error; err != nil {
		t.Fatal(err)
	}

	oldEvidenceSince := time.Now().UTC().Add(-48 * time.Hour)
	returnedItem := meta.SourceItem{
		SourceID:               source.ID,
		ExternalID:             "remote:return",
		NodeID:                 &returnedNode.ID,
		NodeRevision:           returnedNode.Revision,
		Kind:                   meta.SourceItemKindFile,
		Path:                   returnedNode.Name,
		Size:                   5,
		State:                  meta.SourceItemStateMissing,
		MirrorMissingFullScans: 1,
		MirrorMissingSince:     &oldEvidenceSince,
		LastSeenAt:             oldEvidenceSince,
	}
	if err := db.Create(&returnedItem).Error; err != nil {
		t.Fatal(err)
	}

	secondRunID := uuid.NewString()
	request(
		t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/sources/%d/runs", source.ID),
		token,
		strings.NewReader(fmt.Sprintf(`{"run_id":%q,"trigger":"scheduled"}`, secondRunID)),
		http.StatusCreated,
	)
	request(
		t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/sources/%d/runs/%s/observe", source.ID, secondRunID),
		token,
		strings.NewReader(`{"items":[{"external_id":"remote:return","kind":"file","path":"returned.jpg","size":5}]}`),
		http.StatusOK,
	)
	var returnedAfterObserve meta.SourceItem
	if err := db.First(&returnedAfterObserve, returnedItem.ID).Error; err != nil {
		t.Fatal(err)
	}
	if returnedAfterObserve.MirrorMissingFullScans != 0 ||
		returnedAfterObserve.MirrorMissingSince != nil ||
		returnedAfterObserve.State != meta.SourceItemStateSynced {
		t.Fatalf("reappeared item kept mirror deletion evidence: %+v", returnedAfterObserve)
	}

	secondFinish := request(
		t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/sources/%d/runs/%s/finish", source.ID, secondRunID),
		token, strings.NewReader(finishComplete), http.StatusOK,
	)
	var secondSnapshot syncRunDTO
	if err := json.Unmarshal(secondFinish.Body.Bytes(), &secondSnapshot); err != nil {
		t.Fatal(err)
	}
	if secondSnapshot.DeletedItems != 1 || secondSnapshot.MissingItems != 1 {
		t.Fatalf("second mirror result=%+v", secondSnapshot)
	}

	var trashed meta.Node
	if err := db.First(&trashed, node.ID).Error; err != nil {
		t.Fatal(err)
	}
	if trashed.DeletedAt == nil || trashed.TrashRootID == nil || *trashed.TrashRootID != node.ID {
		t.Fatalf("mirror node was not moved to trash: %+v", trashed)
	}
	var audits []meta.AuditEvent
	if err := db.Where("action = ?", "source.mirror.trash").
		Order("id ASC").
		Find(&audits).Error; err != nil {
		t.Fatal(err)
	}
	if len(audits) != 1 ||
		audits[0].TargetID != fmt.Sprintf("%d", node.ID) ||
		!strings.Contains(audits[0].Metadata, secondRunID) {
		t.Fatalf("mirror trash audit=%+v", audits)
	}
}

func TestMirrorPartialFailedCancelledAndChangedSourceDoNotAdvanceDeletionEvidence(t *testing.T) {
	db := openMirrorTestDB(t)
	router := (&Server{
		DB:            db,
		Auth:          auth.New("source-mirror-gate-secret", time.Hour),
		RefreshTTL:    24 * time.Hour,
		AllowedOrigin: "http://localhost",
	}).Router()
	token := createTestUser(t, db, router, "source-mirror-gate-user", "password-a")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	target := requestNode(
		t,
		router,
		http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID),
		token,
		strings.NewReader(`{"name":"Mirror Gate"}`),
		http.StatusCreated,
	)
	createBody := fmt.Sprintf(`{
		"name":"Mirror Gate Source",
		"kind":"synology_photos",
		"direction":"push",
		"sync_mode":"mirror",
		"run_mode":"sync",
		"target_node_id":%d
	}`, target.ID)
	createdRes := request(
		t, router, http.MethodPost, "/api/v1/sources",
		token, strings.NewReader(createBody), http.StatusCreated,
	)
	var source sourceDTO
	if err := json.Unmarshal(createdRes.Body.Bytes(), &source); err != nil {
		t.Fatal(err)
	}

	var owner meta.User
	if err := db.Where("username = ?", "source-mirror-gate-user").First(&owner).Error; err != nil {
		t.Fatal(err)
	}
	node := meta.Node{
		ParentID: &target.ID,
		Name:     "guarded.jpg",
		Type:     meta.NodeTypeFile,
		OwnerID:  owner.ID,
		Revision: 1,
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	item := meta.SourceItem{
		SourceID:     source.ID,
		ExternalID:   "guarded",
		NodeID:       &node.ID,
		NodeRevision: node.Revision,
		Kind:         meta.SourceItemKindFile,
		Path:         node.Name,
		State:        meta.SourceItemStateSynced,
		LastSeenAt:   time.Now().UTC().Add(-48 * time.Hour),
	}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}

	beginRun := func(trigger string) string {
		t.Helper()
		runID := uuid.NewString()
		request(
			t, router, http.MethodPost,
			fmt.Sprintf("/api/v1/sources/%d/runs", source.ID),
			token,
			strings.NewReader(fmt.Sprintf(`{"run_id":%q,"trigger":%q}`, runID, trigger)),
			http.StatusCreated,
		)
		return runID
	}
	assertNoEvidence := func(label string) {
		t.Helper()
		var got meta.SourceItem
		if err := db.First(&got, item.ID).Error; err != nil {
			t.Fatal(err)
		}
		if got.MirrorMissingFullScans != 0 || got.MirrorMissingSince != nil {
			t.Fatalf("%s advanced mirror evidence: %+v", label, got)
		}
		var active int64
		if err := db.Model(&meta.Node{}).
			Where("id = ? AND deleted_at IS NULL", node.ID).
			Count(&active).Error; err != nil {
			t.Fatal(err)
		}
		if active != 1 {
			t.Fatalf("%s trashed guarded node", label)
		}
	}

	partialRun := beginRun("scheduled")
	request(
		t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/sources/%d/runs/%s/finish", source.ID, partialRun),
		token,
		strings.NewReader(`{"status":"partial","complete_inventory":true,"summary":{}}`),
		http.StatusOK,
	)
	assertNoEvidence("partial")

	failedRun := beginRun("scheduled")
	request(
		t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/sources/%d/runs/%s/finish", source.ID, failedRun),
		token,
		strings.NewReader(`{"status":"failed","complete_inventory":true,"error":"inventory failed","summary":{}}`),
		http.StatusOK,
	)
	assertNoEvidence("failed")

	cancelledRun := beginRun("manual")
	request(
		t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/sources/%d/runs/%s/cancel", source.ID, cancelledRun),
		token,
		strings.NewReader(`{}`),
		http.StatusAccepted,
	)
	request(
		t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/sources/%d/runs/%s/finish", source.ID, cancelledRun),
		token,
		strings.NewReader(`{"status":"completed","complete_inventory":true,"summary":{}}`),
		http.StatusOK,
	)
	assertNoEvidence("cancelled")
	var auditCount int64
	if err := db.Model(&meta.AuditEvent{}).
		Where("action = ?", "source.mirror.trash").
		Count(&auditCount).Error; err != nil {
		t.Fatal(err)
	}
	if auditCount != 0 {
		t.Fatalf("non-completed mirror runs created %d trash audit events", auditCount)
	}

	// A configuration revision change after begin invalidates that run as
	// deletion evidence even when it later reports a complete inventory.
	revisionRun := beginRun("scheduled")
	if err := db.Model(&meta.Source{}).
		Where("id = ?", source.ID).
		Updates(map[string]any{
			"name":     "Mirror Gate Source Renamed",
			"revision": gorm.Expr("revision + 1"),
		}).Error; err != nil {
		t.Fatal(err)
	}
	request(
		t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/sources/%d/runs/%s/finish", source.ID, revisionRun),
		token,
		strings.NewReader(`{"status":"completed","complete_inventory":true,"summary":{}}`),
		http.StatusOK,
	)
	assertNoEvidence("source revision changed")
}

func TestMirrorProtectsLocalChangesAndMixedDirectories(t *testing.T) {
	db := openMirrorTestDB(t)
	owner := meta.User{
		Username:       "mirror-local-owner",
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	target := meta.Node{
		ParentID: &root.ID, Name: "target", Type: meta.NodeTypeDir,
		OwnerID: owner.ID, Revision: 1,
	}
	if err := db.Create(&target).Error; err != nil {
		t.Fatal(err)
	}
	dir := meta.Node{
		ParentID: &target.ID, Name: "folder", Type: meta.NodeTypeDir,
		OwnerID: owner.ID, Revision: 1,
	}
	if err := db.Create(&dir).Error; err != nil {
		t.Fatal(err)
	}
	sourceChild := meta.Node{
		ParentID: &dir.ID, Name: "remote.jpg", Type: meta.NodeTypeFile,
		OwnerID: owner.ID, Revision: 1,
	}
	manualChild := meta.Node{
		ParentID: &dir.ID, Name: "local-note.txt", Type: meta.NodeTypeFile,
		OwnerID: owner.ID, Revision: 1,
	}
	locallyChanged := meta.Node{
		ParentID: &target.ID, Name: "changed-local.jpg", Type: meta.NodeTypeFile,
		OwnerID: owner.ID, Revision: 2,
	}
	restoredDir := meta.Node{
		ParentID: &target.ID, Name: "restored", Type: meta.NodeTypeDir,
		OwnerID: owner.ID, Revision: 2,
	}
	if err := db.Create(&restoredDir).Error; err != nil {
		t.Fatal(err)
	}
	restoredChild := meta.Node{
		ParentID: &restoredDir.ID, Name: "child.jpg", Type: meta.NodeTypeFile,
		OwnerID: owner.ID, Revision: 1,
	}
	if err := db.Create(&sourceChild).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&manualChild).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&locallyChanged).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&restoredChild).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID: owner.ID, Name: "mirror-safe", Kind: "test",
		Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeMirror,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusActive,
		Revision: 1, TargetNodeID: &target.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	since := time.Now().UTC().Add(-sourcepkg.MirrorMissingGrace - time.Hour)
	items := []meta.SourceItem{
		{
			SourceID: source.ID, ExternalID: "folder", NodeID: &dir.ID,
			NodeRevision: dir.Revision, Kind: meta.SourceItemKindDirectory,
			Path: "folder", State: meta.SourceItemStateMissing,
			MirrorMissingFullScans: 1, MirrorMissingSince: &since,
			LastSeenAt: since,
		},
		{
			SourceID: source.ID, ExternalID: "source-child", NodeID: &sourceChild.ID,
			NodeRevision: sourceChild.Revision, Kind: meta.SourceItemKindFile,
			Path: "folder/remote.jpg", State: meta.SourceItemStateMissing,
			MirrorMissingFullScans: 1, MirrorMissingSince: &since,
			LastSeenAt: since,
		},
		{
			SourceID: source.ID, ExternalID: "locally-changed", NodeID: &locallyChanged.ID,
			NodeRevision: 1, Kind: meta.SourceItemKindFile,
			Path: "changed-local.jpg", State: meta.SourceItemStateMissing,
			MirrorMissingFullScans: 1, MirrorMissingSince: &since,
			LastSeenAt: since,
		},
		{
			SourceID: source.ID, ExternalID: "restored-dir", NodeID: &restoredDir.ID,
			NodeRevision: 1, Kind: meta.SourceItemKindDirectory,
			Path: "restored", State: meta.SourceItemStateMissing,
			MirrorMissingFullScans: 1, MirrorMissingSince: &since,
			LastSeenAt: since,
		},
		{
			SourceID: source.ID, ExternalID: "restored-child", NodeID: &restoredChild.ID,
			NodeRevision: restoredChild.Revision, Kind: meta.SourceItemKindFile,
			Path: "restored/child.jpg", State: meta.SourceItemStateMissing,
			MirrorMissingFullScans: 1, MirrorMissingSince: &since,
			LastSeenAt: since,
		},
	}
	if err := db.Create(&items).Error; err != nil {
		t.Fatal(err)
	}
	run := meta.SyncRun{
		ID: uuid.NewString(), SourceID: source.ID,
		SourceRevision: source.Revision,
		SyncMode:       meta.SourceSyncModeMirror,
		Mode:           meta.SourceRunModeSync,
		Status:         meta.SyncRunStatusRunning,
		TargetNodeID:   &target.ID,
	}
	deleted, err := advanceMirrorMissingEvidenceTx(db, source, run, items, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if deleted != 1 {
		t.Fatalf("deleted source items=%d want=1 child only", deleted)
	}

	var gotDir, gotSourceChild, gotManualChild, gotChanged, gotRestoredDir, gotRestoredChild meta.Node
	for id, dst := range map[uint64]*meta.Node{
		dir.ID:            &gotDir,
		sourceChild.ID:    &gotSourceChild,
		manualChild.ID:    &gotManualChild,
		locallyChanged.ID: &gotChanged,
		restoredDir.ID:    &gotRestoredDir,
		restoredChild.ID:  &gotRestoredChild,
	} {
		if err := db.First(dst, id).Error; err != nil {
			t.Fatal(err)
		}
	}
	if gotDir.DeletedAt != nil {
		t.Fatal("mixed directory was trashed")
	}
	if gotManualChild.DeletedAt != nil {
		t.Fatal("unmanaged local child was trashed")
	}
	if gotChanged.DeletedAt != nil {
		t.Fatal("locally revised source node was trashed")
	}
	if gotRestoredDir.DeletedAt != nil || gotRestoredChild.DeletedAt != nil {
		t.Fatalf(
			"restored/locally revised source directory did not protect descendants: dir=%+v child=%+v",
			gotRestoredDir,
			gotRestoredChild,
		)
	}
	if gotSourceChild.DeletedAt == nil ||
		gotSourceChild.TrashRootID == nil ||
		*gotSourceChild.TrashRootID != gotSourceChild.ID {
		t.Fatalf("independently eligible source child was not trashed: %+v", gotSourceChild)
	}
}

func TestMirrorConfigChangesResetDeletionEvidence(t *testing.T) {
	db := openMirrorTestDB(t)
	router := (&Server{
		DB:            db,
		Auth:          auth.New("source-mirror-config-secret", time.Hour),
		RefreshTTL:    24 * time.Hour,
		AllowedOrigin: "http://localhost",
	}).Router()
	token := createTestUser(t, db, router, "source-mirror-config-user", "password-a")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	targetA := requestNode(
		t,
		router,
		http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID),
		token,
		strings.NewReader(`{"name":"Mirror A"}`),
		http.StatusCreated,
	)
	targetB := requestNode(
		t,
		router,
		http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID),
		token,
		strings.NewReader(`{"name":"Mirror B"}`),
		http.StatusCreated,
	)
	createBody := fmt.Sprintf(`{
		"name":"Mirror Config Source",
		"kind":"synology_photos",
		"direction":"push",
		"sync_mode":"backup",
		"run_mode":"sync",
		"target_node_id":%d
	}`, targetA.ID)
	createdRes := request(
		t, router, http.MethodPost, "/api/v1/sources",
		token, strings.NewReader(createBody), http.StatusCreated,
	)
	var source sourceDTO
	if err := json.Unmarshal(createdRes.Body.Bytes(), &source); err != nil {
		t.Fatal(err)
	}

	since := time.Now().UTC().Add(-48 * time.Hour)
	item := meta.SourceItem{
		SourceID:               source.ID,
		ExternalID:             "config-evidence",
		Kind:                   meta.SourceItemKindFile,
		Path:                   "config.jpg",
		State:                  meta.SourceItemStateMissing,
		MirrorMissingFullScans: sourcepkg.MirrorMissingRequiredFullScans,
		MirrorMissingSince:     &since,
		LastSeenAt:             since,
	}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}
	assertReset := func(label string) {
		t.Helper()
		var got meta.SourceItem
		if err := db.First(&got, item.ID).Error; err != nil {
			t.Fatal(err)
		}
		if got.MirrorMissingFullScans != 0 || got.MirrorMissingSince != nil {
			t.Fatalf("%s did not reset mirror evidence: %+v", label, got)
		}
	}
	setMatureEvidence := func() {
		t.Helper()
		if err := db.Model(&meta.SourceItem{}).
			Where("id = ?", item.ID).
			Updates(map[string]any{
				"mirror_missing_full_scans": sourcepkg.MirrorMissingRequiredFullScans,
				"mirror_missing_since":      since,
			}).Error; err != nil {
			t.Fatal(err)
		}
	}

	update := func(revision uint64, body string) sourceDTO {
		t.Helper()
		res := requestWithHeaders(
			t,
			router,
			http.MethodPatch,
			fmt.Sprintf("/api/v1/sources/%d", source.ID),
			token,
			strings.NewReader(body),
			http.StatusOK,
			map[string]string{"If-Match": fmt.Sprintf("%q", fmt.Sprintf("%d", revision))},
		)
		var out sourceDTO
		if err := json.Unmarshal(res.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}

	source = update(source.Revision, `{"sync_mode":"mirror"}`)
	if source.SyncMode != meta.SourceSyncModeMirror {
		t.Fatalf("updated sync mode=%q", source.SyncMode)
	}
	assertReset("sync_mode")

	setMatureEvidence()
	source = update(source.Revision, `{"ignore_rules":"*.tmp\n"}`)
	assertReset("ignore_rules")

	setMatureEvidence()
	source = update(source.Revision, fmt.Sprintf(`{"target_node_id":%d}`, targetB.ID))
	assertReset("target_node_id")
}
