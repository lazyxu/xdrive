package api

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

func TestMediaGalleryIndexStatusOwnerScopeAndIncompleteEvidence(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	baseSQLDB, err := baseDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer baseSQLDB.Close()
	baseSQLDB.SetMaxOpenConns(2)
	baseSQLDB.SetMaxIdleConns(1)
	schema := "media_index_status_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf("CREATE SCHEMA \"%s\"", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = baseDB.Exec(fmt.Sprintf("DROP SCHEMA \"%s\" CASCADE", schema)).Error }()

	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := u.Query()
	query.Set("search_path", schema)
	u.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	sqlDB.SetMaxOpenConns(2)
	sqlDB.SetMaxIdleConns(1)
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{},
		&meta.MediaMetadata{}, &meta.PhotoAsset{},
	); err != nil {
		t.Fatal(err)
	}

	users := []meta.User{
		{Username: "media-status-a", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1},
		{Username: "media-status-b", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1},
	}
	if err := db.Create(&users).Error; err != nil {
		t.Fatal(err)
	}
	folderIDs := make(map[uint64]uint64, len(users))
	for _, user := range users {
		root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
		if err := db.Create(&root).Error; err != nil {
			t.Fatal(err)
		}
		folder := meta.Node{
			ParentID: &root.ID, Name: "Imported", Type: meta.NodeTypeDir,
			OwnerID: user.ID, Revision: 1,
		}
		if err := db.Create(&folder).Error; err != nil {
			t.Fatal(err)
		}
		folderIDs[user.ID] = folder.ID
	}
	makeAsset := func(ownerID uint64, title, state string) uint64 {
		t.Helper()
		folderID := folderIDs[ownerID]
		node := meta.Node{ParentID: &folderID, Name: title, Type: meta.NodeTypeFile, OwnerID: ownerID, Revision: 1}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		asset := meta.PhotoAsset{
			OwnerID: ownerID, PrimaryNodeID: node.ID,
			Kind: meta.PhotoAssetKindImage, EvidenceKey: "test:" + title,
		}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		if state != "" {
			md := meta.MediaMetadata{
				NodeID: node.ID, OwnerID: ownerID, NodeRevision: 1,
				MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
				IndexState: state,
			}
			if err := db.Create(&md).Error; err != nil {
				t.Fatal(err)
			}
		}
		return node.ID
	}
	makeAsset(users[0].ID, "ready.jpg", meta.MediaIndexStateReady)
	makeAsset(users[0].ID, "error.jpg", meta.MediaIndexStateError)
	makeAsset(users[0].ID, "unsupported.jpg", meta.MediaIndexStateUnsupported)
	missingID := makeAsset(users[0].ID, "not-indexed.jpg", "")
	makeAsset(users[1].ID, "other-user.jpg", meta.MediaIndexStateReady)

	server := &Server{DB: db}
	first, err := server.queryMediaGalleryIndexStatus(context.Background(), users[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if first.KnownAssets != 4 || first.ReadyAssets != 1 ||
		first.FailedAssets != 1 || first.UnsupportedAssets != 1 ||
		first.MissingMetadataAssets != 1 || first.OtherUnreadyAssets != 0 {
		t.Fatalf("wrong index coverage for owner A: %+v", first)
	}
	if first.Scope != "known_photo_assets" || first.CheckedAt.IsZero() {
		t.Fatalf("index coverage must include truthful scope/time: %+v", first)
	}
	second, err := server.queryMediaGalleryIndexStatus(context.Background(), users[1].ID)
	if err != nil {
		t.Fatal(err)
	}
	if second.KnownAssets != 1 || second.ReadyAssets != 1 ||
		second.MissingMetadataAssets != 0 || second.FailedAssets != 0 {
		t.Fatalf("other owner's status leaked: %+v", second)
	}
	if err := db.Delete(&meta.Node{}, missingID).Error; err != nil {
		t.Fatal(err)
	}
	afterDelete, err := server.queryMediaGalleryIndexStatus(context.Background(), users[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if afterDelete.KnownAssets != 3 || afterDelete.MissingMetadataAssets != 0 {
		t.Fatalf("trashed asset still counted: %+v", afterDelete)
	}
}
