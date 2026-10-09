package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
)

// The Mirror policy concerns the provider-owned Node, not every asset which
// shares its SHA. After an annotation-only union, both original PhotoAssets
// remain independent: a confirmed provider disappearance must never trash
// the unrelated local keeper or erase its combined annotations.
func TestMirrorMissingDuplicateAfterAnnotationUnionKeepsLocalKeeper(t *testing.T) {
	db := openMirrorTestDB(t)
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	sqlDB.SetMaxOpenConns(2)
	sqlDB.SetMaxIdleConns(1)
	if err := db.AutoMigrate(
		&meta.MediaMetadata{}, &meta.PhotoAsset{}, &meta.PhotoResource{},
		&meta.PhotoMetadata{}, &meta.PhotoEditRecipe{},
		&meta.PhotoCollection{}, &meta.PhotoCollectionAsset{},
		&meta.PhotoPerson{}, &meta.PhotoPersonAsset{},
	); err != nil {
		t.Fatal(err)
	}
	router := (&Server{
		DB:            db,
		Auth:          auth.New("mirror-duplicate-organize-test", time.Hour),
		RefreshTTL:    24 * time.Hour,
		AllowedOrigin: "http://localhost",
	}).Router()
	token := createTestUser(t, db, router, "mirror-duplicate-user", "password-a")
	root := requestNode(t, router, http.MethodGet,
		"/api/v1/nodes/root", token, nil, http.StatusOK)
	target := requestNode(t, router, http.MethodPost,
		fmt.Sprintf("/api/v1/nodes/%d/directories", root.ID), token,
		strings.NewReader(`{"name":"Mirror Originals"}`), http.StatusCreated)
	createSource := fmt.Sprintf(`{"name":"Mirror Copies","kind":"synology_photos","direction":"push","sync_mode":"mirror","run_mode":"sync","target_node_id":%d}`, target.ID)
	sourceRes := request(t, router, http.MethodPost, "/api/v1/sources",
		token, strings.NewReader(createSource), http.StatusCreated)
	var source sourceDTO
	if err := json.Unmarshal(sourceRes.Body.Bytes(), &source); err != nil {
		t.Fatal(err)
	}
	if source.SyncMode != meta.SourceSyncModeMirror {
		t.Fatalf("created source mode=%q want mirror", source.SyncMode)
	}
	var owner meta.User
	if err := db.Where("username = ?", "mirror-duplicate-user").First(&owner).Error; err != nil {
		t.Fatal(err)
	}
	hash := strings.Repeat("a", 64)
	type original struct {
		node  meta.Node
		asset meta.PhotoAsset
	}
	addOriginal := func(parent uint64, name, description, tags string, favorite bool) original {
		t.Helper()
		node := meta.Node{
			ParentID: &parent, OwnerID: owner.ID, Name: name,
			Type: meta.NodeTypeFile, Revision: 1,
		}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.File{
			NodeID: node.ID, SHA256: hash, Size: 1024, StorageKey: "cas/" + hash,
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.MediaMetadata{
			NodeID: node.ID, OwnerID: owner.ID, NodeRevision: 1,
			SHA256: hash, IndexState: meta.MediaIndexStateReady,
			MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
		}).Error; err != nil {
			t.Fatal(err)
		}
		asset := meta.PhotoAsset{
			OwnerID: owner.ID, PrimaryNodeID: node.ID,
			Kind:        meta.PhotoAssetKindImage,
			EvidenceKey: fmt.Sprintf("node:%d", node.ID),
		}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoResource{
			AssetID: asset.ID, ResourceKind: meta.PhotoResourceKindNode,
			NodeID: node.ID, Role: meta.PhotoResourceRolePrimary,
			Name: name, MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
			Size: 1024, SHA256: hash,
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoMetadata{
			AssetID: asset.ID, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", Favorite: favorite,
			Description: description, TagsJSON: tags, PeopleJSON: "[]",
		}).Error; err != nil {
			t.Fatal(err)
		}
		return original{node: node, asset: asset}
	}
	keeper := addOriginal(root.ID, "local-keeper.jpg", "keep annotation",
		`["keeper"]`, false)
	remote := addOriginal(target.ID, "remote-copy.jpg", "",
		`["source"]`, true)
	item := meta.SourceItem{
		SourceID: source.ID, ExternalID: "mirror:source-copy",
		NodeID: &remote.node.ID, NodeRevision: 1,
		Kind: meta.SourceItemKindFile, Path: remote.node.Name,
		Size: 1024, SHA256: hash, State: meta.SourceItemStateSynced,
		LastSeenAt: time.Now().UTC().Add(-48 * time.Hour),
	}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}

	server := &Server{DB: db}
	nodeIDs := []uint64{keeper.node.ID, remote.node.ID}
	// Deliberately try to concentrate user annotations on the Mirror-owned
	// duplicate instead of the independent local keeper. This must fail:
	// the provider may later remove that Node under the normal Mirror grace
	// policy, hiding the newly aggregated keeper annotations from Gallery.
	mirrorKeeperPlan, err := server.queryMediaDuplicateOrganizePlan(
		context.Background(), owner.ID, remote.node.ID, nodeIDs,
	)
	if err != nil {
		t.Fatal(err)
	}
	if mirrorKeeperPlan.AssetComparison != duplicateAssetIdentical ||
		!mediaDuplicateOrganizeKeeperMirrorManaged(mirrorKeeperPlan) ||
		mirrorKeeperPlan.ReadyForManualReview ||
		!strings.Contains(mirrorKeeperPlan.SourceWarning, "Mirror") {
		t.Fatalf("Mirror-owned keeper must not receive a metadata union: %+v", mirrorKeeperPlan)
	}
	_, err = server.applyMediaDuplicateOrganizeMetadata(
		context.Background(), owner.ID, mediaDuplicateOrganizeApplyInput{
			KeeperNodeID: remote.node.ID, NodeIDs: nodeIDs,
			ExpectedPlanRevision: mirrorKeeperPlan.PlanRevision, Confirm: true,
		},
	)
	if !errors.Is(err, errMediaDuplicateOrganizeConflict) {
		t.Fatalf("Mirror-owned keeper annotation union must fail closed: %v", err)
	}
	var rejectedKeeper meta.PhotoMetadata
	if err := db.Where("asset_id = ?", remote.asset.ID).First(&rejectedKeeper).Error; err != nil {
		t.Fatal(err)
	}
	if !rejectedKeeper.Favorite || rejectedKeeper.TagsJSON != `["source"]` ||
		rejectedKeeper.Description != "" {
		t.Fatalf("rejected Mirror keeper union mutated original annotations: %+v", rejectedKeeper)
	}

	plan, err := server.queryMediaDuplicateOrganizePlan(
		context.Background(), owner.ID, keeper.node.ID, nodeIDs,
	)
	if err != nil {
		t.Fatal(err)
	}
	if plan.AssetComparison != duplicateAssetIdentical ||
		!plan.ReadyForManualReview || plan.SourceManagedAssets != 1 ||
		len(plan.Members) != 2 {
		t.Fatalf("source-aware metadata plan must be conservative: %+v", plan)
	}
	apply, err := server.applyMediaDuplicateOrganizeMetadata(
		context.Background(), owner.ID, mediaDuplicateOrganizeApplyInput{
			KeeperNodeID: keeper.node.ID, NodeIDs: nodeIDs,
			ExpectedPlanRevision: plan.PlanRevision, Confirm: true,
		},
	)
	if err != nil || !apply.OriginalFilesRetained ||
		!apply.OriginalEditsRetained || apply.PhysicalBytesReclaimed != 0 {
		t.Fatalf("annotation union changed originals: %+v err=%v", apply, err)
	}
	verifyKeeper := func(phase string) {
		t.Helper()
		var saved meta.PhotoMetadata
		if err := db.Where("asset_id = ?", keeper.asset.ID).First(&saved).Error; err != nil {
			t.Fatal(err)
		}
		if !saved.Favorite || saved.Description != "keep annotation" ||
			saved.TagsJSON != `["keeper","source"]` {
			t.Fatalf("phase=%s keeper lost annotations: %+v", phase, saved)
		}
		var keeperNode meta.Node
		if err := db.First(&keeperNode, keeper.node.ID).Error; err != nil {
			t.Fatal(err)
		}
		if keeperNode.DeletedAt != nil {
			t.Fatalf("phase=%s local keeper unexpectedly trashed: %+v", phase, keeperNode)
		}
	}
	verifyKeeper("after confirmed union")

	finishComplete := `{"status":"completed","complete_inventory":true,"summary":{}}`
	finishEmptyInventory := func() {
		t.Helper()
		runID := uuid.NewString()
		request(t, router, http.MethodPost,
			fmt.Sprintf("/api/v1/sources/%d/runs", source.ID), token,
			strings.NewReader(fmt.Sprintf(`{"run_id":%q,"trigger":"scheduled"}`, runID)),
			http.StatusCreated)
		request(t, router, http.MethodPost,
			fmt.Sprintf("/api/v1/sources/%d/runs/%s/finish", source.ID, runID),
			token, strings.NewReader(finishComplete), http.StatusOK)
	}
	finishEmptyInventory()
	var afterFirst meta.SourceItem
	if err := db.First(&afterFirst, item.ID).Error; err != nil {
		t.Fatal(err)
	}
	if afterFirst.MirrorMissingFullScans != 1 ||
		afterFirst.MirrorMissingSince == nil || afterFirst.State != meta.SourceItemStateMissing {
		t.Fatalf("first full Mirror inventory must only accumulate evidence: %+v", afterFirst)
	}
	var firstNode meta.Node
	if err := db.First(&firstNode, remote.node.ID).Error; err != nil {
		t.Fatal(err)
	}
	if firstNode.DeletedAt != nil {
		t.Fatalf("first inventory prematurely trashed source duplicate: %+v", firstNode)
	}
	verifyKeeper("after one inventory")

	matureSince := time.Now().UTC().Add(-sourcepkg.MirrorMissingGrace - time.Minute)
	if err := db.Model(&meta.SourceItem{}).
		Where("id = ?", item.ID).
		Update("mirror_missing_since", matureSince).Error; err != nil {
		t.Fatal(err)
	}
	finishEmptyInventory()
	var sourceNode meta.Node
	if err := db.First(&sourceNode, remote.node.ID).Error; err != nil {
		t.Fatal(err)
	}
	if sourceNode.DeletedAt == nil || sourceNode.TrashRootID == nil ||
		*sourceNode.TrashRootID != remote.node.ID {
		t.Fatalf("mature Mirror evidence must trash only the source-owned copy: %+v", sourceNode)
	}
	verifyKeeper("after source copy entered trash")
	var untouched meta.PhotoMetadata
	if err := db.Where("asset_id = ?", remote.asset.ID).First(&untouched).Error; err != nil {
		t.Fatal(err)
	}
	if !untouched.Favorite || untouched.TagsJSON != `["source"]` {
		t.Fatalf("trashed original must retain its annotations: %+v", untouched)
	}
	var assets, resources int64
	if err := db.Model(&meta.PhotoAsset{}).
		Where("id IN ?", []uint64{keeper.asset.ID, remote.asset.ID}).
		Count(&assets).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.PhotoResource{}).
		Where("asset_id IN ?", []uint64{keeper.asset.ID, remote.asset.ID}).
		Count(&resources).Error; err != nil {
		t.Fatal(err)
	}
	if assets != 2 || resources != 2 {
		t.Fatalf("Mirror trash removed original PhotoAssets or resources: assets=%d resources=%d",
			assets, resources)
	}
}
