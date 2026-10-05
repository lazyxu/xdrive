package maintenance

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/mediagroup"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photoasset"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestPlanMediaRepairGroupsThumbnailAndRelationIssues(t *testing.T) {
	report := MediaVerifyReport{Issues: []MediaIntegrityIssue{
		{OwnerID: 1, NodeID: 10, StorageKey: ".xdrive-media/thumbnails/a.jpg", Reason: "thumbnail_storage_missing"},
		{OwnerID: 1, NodeID: 10, StorageKey: ".xdrive-media/thumbnails/a.jpg", Reason: "thumbnail_mime_invalid"},
		{OwnerID: 1, GroupID: 20, NodeID: 11, Reason: "group_item_role_missing"},
		{OwnerID: 1, GroupID: 20, Reason: "group_empty"},
		{OwnerID: 1, NodeID: 12, Reason: "metadata_sha_stale"},
	}}
	actions, relationActions, skipped := planMediaRepair(report)
	if len(actions) != 1 {
		t.Fatalf("thumbnail actions=%+v", actions)
	}
	if actions[0].NodeID != 10 || len(actions[0].Reasons) != 2 ||
		actions[0].Reasons[0] != "thumbnail_mime_invalid" ||
		actions[0].Reasons[1] != "thumbnail_storage_missing" {
		t.Fatalf("thumbnail action=%+v", actions[0])
	}
	if len(relationActions) != 1 {
		t.Fatalf("relation actions=%+v", relationActions)
	}
	if relationActions[0].OwnerID != 1 ||
		len(relationActions[0].GroupIDs) != 1 ||
		relationActions[0].GroupIDs[0] != 20 ||
		len(relationActions[0].Reasons) != 2 ||
		relationActions[0].Reasons[0] != "group_empty" ||
		relationActions[0].Reasons[1] != "group_item_role_missing" {
		t.Fatalf("relation action=%+v", relationActions[0])
	}
	if len(skipped) != 1 || skipped[0].Reason != "metadata_sha_stale" {
		t.Fatalf("skipped=%+v", skipped)
	}
}

