package api

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
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
			EvidenceKey: "node:" + name,
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
}
