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

func TestMigrateBackfillsUploadReservations(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "migrate_upload_reservation_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	user := meta.User{Username: "reservation-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	active := meta.UploadSession{
		ID: "active-reservation", OwnerID: user.ID,
		TotalSize: 100, ChunkSize: 40, ChunkCount: 3,
		Status: meta.UploadStatusActive, ReservedBytes: 0, ExpiresAt: now.Add(time.Hour),
	}
	expired := meta.UploadSession{
		ID: "expired-reservation", OwnerID: user.ID,
		TotalSize: 100, ChunkSize: 100, ChunkCount: 1,
		Status: meta.UploadStatusActive, ReservedBytes: 999, ExpiresAt: now.Add(-time.Hour),
	}
	finalized := meta.UploadSession{
		ID: "finalized-reservation", OwnerID: user.ID,
		TotalSize: 100, ChunkSize: 100, ChunkCount: 1,
		Status: meta.UploadStatusFinalized, ReservedBytes: 999, ExpiresAt: now.Add(time.Hour),
	}
	if err := db.Create(&[]meta.UploadSession{active, expired, finalized}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.UploadPart{
		SessionID: active.ID, PartIndex: 0, Size: 40,
		SHA256: strings.Repeat("a", 64), StorageKey: ".xdrive-uploads/active/part",
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	var gotActive, gotExpired, gotFinalized meta.UploadSession
	if err := db.First(&gotActive, "id = ?", active.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&gotExpired, "id = ?", expired.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&gotFinalized, "id = ?", finalized.ID).Error; err != nil {
		t.Fatal(err)
	}
	if gotActive.ReservedBytes != 160 {
		t.Fatalf("active reserved_bytes=%d want=160", gotActive.ReservedBytes)
	}
	if gotExpired.ReservedBytes != 0 || gotFinalized.ReservedBytes != 0 {
		t.Fatalf("inactive reservations not cleared: expired=%d finalized=%d", gotExpired.ReservedBytes, gotFinalized.ReservedBytes)
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
	failure := meta.SourceRunFailure{
		RunID: run.ID, SourceID: source.ID, SourceItemID: item.ID,
		ExternalID: item.ExternalID, Kind: item.Kind, Path: item.Path, Size: item.Size,
		Error: "historical failure", FailedAt: now,
	}
	if err := db.Create(&failure).Error; err != nil {
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
	remoteCreated := now.Add(-time.Hour)
	mediaMetadata := meta.SourceItemMetadata{
		SourceItemID: item.ID, SourceID: source.ID,
		OriginalPath: "/photo.jpg", OwnerExternalID: "123",
		RemoteCreatedAt: &remoteCreated, ContentMD5: strings.Repeat("a", 32),
		ThumbnailURL: "https://thumb.example/photo.jpg",
	}
	if err := db.Create(&mediaMetadata).Error; err != nil {
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
	var retainedMetadata meta.SourceItemMetadata
	if err := db.First(&retainedMetadata, "source_item_id = ?", item.ID).Error; err != nil {
		t.Fatal(err)
	}
	if retainedMetadata.ContentMD5 != strings.Repeat("a", 32) {
		t.Fatalf("source metadata changed after node deletion: %+v", retainedMetadata)
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
	var itemCount, runCount, failureCount, credentialCount, collectionCount, membershipCount, metadataCount int64
	if err := db.Model(&meta.SourceItem{}).Where("source_id = ?", source.ID).Count(&itemCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.SyncRun{}).Where("source_id = ?", source.ID).Count(&runCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.SourceRunFailure{}).Where("source_id = ?", source.ID).Count(&failureCount).Error; err != nil {
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
	if err := db.Model(&meta.SourceItemMetadata{}).Where("source_id = ?", source.ID).Count(&metadataCount).Error; err != nil {
		t.Fatal(err)
	}
	if itemCount != 0 || runCount != 0 || failureCount != 0 || credentialCount != 0 || collectionCount != 0 || membershipCount != 0 || metadataCount != 0 {
		t.Fatalf("source cascade cleanup failed: items=%d runs=%d failures=%d credentials=%d collections=%d memberships=%d metadata=%d",
			itemCount, runCount, failureCount, credentialCount, collectionCount, membershipCount, metadataCount)
	}
}

func TestMigrateBackfillsRecoverableSourceRunFailures(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "migrate_source_failures_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.Source{}, &meta.SourceItem{}, &meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	user := meta.User{Username: "migrate-source-failure-user", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID: user.ID, Name: "Legacy source", Kind: "yike_photos", Direction: meta.SourceDirectionPull,
		SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusActive, Revision: 1,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	runID := uuid.NewString()
	started := time.Now().UTC().Add(-time.Minute)
	run := meta.SyncRun{
		ID: runID, SourceID: source.ID, SourceRevision: 1, Mode: meta.SourceRunModeSync,
		Trigger: meta.SyncRunTriggerManual, Status: meta.SyncRunStatusPartial, FailedItems: 1, StartedAt: started,
	}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	item := meta.SourceItem{
		SourceID: source.ID, ExternalID: "legacy-file", Kind: meta.SourceItemKindFile,
		Path: "Library/legacy.jpg", Size: 123, State: meta.SourceItemStateError,
		LastSeenRunID: runID, LastSeenAt: started, LastError: "legacy download failed",
	}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	var failure meta.SourceRunFailure
	if err := db.Where("run_id = ? AND source_item_id = ?", runID, item.ID).First(&failure).Error; err != nil {
		t.Fatal(err)
	}
	if failure.Path != item.Path || failure.Error != item.LastError || failure.ExternalID != item.ExternalID {
		t.Fatalf("unexpected backfilled source run failure: %+v", failure)
	}
}

func TestMigrateBackfillsStableSourceRunNumbers(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "migrate_source_run_numbers_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	user := meta.User{Username: "run-number-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID: user.ID, Name: "Run Number Source", Kind: "test_connector",
		Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusActive, Revision: 1,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 9, 28, 1, 0, 0, 0, time.UTC)
	runs := []meta.SyncRun{
		{ID: uuid.NewString(), SourceID: source.ID, Mode: meta.SourceRunModeScan, Trigger: meta.SyncRunTriggerManual, Status: meta.SyncRunStatusCompleted, StartedAt: base.Add(2 * time.Hour)},
		{ID: uuid.NewString(), SourceID: source.ID, Mode: meta.SourceRunModeScan, Trigger: meta.SyncRunTriggerManual, Status: meta.SyncRunStatusCompleted, StartedAt: base},
		{ID: uuid.NewString(), SourceID: source.ID, Mode: meta.SourceRunModeScan, Trigger: meta.SyncRunTriggerScheduled, Status: meta.SyncRunStatusFailed, StartedAt: base.Add(time.Hour)},
	}
	if err := db.Create(&runs).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	var ordered []meta.SyncRun
	if err := db.Where("source_id = ?", source.ID).Order("started_at ASC").Find(&ordered).Error; err != nil {
		t.Fatal(err)
	}
	if len(ordered) != 3 || ordered[0].RunNumber != 1 || ordered[1].RunNumber != 2 || ordered[2].RunNumber != 3 {
		t.Fatalf("unexpected run numbers: %+v", ordered)
	}
	duplicate := meta.SyncRun{
		ID: uuid.NewString(), SourceID: source.ID, RunNumber: 3,
		Mode: meta.SourceRunModeScan, Trigger: meta.SyncRunTriggerManual,
		Status: meta.SyncRunStatusCompleted, StartedAt: base.Add(3 * time.Hour),
	}
	if err := db.Create(&duplicate).Error; err == nil {
		t.Fatal("duplicate per-source run number was accepted")
	}
}