func TestRepairMediaResetsThumbnailMetadataIdempotently(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "media_repair_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()

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
		&meta.User{}, &meta.Node{}, &meta.File{},
		&meta.MediaMetadata{}, &meta.MediaDerivedResource{},
		&meta.MediaGroup{}, &meta.MediaGroupItem{},
	); err != nil {
		t.Fatal(err)
	}

	user := meta.User{
		Username: "media-repair-owner", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	rootNode := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&rootNode).Error; err != nil {
		t.Fatal(err)
	}
	node := meta.Node{
		ParentID: &rootNode.ID, Name: "photo.jpg", Type: meta.NodeTypeFile,
		OwnerID: user.ID, Revision: 2,
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	sha := strings.Repeat("a", 64)
	if err := db.Create(&meta.File{
		NodeID: node.ID, Size: 123, SHA256: sha,
		StorageKey: ".xdrive-blobs/sha256/aa/" + sha,
	}).Error; err != nil {
		t.Fatal(err)
	}
	thumbnailKey := ".xdrive-media/thumbnails/aa/" + sha + "-512.jpg"
	row := meta.MediaMetadata{
		NodeID: node.ID, OwnerID: user.ID, NodeRevision: node.Revision,
		SHA256: sha, MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
		ThumbnailKey: thumbnailKey, ThumbnailMIMEType: "image/jpeg",
		ThumbnailWidth: 512, ThumbnailHeight: 384,
		IndexState:              meta.MediaIndexStateReady,
		RelationEvidenceVersion: mediapkg.RelationEvidenceVersion,
	}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}

	storageRoot := t.TempDir()
	dry, err := RepairMedia(context.Background(), db, storageRoot, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(dry.Actions) != 1 || dry.Actions[0].Applied || len(dry.RelationActions) != 0 {
		t.Fatalf("dry-run actions=%+v relations=%+v", dry.Actions, dry.RelationActions)
	}
	var unchanged meta.MediaMetadata
	if err := db.First(&unchanged, "node_id = ?", node.ID).Error; err != nil {
		t.Fatal(err)
	}
	if unchanged.ThumbnailKey != thumbnailKey {
		t.Fatalf("dry-run changed thumbnail key to %q", unchanged.ThumbnailKey)
	}

	applied, err := RepairMedia(context.Background(), db, storageRoot, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(applied.Actions) != 1 || !applied.Actions[0].Applied {
		t.Fatalf("applied actions=%+v", applied.Actions)
	}
	if !applied.After.OK() {
		t.Fatalf("after issues=%+v", applied.After.Issues)
	}
	var repaired meta.MediaMetadata
	if err := db.First(&repaired, "node_id = ?", node.ID).Error; err != nil {
		t.Fatal(err)
	}
	if repaired.ThumbnailKey != "" || repaired.ThumbnailMIMEType != "" ||
		repaired.ThumbnailWidth != 0 || repaired.ThumbnailHeight != 0 {
		t.Fatalf("thumbnail metadata not reset: %+v", repaired)
	}

	second, err := RepairMedia(context.Background(), db, storageRoot, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Actions) != 0 || len(second.RelationActions) != 0 || !second.After.OK() {
		t.Fatalf("second repair=%+v", second)
	}
}

func TestRepairMediaRebuildsRelationsAndPreservesUserMetadata(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "media_relation_repair_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()

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
		&meta.User{}, &meta.Node{}, &meta.File{},
		&meta.Source{}, &meta.SourceItem{},
		&meta.SourceCollection{}, &meta.SourceCollectionItem{},
		&meta.MediaMetadata{}, &meta.MediaDerivedResource{},
		&meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.PhotoAsset{}, &meta.PhotoResource{}, &meta.PhotoMetadata{},
		&meta.PhotoCollection{}, &meta.PhotoCollectionAsset{},
	); err != nil {
		t.Fatal(err)
	}

	user := meta.User{
		Username: "media-relation-repair-owner", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	nodes := []meta.Node{
		{ParentID: &root.ID, Name: "capture.dng", Type: meta.NodeTypeFile, OwnerID: user.ID, Revision: 1},
		{ParentID: &root.ID, Name: "rendered.jpg", Type: meta.NodeTypeFile, OwnerID: user.ID, Revision: 1},
	}
	if err := db.Create(&nodes).Error; err != nil {
		t.Fatal(err)
	}
	shas := []string{strings.Repeat("a", 64), strings.Repeat("b", 64)}
	for index := range nodes {
		if err := db.Create(&meta.File{
			NodeID:     nodes[index].ID,
			Size:       100 + int64(index),
			SHA256:     shas[index],
			StorageKey: ".xdrive-blobs/sha256/" + shas[index][:2] + "/" + shas[index],
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
	rows := []meta.MediaMetadata{
		{
			NodeID: nodes[0].ID, OwnerID: user.ID, NodeRevision: 1, SHA256: shas[0],
			MediaKind: meta.MediaKindImage, MIMEType: "image/x-adobe-dng",
			IndexState:              meta.MediaIndexStateReady,
			RelationEvidenceVersion: mediapkg.RelationEvidenceVersion,
			RelationJSON:            `{"image_unique_id":"capture-1"}`,
		},
		{
			NodeID: nodes[1].ID, OwnerID: user.ID, NodeRevision: 1, SHA256: shas[1],
			MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
			IndexState:              meta.MediaIndexStateReady,
			RelationEvidenceVersion: mediapkg.RelationEvidenceVersion,
			RelationJSON:            `{"image_unique_id":"capture-1"}`,
		},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}

	if err := mediagroup.ReconcileOwnerLocalGroups(context.Background(), db, user.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := photoasset.ReconcileOwner(context.Background(), db, user.ID); err != nil {
		t.Fatal(err)
	}

	var group meta.MediaGroup
	if err := db.Where(
		"owner_id = ? AND kind = ?",
		user.ID,
		meta.MediaGroupKindRAWPair,
	).First(&group).Error; err != nil {
		t.Fatal(err)
	}
	var asset meta.PhotoAsset
	if err := db.Where(
		"owner_id = ? AND primary_node_id = ?",
		user.ID,
		nodes[1].ID,
	).First(&asset).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.PhotoMetadata{}).
		Where("asset_id = ?", asset.ID).
		Updates(map[string]any{
			"favorite":    true,
			"description": "keep-description",
			"tags_json":   `["keep-tag"]`,
			"people_json": `["Keep Person"]`,
		}).Error; err != nil {
		t.Fatal(err)
	}

	if err := db.Model(&meta.MediaGroupItem{}).
		Where("group_id = ? AND node_id = ?", group.ID, nodes[0].ID).
		Update("role", meta.MediaGroupRoleAuxiliary).Error; err != nil {
		t.Fatal(err)
	}

	storageRoot := t.TempDir()
	before, err := VerifyMediaWithStorageRoot(db, storageRoot)
	if err != nil {
		t.Fatal(err)
	}
	foundStaleProjection := false
	for _, issue := range before.Issues {
		if issue.OwnerID == user.ID && issue.Reason == "local_relation_projection_stale" {
			foundStaleProjection = true
		}
	}
	if !foundStaleProjection {
		t.Fatalf("stale local relation projection was not detected: %+v", before.Issues)
	}

	dry, err := RepairMedia(context.Background(), db, storageRoot, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(dry.RelationActions) != 1 || dry.RelationActions[0].Applied {
		t.Fatalf("dry relation actions=%+v", dry.RelationActions)
	}
	var dryMember meta.MediaGroupItem
	if err := db.Where("group_id = ? AND node_id = ?", group.ID, nodes[0].ID).
		First(&dryMember).Error; err != nil {
		t.Fatal(err)
	}
	if dryMember.Role != meta.MediaGroupRoleAuxiliary {
		t.Fatalf("dry-run changed relation role to %q", dryMember.Role)
	}

	applied, err := RepairMedia(context.Background(), db, storageRoot, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(applied.RelationActions) != 1 || !applied.RelationActions[0].Applied {
		t.Fatalf("applied relation actions=%+v", applied.RelationActions)
	}
	if !applied.After.OK() {
		t.Fatalf("after issues=%+v", applied.After.Issues)
	}

	var repairedMember meta.MediaGroupItem
	if err := db.Where("group_id = ? AND node_id = ?", group.ID, nodes[0].ID).
		First(&repairedMember).Error; err != nil {
		t.Fatal(err)
	}
	if repairedMember.Role != meta.MediaGroupRoleRAW {
		t.Fatalf("repaired role=%q want=%q", repairedMember.Role, meta.MediaGroupRoleRAW)
	}

	var sameAsset meta.PhotoAsset
	if err := db.Where(
		"owner_id = ? AND primary_node_id = ?",
		user.ID,
		nodes[1].ID,
	).First(&sameAsset).Error; err != nil {
		t.Fatal(err)
	}
	if sameAsset.ID != asset.ID {
		t.Fatalf("photo asset id changed: %d -> %d", asset.ID, sameAsset.ID)
	}
	var local meta.PhotoMetadata
	if err := db.First(&local, "asset_id = ?", asset.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !local.Favorite ||
		local.Description != "keep-description" ||
		local.TagsJSON != `["keep-tag"]` ||
		local.PeopleJSON != `["Keep Person"]` {
		t.Fatalf("user metadata changed during relation repair: %+v", local)
	}

	second, err := RepairMedia(context.Background(), db, storageRoot, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Actions) != 0 || len(second.RelationActions) != 0 || !second.After.OK() {
		t.Fatalf("second relation repair=%+v", second)
	}
}
