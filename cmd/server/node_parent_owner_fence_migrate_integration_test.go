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

func openNodeParentOwnerFenceMigrationDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "node_parent_owner_fence_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	return db
}

func TestMigrateInstallsNotValidNodeParentOwnerFenceAndFencesChildInsert(t *testing.T) {
	db := openNodeParentOwnerFenceMigrationDB(t)
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}); err != nil {
		t.Fatal(err)
	}
	owner := meta.User{
		Username:     "node-parent-owner-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12],
		PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1,
	}
	foreignOwner := meta.User{
		Username:     "node-parent-foreign-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:12],
		PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&foreignOwner).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	parent := meta.Node{
		ParentID: &root.ID, Name: "legacy-target", Type: meta.NodeTypeDir,
		OwnerID: owner.ID, Revision: 1,
	}
	if err := db.Create(&parent).Error; err != nil {
		t.Fatal(err)
	}

	// Existing cross-owner edges are legacy data. NOT VALID must allow the
	// upgrade to install enforcement without silently rewriting that history.
	legacyForeignChild := meta.Node{
		ParentID: &parent.ID, Name: "legacy-foreign-child", Type: meta.NodeTypeFile,
		OwnerID: foreignOwner.ID, Revision: 1,
	}
	if err := db.Create(&legacyForeignChild).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrate(db); err != nil {
		t.Fatalf("migration rejected pre-existing legacy parent edge: %v", err)
	}
	var retained meta.Node
	if err := db.First(&retained, legacyForeignChild.ID).Error; err != nil {
		t.Fatalf("migration removed legacy child: %v", err)
	}
	if retained.ParentID == nil || *retained.ParentID != parent.ID || retained.OwnerID != foreignOwner.ID {
		t.Fatalf("migration rewrote legacy parent identity: %+v", retained)
	}
	var validated bool
	if err := db.Raw(`
SELECT convalidated FROM pg_constraint
WHERE conname = 'fk_xd_nodes_parent_owner'
  AND conrelid = 'xd_nodes'::regclass
`).Scan(&validated).Error; err != nil {
		t.Fatal(err)
	}
	if validated {
		t.Fatal("legacy parent ownership constraint must remain NOT VALID")
	}

	// NOT VALID still enforces every new reference.
	invalid := meta.Node{
		ParentID: &parent.ID, Name: "new-foreign-child", Type: meta.NodeTypeFile,
		OwnerID: foreignOwner.ID, Revision: 1,
	}
	if err := db.Create(&invalid).Error; err == nil {
		t.Fatal("new cross-owner parent edge was accepted")
	}

	// A migration's FOR UPDATE on a directory must conflict with the KEY SHARE
	// lock taken by the FK check for a concurrent child insert.
	lockingTx := db.Begin()
	if lockingTx.Error != nil {
		t.Fatal(lockingTx.Error)
	}
	var lockedID uint64
	if err := lockingTx.Raw(
		"SELECT id FROM xd_nodes WHERE id = ? FOR UPDATE", parent.ID,
	).Scan(&lockedID).Error; err != nil {
		_ = lockingTx.Rollback().Error
		t.Fatal(err)
	}
	if lockedID != parent.ID {
		_ = lockingTx.Rollback().Error
		t.Fatalf("locked parent id=%d want=%d", lockedID, parent.ID)
	}
	writerTx := db.Begin()
	if writerTx.Error != nil {
		_ = lockingTx.Rollback().Error
		t.Fatal(writerTx.Error)
	}
	if err := writerTx.Exec("SET LOCAL lock_timeout = '150ms'").Error; err != nil {
		_ = writerTx.Rollback().Error
		_ = lockingTx.Rollback().Error
		t.Fatal(err)
	}
	concurrentChild := meta.Node{
		ParentID: &parent.ID, Name: "concurrent-child", Type: meta.NodeTypeFile,
		OwnerID: owner.ID, Revision: 1,
	}
	insertErr := writerTx.Create(&concurrentChild).Error
	_ = writerTx.Rollback().Error
	if insertErr == nil || !strings.Contains(strings.ToLower(insertErr.Error()), "lock timeout") {
		_ = lockingTx.Rollback().Error
		t.Fatalf("child insert was not fenced by the parent FOR UPDATE lock: %v", insertErr)
	}
	if err := lockingTx.Commit().Error; err != nil {
		t.Fatal(err)
	}
	afterCommit := meta.Node{
		ParentID: &parent.ID, Name: "concurrent-child", Type: meta.NodeTypeFile,
		OwnerID: owner.ID, Revision: 1,
	}
	if err := db.Create(&afterCommit).Error; err != nil {
		t.Fatalf("valid child insert did not proceed after parent lock release: %v", err)
	}

	// The migration is idempotent; a second startup must not duplicate the FK.
	if err := migrate(db); err != nil {
		t.Fatalf("second migration failed: %v", err)
	}
	var constraintCount int64
	if err := db.Raw(`
SELECT COUNT(*) FROM pg_constraint
WHERE conname = 'fk_xd_nodes_parent_owner'
  AND conrelid = 'xd_nodes'::regclass
`).Scan(&constraintCount).Error; err != nil {
		t.Fatal(err)
	}
	if constraintCount != 1 {
		t.Fatalf("parent ownership constraint count=%d want=1", constraintCount)
	}
}
