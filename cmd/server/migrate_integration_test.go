package main

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourcecredential"
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
	target := meta.Node{
		ParentID: &root.ID, Name: "imports", Type: meta.NodeTypeDir,
		OwnerID: user.ID, Revision: 1,
	}
	if err := db.Create(&target).Error; err != nil {
		t.Fatal(err)
	}
	node := meta.Node{
		ParentID: &target.ID, Name: "photo.jpg", Type: meta.NodeTypeFile,
		OwnerID: user.ID, Revision: 1,
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}

	source := meta.Source{
		OwnerID: user.ID, Name: "Family NAS", Kind: "test_connector",
		Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusActive, Revision: 1,
		TargetNodeID: &target.ID, IgnoreRules: "@eaDir/\n*.tmp\n",
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
	runID := uuid.NewString()
	item := meta.SourceItem{
		SourceID: source.ID, ExternalID: "asset-123", NodeID: &node.ID,
		Kind: meta.SourceItemKindFile, Path: "photos/photo.jpg", Size: 123,
		State: meta.SourceItemStateSynced, LastSeenRunID: runID, LastSeenAt: now, LastSyncedAt: &now,
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
		ID: runID, SourceID: source.ID, Mode: meta.SourceRunModeScan,
		Trigger: meta.SyncRunTriggerScheduled, Status: meta.SyncRunStatusRunning,
		ScannedItems: 1, ScannedBytes: 123, PlannedTransferItems: 1, PlannedTransferBytes: 123,
		StartedAt: now,
	}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}

	keyring, err := connectorsecret.NewKeyring(1, map[uint32]string{
		1: strings.Repeat("11", 32),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := sourcecredential.Put(context.Background(), db, keyring, source, []byte(`{"cookie":"secret"}`)); err != nil {
		t.Fatal(err)
	}
	plain, err := sourcecredential.Get(context.Background(), db, keyring, source)
	if err != nil {
		t.Fatal(err)
	}
	if string(plain) != `{"cookie":"secret"}` {
		t.Fatalf("credential plaintext=%q", plain)
	}

	collection := meta.SourceCollection{
		SourceID: source.ID, ExternalID: "album-1", Kind: "album", Name: "Album",
		State: meta.SourceCollectionStateActive, LastSeenRunID: run.ID, LastSeenAt: now,
	}
	if err := db.Create(&collection).Error; err != nil {
		t.Fatal(err)
	}
	membership := meta.SourceCollectionItem{
		CollectionID: collection.ID, SourceItemID: item.ID, Position: 0,
		LastSeenRunID: run.ID, LastSeenAt: now,
	}
	if err := db.Create(&membership).Error; err != nil {
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
	if detached.LastSeenRunID != run.ID {
		t.Fatalf("source item run identity=%q want=%q", detached.LastSeenRunID, run.ID)
	}

	if err := db.Delete(&target).Error; err != nil {
		t.Fatal(err)
	}
	var detachedSource meta.Source
	if err := db.First(&detachedSource, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if detachedSource.TargetNodeID != nil {
		t.Fatalf("source target mapping survived target deletion: %v", *detachedSource.TargetNodeID)
	}

	if err := db.Delete(&source).Error; err != nil {
		t.Fatal(err)
	}
	var itemCount, runCount, credentialCount, collectionCount, membershipCount int64
	if err := db.Model(&meta.SourceItem{}).Where("source_id = ?", source.ID).Count(&itemCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.SyncRun{}).Where("source_id = ?", source.ID).Count(&runCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.SourceCredential{}).Where("source_id = ?", source.ID).Count(&credentialCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.SourceCollection{}).Where("source_id = ?", source.ID).Count(&collectionCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.SourceCollectionItem{}).Where("collection_id = ?", collection.ID).Count(&membershipCount).Error; err != nil {
		t.Fatal(err)
	}
	if itemCount != 0 || runCount != 0 || credentialCount != 0 || collectionCount != 0 || membershipCount != 0 {
		t.Fatalf("source cascade cleanup failed: items=%d runs=%d credentials=%d collections=%d memberships=%d",
			itemCount, runCount, credentialCount, collectionCount, membershipCount)
	}
}
