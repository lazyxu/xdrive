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
