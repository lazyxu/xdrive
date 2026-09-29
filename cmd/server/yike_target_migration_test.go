package main

import (
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

func openYikeMigrationTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "yike_target_migration_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error
	})

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
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.Source{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	return db
}

func createLegacyYikeMigrationFixture(t *testing.T, db *gorm.DB) (meta.User, meta.Node, meta.Node, meta.Node, meta.Source) {
	t.Helper()
	user := meta.User{Username: "migration-" + uuid.NewString(), PasswordHash: "x", Role: meta.UserRoleUser}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{OwnerID: user.ID, Name: "root", Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	rootID := root.ID
	legacyRoot := meta.Node{OwnerID: user.ID, ParentID: &rootID, Name: legacyYikeTargetRootName, Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&legacyRoot).Error; err != nil {
		t.Fatal(err)
	}
	legacyRootID := legacyRoot.ID
	connector := meta.Node{OwnerID: user.ID, ParentID: &legacyRootID, Name: yikeTargetConnectorName, Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&connector).Error; err != nil {
		t.Fatal(err)
	}
	connectorID := connector.ID
	target := meta.Node{OwnerID: user.ID, ParentID: &connectorID, Name: "uid_12345_张三", Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&target).Error; err != nil {
		t.Fatal(err)
	}
	targetID := target.ID
	source := meta.Source{
		OwnerID: user.ID, Name: "一刻相册", Kind: "yike_photos",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusActive,
		Revision: 1, TargetNodeID: &targetID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	return user, root, connector, target, source
}

func TestMigrateLegacyYikeTargetMovesTargetInPlace(t *testing.T) {
	db := openYikeMigrationTestDB(t)
	user, root, _, target, source := createLegacyYikeMigrationFixture(t, db)

	if err := migrateLegacyYikeTargets(db); err != nil {
		t.Fatal(err)
	}

	var migrated meta.Node
	if err := db.First(&migrated, target.ID).Error; err != nil {
		t.Fatal(err)
	}
	if migrated.ID != target.ID || migrated.ParentID == nil {
		t.Fatalf("migrated target=%+v", migrated)
	}
	var connector meta.Node
	if err := db.First(&connector, *migrated.ParentID).Error; err != nil {
		t.Fatal(err)
	}
	if connector.Name != yikeTargetConnectorName || connector.ParentID == nil {
		t.Fatalf("connector=%+v", connector)
	}
	var syncRoot meta.Node
	if err := db.First(&syncRoot, *connector.ParentID).Error; err != nil {
		t.Fatal(err)
	}
	if syncRoot.Name != yikeTargetRootName || syncRoot.ParentID == nil || *syncRoot.ParentID != root.ID {
		t.Fatalf("sync root=%+v", syncRoot)
	}
	var migratedSource meta.Source
	if err := db.First(&migratedSource, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if migratedSource.TargetNodeID == nil || *migratedSource.TargetNodeID != target.ID || migratedSource.OwnerID != user.ID {
		t.Fatalf("source target changed unexpectedly: %+v", migratedSource)
	}
}

func TestMigrateLegacyYikeTargetConflictPausesSourceWithoutFailingStartup(t *testing.T) {
	db := openYikeMigrationTestDB(t)
	user, root, connector, target, source := createLegacyYikeMigrationFixture(t, db)

	rootID := root.ID
	conflict := meta.Node{OwnerID: user.ID, ParentID: &rootID, Name: yikeTargetRootName, Type: meta.NodeTypeFile, Revision: 1}
	if err := db.Create(&conflict).Error; err != nil {
		t.Fatal(err)
	}

	if err := migrateLegacyYikeTargets(db); err != nil {
		t.Fatalf("migration conflict should not fail startup: %v", err)
	}

	var paused meta.Source
	if err := db.First(&paused, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if paused.Status != meta.SourceStatusPaused || paused.LastError == "" || paused.Revision != source.Revision+1 {
		t.Fatalf("blocked source was not paused with an actionable error: %+v", paused)
	}
	var unchanged meta.Node
	if err := db.First(&unchanged, target.ID).Error; err != nil {
		t.Fatal(err)
	}
	if unchanged.ParentID == nil || *unchanged.ParentID != connector.ID {
		t.Fatalf("blocked migration moved target unexpectedly: %+v", unchanged)
	}
}
