package maintenance

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

func TestPlanMediaRepairGroupsThumbnailIssuesPerNode(t *testing.T) {
	report := MediaVerifyReport{Issues: []MediaIntegrityIssue{
		{OwnerID: 1, NodeID: 10, StorageKey: ".xdrive-media/thumbnails/a.jpg", Reason: "thumbnail_storage_missing"},
		{OwnerID: 1, NodeID: 10, StorageKey: ".xdrive-media/thumbnails/a.jpg", Reason: "thumbnail_mime_invalid"},
		{OwnerID: 1, NodeID: 11, Reason: "metadata_sha_stale"},
	}}
	actions, skipped := planMediaRepair(report)
	if len(actions) != 1 {
		t.Fatalf("actions=%+v", actions)
	}
	if actions[0].NodeID != 10 || len(actions[0].Reasons) != 2 ||
		actions[0].Reasons[0] != "thumbnail_mime_invalid" ||
		actions[0].Reasons[1] != "thumbnail_storage_missing" {
		t.Fatalf("action=%+v", actions[0])
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
		IndexState: meta.MediaIndexStateReady,
	}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}

	storageRoot := t.TempDir()
	dry, err := RepairMedia(context.Background(), db, storageRoot, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(dry.Actions) != 1 || dry.Actions[0].Applied {
		t.Fatalf("dry-run actions=%+v", dry.Actions)
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
	if len(second.Actions) != 0 || !second.After.OK() {
		t.Fatalf("second repair=%+v", second)
	}
}
