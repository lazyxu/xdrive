package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

func TestMediaDuplicateOrganizePlanRejectsMalformedInput(t *testing.T) {
	for _, query := range []string{
		"?keeper_id=1&node_id=1&node_id=1",
		"?keeper_id=3&node_id=1&node_id=2",
		"?keeper_id=wrong&node_id=1&node_id=2",
		"?keeper_id=1&node_id=1&node_id=0",
		"?keeper_id=1&node_id=1",
	} {
		rec := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(rec)
		c.Request = httptest.NewRequest(http.MethodGet, "/media/duplicate-organize/plan"+query, nil)
		(&Server{}).mediaDuplicateOrganizePlan(c)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("query=%q status=%d expected 400", query, rec.Code)
		}
	}
}

func TestMediaDuplicateOrganizePlanPreservesIndependentUserIntent(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{},
		&meta.MediaMetadata{}, &meta.PhotoAsset{}, &meta.PhotoResource{},
		&meta.PhotoMetadata{}, &meta.PhotoEditRecipe{},
		&meta.PhotoCollection{}, &meta.PhotoCollectionAsset{},
		&meta.PhotoPerson{}, &meta.PhotoPersonAsset{}, &meta.AuditEvent{},
		&meta.Share{}, &meta.Source{}, &meta.SourceItem{}, &meta.SourceItemAlias{},
		&meta.SyncRun{}, &meta.SourceRunFailure{},
	); err != nil {
		t.Fatal(err)
	}
	owners := []meta.User{
		{Username: "organize-owner-a", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1},
		{Username: "organize-owner-b", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1},
	}
	if err := db.Create(&owners).Error; err != nil {
		t.Fatal(err)
	}
	roots := map[uint64]uint64{}
	for _, owner := range owners {
		root := meta.Node{OwnerID: owner.ID, Name: "", Type: meta.NodeTypeDir, Revision: 1}
		if err := db.Create(&root).Error; err != nil {
			t.Fatal(err)
		}
		roots[owner.ID] = root.ID
	}
	hash := strings.Repeat("d", 64)
	type assets struct {
		node  meta.Node
		asset meta.PhotoAsset
	}
	create := func(owner meta.User, name, desc, tags, people string, fav bool) assets {
		t.Helper()
		root := roots[owner.ID]
		n := meta.Node{
			OwnerID: owner.ID, ParentID: &root, Name: name,
			Type: meta.NodeTypeFile, Revision: 1,
		}
		if err := db.Create(&n).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.File{
			NodeID: n.ID, SHA256: hash, Size: 1000, StorageKey: "cas/" + hash,
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.MediaMetadata{
			NodeID: n.ID, OwnerID: owner.ID, NodeRevision: 1,
			SHA256: hash, MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
			IndexState: meta.MediaIndexStateReady,
		}).Error; err != nil {
			t.Fatal(err)
		}
		asset := meta.PhotoAsset{
			OwnerID: owner.ID, PrimaryNodeID: n.ID, Kind: meta.PhotoAssetKindImage,
			EvidenceKey: fmt.Sprintf("node:%d", n.ID),
		}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoResource{
			AssetID: asset.ID, ResourceKind: meta.PhotoResourceKindNode,
			NodeID: n.ID, Role: meta.PhotoResourceRolePrimary,
			MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
			SHA256: hash, Size: 1000, Name: name,
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoMetadata{
			AssetID: asset.ID, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", Favorite: fav, Description: desc,
			TagsJSON: tags, PeopleJSON: people,
		}).Error; err != nil {
			t.Fatal(err)
		}
		return assets{node: n, asset: asset}
	}
	a := create(owners[0], "a.jpg", "first description", `["cat"]`, `["Alice"]`, false)
	b := create(owners[0], "b.jpg", "different description", `["travel"]`, `["Bob"]`, true)
	c := create(owners[0], "c.jpg", "", `["cat"]`, `[]`, false)
	other := create(owners[1], "foreign.jpg", "secret", `["private"]`, `[]`, true)

	manual := meta.PhotoCollection{
		OwnerID: owners[0].ID, ExternalKey: "manual:test-organize",
		Kind: meta.PhotoCollectionKindManual, Name: "Trip", State: meta.PhotoCollectionStateActive,
	}
	if err := db.Create(&manual).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.PhotoCollection{
		OwnerID: owners[0].ID, ExternalKey: "source:test-organize",
		Kind: meta.PhotoCollectionKindSource, Name: "Imported source", State: meta.PhotoCollectionStateActive,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&[]meta.PhotoCollectionAsset{
		{CollectionID: manual.ID, AssetID: b.asset.ID, Position: 0},
		{CollectionID: source.ID, AssetID: b.asset.ID, Position: 0},
	}).Error; err != nil {
		t.Fatal(err)
	}
	person := meta.PhotoPerson{
		OwnerID:   owners[0].ID,
		PersonKey: "person:v1:organize-test",
		Name:      "Persistent Person",
	}
	if err := db.Create(&person).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.PhotoPersonAsset{
		PersonID: person.ID, AssetID: b.asset.ID,
	}).Error; err != nil {
		t.Fatal(err)
	}
	// One original can be linked to a Pull sync folder even when other
	// exact byte copies live in different folders or accounts. Include a
	// foreign-owned, incorrectly linked SourceItem to enforce owner isolation.
	sourceA := meta.Source{
		OwnerID: owners[0].ID, Name: "Synology A", Kind: "synology_files",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusActive, Revision: 1,
	}
	sourceB := meta.Source{
		OwnerID: owners[0].ID, Name: "Yike B", Kind: "yike",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusPaused, Revision: 1,
	}
	foreignSource := meta.Source{
		OwnerID: owners[1].ID, Name: "Other account", Kind: "synology_files",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusActive, Revision: 1,
	}
	for _, source := range []*meta.Source{&sourceA, &sourceB, &foreignSource} {
		if err := db.Create(source).Error; err != nil {
			t.Fatal(err)
		}
	}
	seenAt := time.Now().UTC()
	sourceItemB := meta.SourceItem{
		SourceID: sourceA.ID, ExternalID: "synology-b",
		NodeID: &b.node.ID, NodeRevision: 1, Kind: meta.SourceItemKindFile,
		Path: "/camera/b.jpg", State: meta.SourceItemStateSynced,
		LastSeenAt: seenAt,
	}
	sourceItemC := meta.SourceItem{
		SourceID: sourceB.ID, ExternalID: "yike-c",
		NodeID: &c.node.ID, NodeRevision: 1, Kind: meta.SourceItemKindFile,
		Path: "/album/c.jpg", State: meta.SourceItemStateSynced,
		LastSeenAt: seenAt,
	}
	foreignItem := meta.SourceItem{
		SourceID: foreignSource.ID, ExternalID: "foreign-link",
		NodeID: &b.node.ID, NodeRevision: 1, Kind: meta.SourceItemKindFile,
		Path:  "/private/should-not-appear.jpg",
		State: meta.SourceItemStateSynced, LastSeenAt: seenAt,
	}
	for _, item := range []*meta.SourceItem{&sourceItemB, &sourceItemC, &foreignItem} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	server := &Server{DB: db}
	read := func(ids ...uint64) mediaDuplicateOrganizePlan {
		t.Helper()
		plan, err := server.queryMediaDuplicateOrganizePlan(
			context.Background(), owners[0].ID, a.node.ID, ids,
		)
		if err != nil {
			t.Fatal(err)
		}
		return plan
	}
	plan := read(a.node.ID, b.node.ID, c.node.ID)
	if plan.AssetComparison != duplicateAssetIdentical ||
		plan.ReadyForManualReview ||
		len(plan.Descriptions) != 2 ||
		len(plan.Members) != 3 ||
		plan.ManualAlbumCount != 1 ||
		plan.DurablePersonCount != 1 ||
		!plan.CombinedFavorites ||
		!plan.NoMutation ||
		!plan.RequiresManualConfirmation ||
		plan.PhysicalReclaimableBytes != 0 {
		t.Fatalf("safe preview must preserve all user information: %+v", plan)
	}
	if !reflect.DeepEqual(plan.CombinedTags, []string{"cat", "travel"}) ||
		!reflect.DeepEqual(plan.CombinedPeopleLabels, []string{"Alice", "Bob"}) {
		t.Fatalf("lost tags or user people labels: %+v", plan)
	}
	if len(plan.Members[1].Collections) != 2 || len(plan.Members[1].People) != 1 {
		t.Fatalf("lost manual/source album or persistent people: %+v", plan.Members[1])
	}
	if plan.SourceManagedAssets != 2 || plan.PotentialReimportAssets != 2 ||
		len(plan.Members[0].SourceLinks) != 0 ||
		len(plan.Members[1].SourceLinks) != 1 ||
		len(plan.Members[2].SourceLinks) != 1 {
		t.Fatalf("source coverage not owner-scoped or complete: %+v", plan)
	}
	linkB := plan.Members[1].SourceLinks[0]
	linkC := plan.Members[2].SourceLinks[0]
	if !linkB.MayReimport || !linkC.MayReimport ||
		linkB.SourceID != sourceA.ID || linkB.ResourceNodeID != b.node.ID ||
		linkB.SourceItemID != sourceItemB.ID || linkB.Path != "/camera/b.jpg" ||
		linkC.SourceID != sourceB.ID || linkC.SourceItemID != sourceItemC.ID ||
		linkC.SourceStatus != meta.SourceStatusPaused ||
		!strings.Contains(plan.SourceWarning, "再次同步") {
		t.Fatalf("source provenance or possible reimport warning lost: %+v", plan)
	}
	if len(plan.Members[1].Resources) != 1 ||
		plan.Members[1].Resources[0].SHA256 != hash ||
		plan.Members[1].Resources[0].NodeID != b.node.ID ||
		plan.Members[1].EditRecipe != nil {
		t.Fatalf("original resource identities must remain separately inspectable: %+v", plan.Members[1])
	}
	// No mutation path: repeated planning leaves existing independent users,
	// metadata, memberships, resources and edit recipes intact.
	var memberships int64
	if err := db.Model(&meta.PhotoCollectionAsset{}).
		Count(&memberships).Error; err != nil {
		t.Fatal(err)
	}
	if memberships != 2 {
		t.Fatalf("plan changed memberships: %d", memberships)
	}
	if _, err := server.queryMediaDuplicateOrganizePlan(
		context.Background(), owners[0].ID, a.node.ID,
		[]uint64{a.node.ID, other.node.ID},
	); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("cross-owner plan must not reveal assets: %v", err)
	}
	if _, err := server.applyMediaDuplicateOrganizeMetadata(
		context.Background(), owners[0].ID, mediaDuplicateOrganizeApplyInput{
			KeeperNodeID:         a.node.ID,
			NodeIDs:              []uint64{a.node.ID, b.node.ID, c.node.ID},
			ExpectedPlanRevision: plan.PlanRevision,
			Confirm:              true,
		},
	); !errors.Is(err, errMediaDuplicateOrganizeConflict) {
		t.Fatalf("conflicting descriptions must block write: %v", err)
	}
	if err := db.Model(&meta.PhotoMetadata{}).
		Where("asset_id = ?", b.asset.ID).
		Update("description", "first description").Error; err != nil {
		t.Fatal(err)
	}
	consistent := read(a.node.ID, b.node.ID, c.node.ID)
	if !consistent.ReadyForManualReview || len(consistent.Descriptions) != 1 ||
		len(consistent.PlanRevision) != 64 || plan.PlanRevision == consistent.PlanRevision {
		t.Fatalf("equal descriptions should allow reviewed next step with new token: %+v", consistent)
	}
	input := mediaDuplicateOrganizeApplyInput{
		KeeperNodeID:         a.node.ID,
		NodeIDs:              []uint64{a.node.ID, b.node.ID, c.node.ID},
		ExpectedPlanRevision: consistent.PlanRevision,
		Confirm:              true,
	}
	// A changed backing File size must block a stale projected resource even
	// when the read-only PhotoResource snapshot still has the old content SHA.
	if err := db.Model(&meta.File{}).Where("node_id = ?", b.node.ID).
		Update("size", 1001).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := server.applyMediaDuplicateOrganizeMetadata(
		context.Background(), owners[0].ID, input,
	); !errors.Is(err, errMediaDuplicateOrganizeConflict) {
		t.Fatalf("stale original backing resource must prevent annotation union: %v", err)
	}
	if err := db.Model(&meta.File{}).Where("node_id = ?", b.node.ID).
		Update("size", 1000).Error; err != nil {
		t.Fatal(err)
	}
	// The review fingerprint includes the current SourceItem identity and path.
	// Even a read-only source rename requires a new user-approved preview.
	if err := db.Model(&meta.SourceItem{}).
		Where("id = ?", sourceItemB.ID).
		Update("path", "/camera/renamed-b.jpg").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := server.applyMediaDuplicateOrganizeMetadata(
		context.Background(), owners[0].ID, input,
	); !errors.Is(err, errMediaDuplicateOrganizeConflict) {
		t.Fatalf("changed sync-folder provenance must reject stale review: %v", err)
	}
	if err := db.Model(&meta.SourceItem{}).
		Where("id = ?", sourceItemB.ID).
		Update("path", "/camera/b.jpg").Error; err != nil {
		t.Fatal(err)
	}
	applied, err := server.applyMediaDuplicateOrganizeMetadata(
		context.Background(), owners[0].ID, input,
	)
	if err != nil {
		t.Fatalf("reviewed annotation union failed: %v", err)
	}
	if applied.KeeperNodeID != a.node.ID || !applied.MetadataUpdated ||
		applied.ManualAlbumsAdded != 1 || applied.DurablePeopleAdded != 1 ||
		!applied.OriginalFilesRetained || !applied.OriginalEditsRetained ||
		!applied.SourceLinksUnchanged || applied.PhysicalBytesReclaimed != 0 {
		t.Fatalf("unexpected consolidation result: %+v", applied)
	}
	var keeperMetadata meta.PhotoMetadata
	if err := db.Where("asset_id = ?", a.asset.ID).
		First(&keeperMetadata).Error; err != nil {
		t.Fatal(err)
	}
	if !keeperMetadata.Favorite || keeperMetadata.Description != "first description" ||
		keeperMetadata.TagsJSON != `["cat","travel"]` ||
		keeperMetadata.PeopleJSON != `["Alice","Bob"]` {
		t.Fatalf("keeper lost combined annotations: %+v", keeperMetadata)
	}
	for _, tc := range []struct {
		collectionID uint64
		assetID      uint64
		want         int64
	}{
		{collectionID: manual.ID, assetID: a.asset.ID, want: 1},
		{collectionID: manual.ID, assetID: b.asset.ID, want: 1},
		{collectionID: source.ID, assetID: a.asset.ID, want: 0},
		{collectionID: source.ID, assetID: b.asset.ID, want: 1},
	} {
		var count int64
		if err := db.Model(&meta.PhotoCollectionAsset{}).
			Where("collection_id = ? AND asset_id = ?", tc.collectionID, tc.assetID).
			Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != tc.want {
			t.Fatalf("collection=%d asset=%d members=%d want=%d",
				tc.collectionID, tc.assetID, count, tc.want)
		}
	}
	for _, assetID := range []uint64{a.asset.ID, b.asset.ID} {
		var count int64
		if err := db.Model(&meta.PhotoPersonAsset{}).
			Where("person_id = ? AND asset_id = ?", person.ID, assetID).
			Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != 1 {
			t.Fatalf("persistent person assignment lost for asset=%d", assetID)
		}
	}
	var files, resources, assetRows, audits int64
	if err := db.Model(&meta.File{}).Count(&files).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.PhotoResource{}).Count(&resources).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.PhotoAsset{}).Count(&assetRows).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.AuditEvent{}).
		Where("action = ?", "media.duplicate.organize_metadata").
		Count(&audits).Error; err != nil {
		t.Fatal(err)
	}
	if files != 4 || resources != 4 || assetRows != 4 || audits != 1 {
		t.Fatalf("real files/resources/assets and audit not preserved: %d/%d/%d audits=%d",
			files, resources, assetRows, audits)
	}
	for _, sourceItem := range []meta.SourceItem{sourceItemB, sourceItemC} {
		var current meta.SourceItem
		if err := db.First(&current, sourceItem.ID).Error; err != nil {
			t.Fatal(err)
		}
		if current.NodeID == nil || sourceItem.NodeID == nil ||
			*current.NodeID != *sourceItem.NodeID ||
			current.State != meta.SourceItemStateSynced {
			t.Fatalf("annotation union mutated sync-folder identity: %+v", current)
		}
	}
	if _, err := server.applyMediaDuplicateOrganizeMetadata(
		context.Background(), owners[0].ID, input,
	); !errors.Is(err, errMediaDuplicateOrganizeConflict) {
		t.Fatalf("stale user-confirmation token must be rejected: %v", err)
	}
	input.NodeIDs = []uint64{a.node.ID, other.node.ID}
	if _, err := server.applyMediaDuplicateOrganizeMetadata(
		context.Background(), owners[0].ID, input,
	); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("foreign account must remain isolated: %v", err)
	}
	if err := db.Create(&meta.PhotoEditRecipe{
		AssetID: c.asset.ID, OwnerID: owners[0].ID,
		SourceNodeID: c.node.ID, SourceNodeRevision: 1, SourceSHA256: hash,
		CropWidth: 0.8, CropHeight: 1,
	}).Error; err != nil {
		t.Fatal(err)
	}
	diff := read(a.node.ID, c.node.ID)
	if diff.AssetComparison != duplicateAssetDifferent ||
		diff.ReadyForManualReview || len(diff.Members) != 2 ||
		diff.Members[1].EditRecipe == nil ||
		diff.Members[1].EditRecipe.CropWidth != 0.8 {
		t.Fatalf("different edit recipe must be visible but block consolidation: %+v", diff)
	}
	if err := db.Model(&meta.MediaMetadata{}).
		Where("node_id = ?", b.node.ID).
		Update("node_revision", 0).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := server.queryMediaDuplicateOrganizePlan(
		context.Background(), owners[0].ID, a.node.ID,
		[]uint64{a.node.ID, b.node.ID},
	); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("stale index must reject organization preview: %v", err)
	}

	// Real SourceRun API replay after the confirmed metadata-only union.
	// A normal unchanged Pull observation must not rewrite a keeper's newly
	// combined annotations or steal its original source-owned album members.
	// Existing source paths in this test are provider-style absolute strings;
	// normalize this test-only SourceItem to the SourceRun's relative path.
	rootID := roots[owners[0].ID]
	if err := db.Model(&meta.Source{}).
		Where("id = ?", sourceA.ID).
		Update("target_node_id", rootID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.SourceItem{}).
		Where("id = ?", sourceItemB.ID).
		Updates(map[string]any{
			"path": "b.jpg", "size": int64(1000), "sha256": hash,
		}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.MediaMetadata{}).
		Where("node_id = ?", b.node.ID).
		Update("node_revision", 1).Error; err != nil {
		t.Fatal(err)
	}
	authManager := auth.New("duplicate-source-replay-secret", time.Hour)
	token, err := authManager.Issue(owners[0].ID, owners[0].SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	server.Auth = authManager
	server.RefreshTTL = 24 * time.Hour
	server.AllowedOrigin = "http://localhost"
	router := server.Router()
	sourcePath := fmt.Sprintf("/api/v1/sources/%d/runs", sourceA.ID)
	startRun := func() string {
		t.Helper()
		runID := uuid.NewString()
		request(t, router, http.MethodPost, sourcePath, token,
			strings.NewReader(fmt.Sprintf(`{"run_id":%q,"trigger":"scheduled"}`, runID)),
			http.StatusCreated)
		return runID
	}
	observe := func(runID, externalID, path string) observeSourceRunResponse {
		t.Helper()
		payload := fmt.Sprintf(
			`{"items":[{"external_id":%q,"kind":"file","path":%q,"size":1000,"sha256":%q}]}`,
			externalID, path, hash,
		)
		out := request(t, router, http.MethodPost,
			sourcePath+"/"+runID+"/observe", token,
			strings.NewReader(payload), http.StatusOK)
		var observed observeSourceRunResponse
		if err := json.Unmarshal(out.Body.Bytes(), &observed); err != nil {
			t.Fatal(err)
		}
		return observed
	}
	finish := func(runID string, complete bool, summary string) {
		t.Helper()
		body := fmt.Sprintf(
			`{"status":"completed","complete_inventory":%t,"summary":%s}`,
			complete, summary,
		)
		request(t, router, http.MethodPost,
			sourcePath+"/"+runID+"/finish", token,
			strings.NewReader(body), http.StatusOK)
	}
	replayedRunID := startRun()
	reobserved := observe(replayedRunID, "synology-b", "b.jpg")
	if len(reobserved.Plans) != 1 ||
		reobserved.Plans[0].Action != "unchanged" ||
		reobserved.Plans[0].NodeID == nil ||
		*reobserved.Plans[0].NodeID != b.node.ID {
		t.Fatalf("unchanged re-sync should retain real independent source Node: %+v", reobserved)
	}
	finish(replayedRunID, true,
		`{"scanned_items":1,"scanned_bytes":1000,"scanned_file_items":1,"unchanged_items":1,"unchanged_bytes":1000}`)
	var linkedAfterReplay meta.SourceItem
	if err := db.First(&linkedAfterReplay, sourceItemB.ID).Error; err != nil {
		t.Fatal(err)
	}
	if linkedAfterReplay.State != meta.SourceItemStateSynced ||
		linkedAfterReplay.NodeID == nil ||
		*linkedAfterReplay.NodeID != b.node.ID ||
		linkedAfterReplay.LastSeenRunID != replayedRunID {
		t.Fatalf("replayed sync broke original SourceItem identity: %+v", linkedAfterReplay)
	}
	var keeperAfterReplay meta.PhotoMetadata
	if err := db.First(&keeperAfterReplay, "asset_id = ?", a.asset.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !keeperAfterReplay.Favorite ||
		keeperAfterReplay.Description != "first description" ||
		keeperAfterReplay.TagsJSON != `["cat","travel"]` ||
		keeperAfterReplay.PeopleJSON != `["Alice","Bob"]` {
		t.Fatalf("unchanged real SourceRun erased previously merged annotations: %+v", keeperAfterReplay)
	}
	var keeperSourceMembers int64
	if err := db.Model(&meta.PhotoCollectionAsset{}).
		Where("collection_id = ? AND asset_id = ?", source.ID, a.asset.ID).
		Count(&keeperSourceMembers).Error; err != nil {
		t.Fatal(err)
	}
	if keeperSourceMembers != 0 {
		t.Fatal("SourceRun incorrectly moved provider album membership to keeper")
	}

	// Discovery of a *new* remote identity with identical bytes is explicitly
	// a CREATE plan, not automatic reuse of the keeper or metadata consolidation.
	// The fixture materializes the planned transfer as an independent Node; it
	// does NOT fetch bytes through a live Synology or Yike connector.
	secondRunID := startRun()
	newPlan := observe(secondRunID, "synology-new-identity", "reimported.jpg")
	if len(newPlan.Plans) != 1 || newPlan.Plans[0].Action != "create" {
		t.Fatalf("new source identity silently merged by SHA-256: %+v", newPlan)
	}
	incoming := create(owners[0], "reimported.jpg", "", `[]`, `[]`, false)
	commit := fmt.Sprintf(
		`{"items":[{"external_id":"synology-new-identity","action":"create","node_id":%d,"node_revision":1,"kind":"file","path":"reimported.jpg","size":1000,"sha256":%q,"transferred":true,"transferred_bytes":1000}]}`,
		incoming.node.ID, hash,
	)
	commitPath := sourcePath + "/" + secondRunID + "/commit"
	request(t, router, http.MethodPost, commitPath, token, strings.NewReader(commit), http.StatusNoContent)
	// Simulate lost commit response: the same event must be idempotent.
	request(t, router, http.MethodPost, commitPath, token, strings.NewReader(commit), http.StatusNoContent)
	finish(secondRunID, false,
		`{"scanned_items":1,"scanned_bytes":1000,"scanned_file_items":1,"new_items":1,"new_bytes":1000,"planned_transfer_items":1,"planned_transfer_bytes":1000}`)
	var newlyImportedSource meta.SourceItem
	if err := db.Where("source_id = ? AND external_id = ?",
		sourceA.ID, "synology-new-identity").First(&newlyImportedSource).Error; err != nil {
		t.Fatal(err)
	}
	if newlyImportedSource.NodeID == nil ||
		*newlyImportedSource.NodeID != incoming.node.ID ||
		newlyImportedSource.State != meta.SourceItemStateSynced {
		t.Fatalf("committed new source identity lost independent Node: %+v", newlyImportedSource)
	}
	var incomingMetadata meta.PhotoMetadata
	if err := db.Where("asset_id = ?", incoming.asset.ID).
		First(&incomingMetadata).Error; err != nil {
		t.Fatal(err)
	}
	if incomingMetadata.Favorite || incomingMetadata.Description != "" ||
		incomingMetadata.TagsJSON != `[]` || incomingMetadata.PeopleJSON != `[]` {
		t.Fatalf("newly synced exact-content copy inherited keeper annotations without confirmation: %+v", incomingMetadata)
	}
	if err := db.Where("asset_id = ?", a.asset.ID).
		First(&keeperAfterReplay).Error; err != nil {
		t.Fatal(err)
	}
	if !keeperAfterReplay.Favorite ||
		keeperAfterReplay.TagsJSON != `["cat","travel"]` {
		t.Fatalf("newly synced duplicate modified confirmed keeper annotations: %+v", keeperAfterReplay)
	}
	var ownedAssets int64
	if err := db.Model(&meta.PhotoAsset{}).
		Where("owner_id = ?", owners[0].ID).Count(&ownedAssets).Error; err != nil {
		t.Fatal(err)
	}
	if ownedAssets != 4 { // 3 original owner-A assets + independent new import.
		t.Fatalf("newly synced independent asset count=%d want=4", ownedAssets)
	}

	// Even after the user explicitly trashes the newly imported source copy,
	// the same remote Backup identity remains authoritative on the provider.
	// The next real SourceRun must plan a new independent Node, not revive the
	// trashed Node, mutate the unrelated keeper, or reuse it merely by SHA.
	trashPath := fmt.Sprintf("/api/v1/nodes/%d", incoming.node.ID)
	trashRequest := httptest.NewRequest(http.MethodDelete, trashPath, nil)
	trashRequest.Header.Set("Authorization", "Bearer "+token)
	trashRequest.Header.Set("If-Match", "1")
	trashResponse := httptest.NewRecorder()
	router.ServeHTTP(trashResponse, trashRequest)
	if trashResponse.Code != http.StatusNoContent {
		t.Fatalf("real Node-to-Trash request status=%d body=%s",
			trashResponse.Code, trashResponse.Body.String())
	}
	var trashedCopy meta.Node
	if err := db.First(&trashedCopy, incoming.node.ID).Error; err != nil {
		t.Fatal(err)
	}
	if trashedCopy.DeletedAt == nil || trashedCopy.TrashRootID == nil ||
		*trashedCopy.TrashRootID != incoming.node.ID {
		t.Fatalf("original source copy was not moved to Trash: %+v", trashedCopy)
	}
	trashReimportRun := startRun()
	reimportPlan := observe(trashReimportRun, "synology-new-identity", "reimported.jpg")
	if len(reimportPlan.Plans) != 1 ||
		reimportPlan.Plans[0].Action != "create" ||
		reimportPlan.Plans[0].NodeID != nil {
		t.Fatalf("deleted source copy must be re-created with a new Node: %+v", reimportPlan)
	}
	restored := create(owners[0], "reimported.jpg", "", `[]`, `[]`, false)
	if restored.node.ID == incoming.node.ID || restored.node.ID == a.node.ID {
		t.Fatalf("reimported source reused trashed or keeper Node: %d", restored.node.ID)
	}
	restoredCommit := fmt.Sprintf(
		`{"items":[{"external_id":"synology-new-identity","action":"create","node_id":%d,"node_revision":1,"kind":"file","path":"reimported.jpg","size":1000,"sha256":%q,"transferred":true,"transferred_bytes":1000}]}`,
		restored.node.ID, hash,
	)
	restoredCommitPath := sourcePath + "/" + trashReimportRun + "/commit"
	request(t, router, http.MethodPost, restoredCommitPath, token,
		strings.NewReader(restoredCommit), http.StatusNoContent)
	// The same SourceRun commit must remain replay-safe even after an earlier
	// local Trash action disconnected the previously synced real Node.
	request(t, router, http.MethodPost, restoredCommitPath, token,
		strings.NewReader(restoredCommit), http.StatusNoContent)
	finish(trashReimportRun, false,
		`{"scanned_items":1,"scanned_bytes":1000,"scanned_file_items":1,"new_items":1,"new_bytes":1000,"planned_transfer_items":1,"planned_transfer_bytes":1000}`)
	var refreshedSourceItem meta.SourceItem
	if err := db.First(&refreshedSourceItem, newlyImportedSource.ID).Error; err != nil {
		t.Fatal(err)
	}
	if refreshedSourceItem.ID != newlyImportedSource.ID ||
		refreshedSourceItem.NodeID == nil ||
		*refreshedSourceItem.NodeID != restored.node.ID ||
		refreshedSourceItem.State != meta.SourceItemStateSynced ||
		refreshedSourceItem.LastSyncedRunID != trashReimportRun {
		t.Fatalf("Backup reimport lost source identity or new Node: %+v", refreshedSourceItem)
	}
	var originalTrashNode meta.Node
	if err := db.First(&originalTrashNode, incoming.node.ID).Error; err != nil {
		t.Fatal(err)
	}
	if originalTrashNode.DeletedAt == nil {
		t.Fatal("reimport restored a Trash Node instead of creating an independent copy")
	}
	var preservedKeeper meta.PhotoMetadata
	if err := db.First(&preservedKeeper, "asset_id = ?", a.asset.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !preservedKeeper.Favorite ||
		preservedKeeper.Description != "first description" ||
		preservedKeeper.TagsJSON != `["cat","travel"]` ||
		preservedKeeper.PeopleJSON != `["Alice","Bob"]` {
		t.Fatalf("reimport after Trash damaged keeper annotations: %+v", preservedKeeper)
	}
	var reimportedMetadata meta.PhotoMetadata
	if err := db.First(&reimportedMetadata, "asset_id = ?", restored.asset.ID).Error; err != nil {
		t.Fatal(err)
	}
	if reimportedMetadata.Favorite || reimportedMetadata.Description != "" ||
		reimportedMetadata.TagsJSON != `[]` || reimportedMetadata.PeopleJSON != `[]` {
		t.Fatalf("reimport after Trash silently inherited merged metadata: %+v", reimportedMetadata)
	}
	var sourceOnKeeper int64
	if err := db.Model(&meta.PhotoCollectionAsset{}).
		Where("collection_id = ? AND asset_id = ?", source.ID, a.asset.ID).
		Count(&sourceOnKeeper).Error; err != nil {
		t.Fatal(err)
	}
	if sourceOnKeeper != 0 {
		t.Fatalf("reimport moved provider album membership to keeper: %d", sourceOnKeeper)
	}
	var assetCountAfterTrashReimport int64
	if err := db.Model(&meta.PhotoAsset{}).
		Where("owner_id = ?", owners[0].ID).
		Count(&assetCountAfterTrashReimport).Error; err != nil {
		t.Fatal(err)
	}
	if assetCountAfterTrashReimport != 5 {
		t.Fatalf("trashed PhotoAsset must remain frozen plus new independent copy: %d",
			assetCountAfterTrashReimport)
	}
}

func TestMediaDuplicateOrganizePlanFindsLiveMotionSourceLinks(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{}, &meta.MediaMetadata{},
		&meta.PhotoAsset{}, &meta.PhotoResource{}, &meta.PhotoMetadata{},
		&meta.PhotoEditRecipe{}, &meta.PhotoCollection{},
		&meta.PhotoCollectionAsset{}, &meta.PhotoPerson{},
		&meta.PhotoPersonAsset{}, &meta.Source{}, &meta.SourceItem{},
	); err != nil {
		t.Fatal(err)
	}
	owner := meta.User{
		Username: "live-motion-source", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{OwnerID: owner.ID, Name: "", Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	const copies = 2
	stillIDs := make([]uint64, 0, copies)
	motionIDs := make([]uint64, 0, copies)
	stillHash := strings.Repeat("a", 64)
	motionHash := strings.Repeat("b", 64)
	for index := 0; index < copies; index++ {
		newNode := func(name string, kind string, hash string, size int64) meta.Node {
			t.Helper()
			node := meta.Node{
				OwnerID: owner.ID, ParentID: &root.ID,
				Name: name, Type: meta.NodeTypeFile, Revision: 1,
			}
			if err := db.Create(&node).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Create(&meta.File{
				NodeID: node.ID, SHA256: hash, Size: size, StorageKey: "cas/" + hash,
			}).Error; err != nil {
				t.Fatal(err)
			}
			mimeType := "image/jpeg"
			if kind == meta.MediaKindVideo {
				mimeType = "video/quicktime"
			}
			if err := db.Create(&meta.MediaMetadata{
				NodeID: node.ID, OwnerID: owner.ID, NodeRevision: 1,
				SHA256: hash, MediaKind: kind, MIMEType: mimeType,
				IndexState: meta.MediaIndexStateReady,
			}).Error; err != nil {
				t.Fatal(err)
			}
			return node
		}
		stillName := "live-still-a.jpg"
		motionName := "live-motion-a.mov"
		if index != 0 {
			stillName = "live-still-b.jpg"
			motionName = "live-motion-b.mov"
		}
		still := newNode(stillName, meta.MediaKindImage, stillHash, 1000)
		motion := newNode(motionName, meta.MediaKindVideo, motionHash, 2000)
		asset := meta.PhotoAsset{
			OwnerID: owner.ID, PrimaryNodeID: still.ID,
			Kind: meta.PhotoAssetKindLivePhoto, EvidenceKey: "group:" + stillName,
		}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		resources := []meta.PhotoResource{
			{
				AssetID: asset.ID, ResourceKind: meta.PhotoResourceKindNode,
				NodeID: still.ID, Role: meta.MediaGroupRoleStill,
				Ordinal: 0, Name: stillName, MediaKind: meta.MediaKindImage,
				MIMEType: "image/jpeg", Size: 1000, SHA256: stillHash,
			},
			{
				AssetID: asset.ID, ResourceKind: meta.PhotoResourceKindNode,
				NodeID: motion.ID, Role: meta.MediaGroupRoleMotion,
				Ordinal: 1, Name: motionName, MediaKind: meta.MediaKindVideo,
				MIMEType: "video/quicktime", Size: 2000, SHA256: motionHash,
			},
		}
		if err := db.Create(&resources).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoMetadata{
			AssetID: asset.ID, MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
		}).Error; err != nil {
			t.Fatal(err)
		}
		stillIDs = append(stillIDs, still.ID)
		motionIDs = append(motionIDs, motion.ID)
	}
	sources := []meta.Source{
		{
			OwnerID: owner.ID, Name: "Camera A", Kind: "synology_files",
			Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
			RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusActive,
			Revision: 1,
		},
		{
			OwnerID: owner.ID, Name: "Camera B", Kind: "yike",
			Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
			RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusPaused,
			Revision: 1,
		},
	}
	if err := db.Create(&sources).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	for index := range sources {
		sourceItem := meta.SourceItem{
			SourceID: sources[index].ID, ExternalID: "motion-copy",
			NodeID: &motionIDs[index], NodeRevision: 1,
			Kind: meta.SourceItemKindFile, State: meta.SourceItemStateSynced,
			Path: "/Live/clip.mov", LastSeenAt: now,
		}
		if err := db.Create(&sourceItem).Error; err != nil {
			t.Fatal(err)
		}
	}
	server := &Server{DB: db}
	read := func() mediaDuplicateOrganizePlan {
		t.Helper()
		plan, err := server.queryMediaDuplicateOrganizePlan(
			context.Background(), owner.ID, stillIDs[0], stillIDs,
		)
		if err != nil {
			t.Fatal(err)
		}
		return plan
	}
	first := read()
	if first.AssetComparison != duplicateAssetIdentical ||
		first.SourceManagedAssets != 2 || first.PotentialReimportAssets != 2 ||
		len(first.Members) != 2 {
		t.Fatalf("identical Live Photos must retain both motion sources: %+v", first)
	}
	for index, member := range first.Members {
		if len(member.SourceLinks) != 1 ||
			member.SourceLinks[0].ResourceNodeID != motionIDs[index] ||
			member.SourceLinks[0].SourceID != sources[index].ID ||
			!member.SourceLinks[0].MayReimport {
			t.Fatalf("motion source was not attached to whole PhotoAsset: %+v", member)
		}
	}
	if err := db.Model(&meta.SourceItem{}).
		Where("source_id = ? AND node_id = ?", sources[1].ID, motionIDs[1]).
		Update("state", meta.SourceItemStateMissing).Error; err != nil {
		t.Fatal(err)
	}
	second := read()
	if second.PotentialReimportAssets != 1 ||
		second.SourceManagedAssets != 2 ||
		second.PlanRevision == first.PlanRevision ||
		second.Members[1].SourceLinks[0].MayReimport {
		t.Fatalf("source reimport eligibility did not invalidate review: %+v", second)
	}
}
