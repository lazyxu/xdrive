package mediagroup

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestReconcileOwnerLocalGroupsRepairsLivePhotoAndDropsInvalidGroups(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "owner_media_relations_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		&meta.User{}, &meta.Node{},
		&meta.MediaMetadata{}, &meta.MediaGroup{}, &meta.MediaGroupItem{},
	); err != nil {
		t.Fatal(err)
	}

	owner := meta.User{
		Username: "owner-reconcile", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	nodes := []meta.Node{
		{ParentID: &root.ID, Name: "IMG_1.HEIC", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
		{ParentID: &root.ID, Name: "IMG_1.MOV", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
	}
	if err := db.Create(&nodes).Error; err != nil {
		t.Fatal(err)
	}
	rows := []meta.MediaMetadata{
		{
			NodeID: nodes[0].ID, OwnerID: owner.ID, NodeRevision: 1,
			MediaKind: meta.MediaKindImage, MIMEType: "image/heic",
			LivePhotoAssetIdentifier: "asset-1",
			IndexState:               meta.MediaIndexStateReady,
			RelationEvidenceVersion:  mediapkg.RelationEvidenceVersion,
		},
		{
			NodeID: nodes[1].ID, OwnerID: owner.ID, NodeRevision: 1,
			MediaKind: meta.MediaKindVideo, MIMEType: "video/quicktime",
			LivePhotoAssetIdentifier: "asset-1",
			IndexState:               meta.MediaIndexStateReady,
			RelationEvidenceVersion:  mediapkg.RelationEvidenceVersion,
		},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if projected, err := ReconcileAppleLivePhoto(context.Background(), db, owner.ID, "asset-1"); err != nil {
		t.Fatal(err)
	} else if !projected {
		t.Fatal("initial live photo was not projected")
	}

	var group meta.MediaGroup
	if err := db.Where(
		"owner_id = ? AND kind = ?",
		owner.ID,
		meta.MediaGroupKindLivePhoto,
	).First(&group).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.MediaGroupItem{}).
		Where("group_id = ? AND node_id = ?", group.ID, nodes[1].ID).
		Update("role", meta.MediaGroupRoleStill).Error; err != nil {
		t.Fatal(err)
	}
	invalid := meta.MediaGroup{
		OwnerID: owner.ID, Kind: "invalid-kind", EvidenceKey: "broken",
	}
	if err := db.Create(&invalid).Error; err != nil {
		t.Fatal(err)
	}
	legacyLivePhoto := meta.MediaGroup{
		OwnerID: owner.ID, Kind: meta.MediaGroupKindLivePhoto,
		EvidenceKey: "legacy-provider-pair:asset-1",
	}
	if err := db.Create(&legacyLivePhoto).Error; err != nil {
		t.Fatal(err)
	}

	if err := ReconcileOwnerLocalGroups(context.Background(), db, owner.ID); err != nil {
		t.Fatal(err)
	}

	var members []meta.MediaGroupItem
	if err := db.Where("group_id = ?", group.ID).
		Order("ordinal ASC").
		Find(&members).Error; err != nil {
		t.Fatal(err)
	}
	if len(members) != 2 ||
		members[0].NodeID != nodes[0].ID || members[0].Role != meta.MediaGroupRoleStill ||
		members[1].NodeID != nodes[1].ID || members[1].Role != meta.MediaGroupRoleMotion {
		t.Fatalf("reconciled members=%+v", members)
	}
	var invalidCount int64
	if err := db.Model(&meta.MediaGroup{}).
		Where("id = ?", invalid.ID).
		Count(&invalidCount).Error; err != nil {
		t.Fatal(err)
	}
	if invalidCount != 0 {
		t.Fatalf("invalid derived group still exists: id=%d", invalid.ID)
	}
	var legacyCount int64
	if err := db.Model(&meta.MediaGroup{}).
		Where("id = ?", legacyLivePhoto.ID).
		Count(&legacyCount).Error; err != nil {
		t.Fatal(err)
	}
	if legacyCount != 0 {
		t.Fatalf("legacy live photo group still exists: id=%d", legacyLivePhoto.ID)
	}

	if err := ReconcileOwnerLocalGroups(context.Background(), db, owner.ID); err != nil {
		t.Fatal(err)
	}
	var again meta.MediaGroup
	if err := db.Where(
		"owner_id = ? AND kind = ? AND evidence_key = ?",
		owner.ID,
		meta.MediaGroupKindLivePhoto,
		"apple-asset:asset-1",
	).First(&again).Error; err != nil {
		t.Fatal(err)
	}
	if again.ID != group.ID {
		t.Fatalf("live photo group id changed: %d -> %d", group.ID, again.ID)
	}
}
