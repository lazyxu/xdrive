package mediagroup

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestApplyLocalSnapshotIsOwnerScopedAndIdempotent(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "media_groups_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		&meta.User{}, &meta.Node{}, &meta.MediaGroup{}, &meta.MediaGroupItem{},
	); err != nil {
		t.Fatal(err)
	}

	owner := meta.User{Username: "media-group-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	other := meta.User{Username: "media-group-other", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	ownerRoot := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 1}
	otherRoot := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: other.ID, Revision: 1}
	if err := db.Create(&ownerRoot).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&otherRoot).Error; err != nil {
		t.Fatal(err)
	}
	nodes := []meta.Node{
		{ParentID: &ownerRoot.ID, Name: "IMG_0001.HEIC", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
		{ParentID: &ownerRoot.ID, Name: "IMG_0001.MOV", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
		{ParentID: &ownerRoot.ID, Name: "IMG_0001.livp", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
		{ParentID: &otherRoot.ID, Name: "foreign.MOV", Type: meta.NodeTypeFile, OwnerID: other.ID, Revision: 1},
	}
	if err := db.Create(&nodes).Error; err != nil {
		t.Fatal(err)
	}

	snapshot := Snapshot{
		Kind: meta.MediaGroupKindLivePhoto, EvidenceKey: "apple-asset:asset-123",
		Members: []MemberSnapshot{
			{NodeID: nodes[0].ID, Role: meta.MediaGroupRoleStill, Ordinal: 0},
			{NodeID: nodes[1].ID, Role: meta.MediaGroupRoleMotion, Ordinal: 1},
			{NodeID: nodes[2].ID, Role: meta.MediaGroupRoleContainer, Ordinal: 2},
		},
	}
	first, err := ApplyLocalSnapshot(context.Background(), db, owner.ID, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	second, err := ApplyLocalSnapshot(context.Background(), db, owner.ID, snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if second.ID != first.ID {
		t.Fatalf("group id changed across idempotent apply: %d -> %d", first.ID, second.ID)
	}
	var groups int64
	if err := db.Model(&meta.MediaGroup{}).Where("owner_id = ?", owner.ID).Count(&groups).Error; err != nil {
		t.Fatal(err)
	}
	if groups != 1 {
		t.Fatalf("groups=%d want=1", groups)
	}
	var members []meta.MediaGroupItem
	if err := db.Where("group_id = ?", first.ID).Order("ordinal ASC").Find(&members).Error; err != nil {
		t.Fatal(err)
	}
	if len(members) != 3 ||
		members[0].Role != meta.MediaGroupRoleStill ||
		members[1].Role != meta.MediaGroupRoleMotion ||
		members[2].Role != meta.MediaGroupRoleContainer {
		t.Fatalf("members=%+v", members)
	}

	bad := snapshot
	bad.Members = []MemberSnapshot{
		{NodeID: nodes[0].ID, Role: meta.MediaGroupRoleStill, Ordinal: 0},
		{NodeID: nodes[3].ID, Role: meta.MediaGroupRoleMotion, Ordinal: 1},
	}
	if _, err := ApplyLocalSnapshot(context.Background(), db, owner.ID, bad); err == nil {
		t.Fatal("cross-owner member was accepted")
	}
	var retained int64
	if err := db.Model(&meta.MediaGroupItem{}).Where("group_id = ?", first.ID).Count(&retained).Error; err != nil {
		t.Fatal(err)
	}
	if retained != 3 {
		t.Fatalf("failed replacement changed existing membership: %d", retained)
	}
}

func TestMediaGroupConstraintsRejectDuplicateOrdinal(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "media_group_constraints_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()

	u, _ := url.Parse(dsn)
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.MediaGroup{}, &meta.MediaGroupItem{}); err != nil {
		t.Fatal(err)
	}
	user := meta.User{Username: "media-group-constraint-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	nodes := []meta.Node{
		{ParentID: &root.ID, Name: "a.jpg", Type: meta.NodeTypeFile, OwnerID: user.ID, Revision: 1},
		{ParentID: &root.ID, Name: "b.mov", Type: meta.NodeTypeFile, OwnerID: user.ID, Revision: 1},
	}
	if err := db.Create(&nodes).Error; err != nil {
		t.Fatal(err)
	}
	group := meta.MediaGroup{OwnerID: user.ID, Kind: meta.MediaGroupKindLivePhoto, EvidenceKey: "asset:x"}
	if err := db.Create(&group).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.MediaGroupItem{GroupID: group.ID, NodeID: nodes[0].ID, Role: meta.MediaGroupRoleStill, Ordinal: 0}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.MediaGroupItem{GroupID: group.ID, NodeID: nodes[1].ID, Role: meta.MediaGroupRoleMotion, Ordinal: 0}).Error; err == nil {
		t.Fatal("duplicate group ordinal was accepted")
	}
}

func TestReconcileAppleLivePhotoProjectsAndRemovesAmbiguity(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "live_photo_projection_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		&meta.User{}, &meta.Node{}, &meta.MediaMetadata{}, &meta.MediaGroup{}, &meta.MediaGroupItem{},
	); err != nil {
		t.Fatal(err)
	}

	owner := meta.User{Username: "live-photo-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	nodes := []meta.Node{
		{ParentID: &root.ID, Name: "IMG_0001.HEIC", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
		{ParentID: &root.ID, Name: "IMG_0001.MOV", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
		{ParentID: &root.ID, Name: "duplicate.JPG", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
	}
	if err := db.Create(&nodes).Error; err != nil {
		t.Fatal(err)
	}
	const identifier = "A7D2C6A0-94BE-4A65-8502-D11259D7DB83"
	rows := []meta.MediaMetadata{
		{
			NodeID: nodes[0].ID, OwnerID: owner.ID, NodeRevision: 1,
			MediaKind: meta.MediaKindImage, MIMEType: "image/heic",
			LivePhotoAssetIdentifier: identifier, IndexState: meta.MediaIndexStateReady,
		},
		{
			NodeID: nodes[1].ID, OwnerID: owner.ID, NodeRevision: 1,
			MediaKind: meta.MediaKindVideo, MIMEType: "video/quicktime",
			LivePhotoAssetIdentifier: identifier, IndexState: meta.MediaIndexStateReady,
		},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}

	projected, err := ReconcileAppleLivePhoto(context.Background(), db, owner.ID, identifier)
	if err != nil {
		t.Fatal(err)
	}
	if !projected {
		t.Fatal("valid still+motion pair was not projected")
	}
	var group meta.MediaGroup
	if err := db.Where(
		"owner_id = ? AND kind = ? AND evidence_key = ?",
		owner.ID, meta.MediaGroupKindLivePhoto, appleAssetEvidencePrefix+identifier,
	).First(&group).Error; err != nil {
		t.Fatal(err)
	}
	var members []meta.MediaGroupItem
	if err := db.Where("group_id = ?", group.ID).Order("ordinal ASC").Find(&members).Error; err != nil {
		t.Fatal(err)
	}
	if len(members) != 2 ||
		members[0].NodeID != nodes[0].ID || members[0].Role != meta.MediaGroupRoleStill ||
		members[1].NodeID != nodes[1].ID || members[1].Role != meta.MediaGroupRoleMotion {
		t.Fatalf("members=%+v", members)
	}

	duplicate := meta.MediaMetadata{
		NodeID: nodes[2].ID, OwnerID: owner.ID, NodeRevision: 1,
		MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
		LivePhotoAssetIdentifier: identifier, IndexState: meta.MediaIndexStateReady,
	}
	if err := db.Create(&duplicate).Error; err != nil {
		t.Fatal(err)
	}
	projected, err = ReconcileAppleLivePhoto(context.Background(), db, owner.ID, identifier)
	if err != nil {
		t.Fatal(err)
	}
	if projected {
		t.Fatal("ambiguous identifier was projected")
	}
	var groupCount int64
	if err := db.Model(&meta.MediaGroup{}).
		Where("owner_id = ? AND kind = ? AND evidence_key = ?", owner.ID, meta.MediaGroupKindLivePhoto, appleAssetEvidencePrefix+identifier).
		Count(&groupCount).Error; err != nil {
		t.Fatal(err)
	}
	if groupCount != 0 {
		t.Fatalf("ambiguous identifier retained %d group(s)", groupCount)
	}
}
