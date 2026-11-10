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

// Replacing the legacy index must be all-or-nothing. Historical name collisions
// must stop startup with the old protection intact, never silently rename
// existing Sources or leave the database missing both unique indexes.
func TestMigrateSourceNameNamespaceIndexRollbackOnLegacyCollision(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	rootDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	trackMigrationTestDB(t, rootDB)
	schema := "source_name_swap_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := rootDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rootDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	trackMigrationTestDB(t, db)
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.Source{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE UNIQUE INDEX idx_xd_sources_owner_name ON xd_sources(owner_id, name)").Error; err != nil {
		t.Fatal(err)
	}
	owner := meta.User{Username: "collision-owner", PasswordHash: "fixture", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	makeSource := func(name, direction, kind string) meta.Source {
		return meta.Source{
			OwnerID: owner.ID, Name: name, Kind: kind, Direction: direction,
			SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeScan,
			Status: meta.SourceStatusPaused, Revision: 1,
		}
	}
	first := makeSource("Camera", meta.SourceDirectionPull, "synology_photos")
	second := makeSource("camera", meta.SourceDirectionPull, "yike_photos")
	if err := db.Create(&first).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&second).Error; err != nil {
		t.Fatal(err)
	}
	indexExists := func(name string) bool {
		t.Helper()
		var count int64
		if err := db.Raw("SELECT COUNT(*) FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ?", name).
			Scan(&count).Error; err != nil {
			t.Fatal(err)
		}
		return count == 1
	}
	if err := migrateSourceNameNamespaceIndex(db); err == nil {
		t.Fatal("case-insensitive legacy collision was silently accepted")
	}
	if !indexExists("idx_xd_sources_owner_name") || indexExists("idx_xd_sources_owner_direction_name") {
		t.Fatal("failed migration dropped old uniqueness index or left a partial new index")
	}
	duplicateOld := makeSource("Camera", meta.SourceDirectionPush, meta.SourceKindLocalFolder)
	if err := db.Create(&duplicateOld).Error; err == nil {
		t.Fatal("old Owner/name uniqueness was lost after failed index swap")
	}
	var unchanged meta.Source
	if err := db.First(&unchanged, second.ID).Error; err != nil || unchanged.Name != "camera" {
		t.Fatalf("failed migration modified legacy Source: %+v err=%v", unchanged, err)
	}
	// The Owner resolves the legacy conflict explicitly; a retry then
	// replaces the index, permitting independent Push/Pull name namespaces.
	if err := db.Model(&meta.Source{}).Where("id = ?", second.ID).
		Update("name", "Other camera").Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateSourceNameNamespaceIndex(db); err != nil {
		t.Fatalf("resolved Source index migration failed: %v", err)
	}
	if indexExists("idx_xd_sources_owner_name") || !indexExists("idx_xd_sources_owner_direction_name") {
		t.Fatal("atomic Source namespace index swap was not committed")
	}
	sameNamePush := makeSource("Camera", meta.SourceDirectionPush, meta.SourceKindLocalFolder)
	if err := db.Create(&sameNamePush).Error; err != nil {
		t.Fatalf("Push/Pull remained incorrectly coupled: %v", err)
	}
	collisionPull := makeSource("cAmErA", meta.SourceDirectionPull, "synology_files")
	if err := db.Create(&collisionPull).Error; err == nil {
		t.Fatal("case-insensitive Pull collision was accepted after index swap")
	}
	if err := migrateSourceNameNamespaceIndex(db); err != nil {
		t.Fatalf("idempotent migration failed: %v", err)
	}
}
