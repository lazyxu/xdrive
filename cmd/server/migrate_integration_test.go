package main

import (
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestMigrateConvertsStorageKeyIndexesToNonUnique(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "migrate_dedup_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error
	}()

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

	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`DROP INDEX IF EXISTS idx_xd_files_storage_key`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_files_storage_key ON xd_files(storage_key)`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`DROP INDEX IF EXISTS idx_xd_file_versions_storage_key`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_file_versions_storage_key ON xd_file_versions(storage_key)`).Error; err != nil {
		t.Fatal(err)
	}

	if err := migrate(db); err != nil {
		t.Fatal(err)
	}

	user := meta.User{Username: "migrate-dedup-user", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	first := meta.Node{ParentID: &root.ID, Name: "a.bin", Type: meta.NodeTypeFile, OwnerID: user.ID, Revision: 1}
	second := meta.Node{ParentID: &root.ID, Name: "b.bin", Type: meta.NodeTypeFile, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&first).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&second).Error; err != nil {
		t.Fatal(err)
	}
	const sharedKey = ".xdrive-blobs/sha256/aa/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	if err := db.Create(&meta.File{NodeID: first.ID, Size: 1, StorageKey: sharedKey}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{NodeID: second.ID, Size: 1, StorageKey: sharedKey}).Error; err != nil {
		t.Fatalf("shared file storage_key remained unique after migration: %v", err)
	}
	if err := db.Create(&meta.FileVersion{NodeID: first.ID, Revision: 1, Size: 1, StorageKey: sharedKey}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.FileVersion{NodeID: second.ID, Revision: 1, Size: 1, StorageKey: sharedKey}).Error; err != nil {
		t.Fatalf("shared version storage_key remained unique after migration: %v", err)
	}
}

func TestMigrateCreatesExternalSourceFoundation(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "migrate_sources_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error
	}()

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
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}

	user := meta.User{
		Username: "source-owner", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	node := meta.Node{
		ParentID: &root.ID, Name: "photo.jpg", Type: meta.NodeTypeFile,
		OwnerID: user.ID, Revision: 1,
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}

	source := meta.Source{
		OwnerID: user.ID, Name: "Family NAS", Kind: "test_connector",
		Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
		Status: meta.SourceStatusActive, Revision: 1,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	duplicateName := meta.Source{
		OwnerID: user.ID, Name: "family nas", Kind: "other_connector",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		Status: meta.SourceStatusActive, Revision: 1,
	}
	if err := db.Create(&duplicateName).Error; err == nil {
		t.Fatal("case-insensitive duplicate source name was accepted")
	}

	now := time.Now().UTC()
	item := meta.SourceItem{
		SourceID: source.ID, ExternalID: "asset-123", NodeID: &node.ID,
		Kind: meta.SourceItemKindFile, Path: "/photos/photo.jpg", Size: 123,
		State: meta.SourceItemStateSynced, LastSeenAt: now, LastSyncedAt: &now,
	}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}
	duplicateItem := item
	duplicateItem.ID = 0
	duplicateItem.NodeID = nil
	if err := db.Create(&duplicateItem).Error; err == nil {
		t.Fatal("duplicate source external identity was accepted")
	}

	run := meta.SyncRun{
		ID: uuid.NewString(), SourceID: source.ID,
		Trigger: meta.SyncRunTriggerScheduled, Status: meta.SyncRunStatusRunning,
		StartedAt: now,
	}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}

	if err := db.Delete(&node).Error; err != nil {
		t.Fatal(err)
	}
	var detached meta.SourceItem
	if err := db.First(&detached, item.ID).Error; err != nil {
		t.Fatal(err)
	}
	if detached.NodeID != nil {
		t.Fatalf("source item node mapping survived node deletion: %v", *detached.NodeID)
	}

	if err := db.Delete(&source).Error; err != nil {
		t.Fatal(err)
	}
	var itemCount, runCount int64
	if err := db.Model(&meta.SourceItem{}).Where("source_id = ?", source.ID).Count(&itemCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.SyncRun{}).Where("source_id = ?", source.ID).Count(&runCount).Error; err != nil {
		t.Fatal(err)
	}
	if itemCount != 0 || runCount != 0 {
		t.Fatalf("source cascade cleanup failed: items=%d runs=%d", itemCount, runCount)
	}
}
