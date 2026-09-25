package maintenance

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestCASHealthAndRepairMetadata(t *testing.T) {
	db := newCASMaintenanceTestDB(t, "cas_repair")
	root := t.TempDir()
	user, rootNode := newCASMaintenanceUser(t, db)

	sharedContent := "repair-shared"
	sharedHash := verifyTestHash(sharedContent)
	sharedKey, _ := storage.ContentAddressedKey(sharedHash)
	for _, name := range []string{"a.txt", "b.txt"} {
		createCASMaintenanceFile(t, db, rootNode, user.ID, name, sharedKey, sharedHash, int64(len(sharedContent)))
	}
	writeCASMaintenanceBlob(t, root, sharedKey, sharedContent)
	if err := db.Create(&meta.ContentBlob{
		SHA256: sharedHash, StorageKey: sharedKey, Size: int64(len(sharedContent)),
		RefCount: 1, State: meta.ContentBlobStateDeleting,
	}).Error; err != nil {
		t.Fatal(err)
	}

	missingContent := "repair-missing"
	missingHash := verifyTestHash(missingContent)
	missingKey, _ := storage.ContentAddressedKey(missingHash)
	createCASMaintenanceFile(t, db, rootNode, user.ID, "missing.txt", missingKey, missingHash, int64(len(missingContent)))
	writeCASMaintenanceBlob(t, root, missingKey, missingContent)

	unreferencedContent := "unreferenced"
	unreferencedHash := verifyTestHash(unreferencedContent)
	unreferencedKey, _ := storage.ContentAddressedKey(unreferencedHash)
	writeCASMaintenanceBlob(t, root, unreferencedKey, unreferencedContent)
	if err := db.Create(&meta.ContentBlob{
		SHA256: unreferencedHash, StorageKey: unreferencedKey, Size: int64(len(unreferencedContent)),
		RefCount: 2, State: meta.ContentBlobStateReady,
	}).Error; err != nil {
		t.Fatal(err)
	}

	before, err := CASHealth(db, CASDeletingStaleAfter)
	if err != nil {
		t.Fatal(err)
	}
	if before.Healthy || before.MissingMetadata != 1 || before.RefCountMismatches < 2 || before.StateMismatches < 2 {
		t.Fatalf("unexpected pre-repair health: %+v", before)
	}

	dry, err := RepairCASMetadata(context.Background(), db, root, true)
	if err != nil {
		t.Fatal(err)
	}
	if !dry.DryRun || len(dry.Actions) != 3 {
		t.Fatalf("unexpected dry-run report: %+v", dry)
	}
	unchanged, err := CASHealth(db, CASDeletingStaleAfter)
	if err != nil {
		t.Fatal(err)
	}
	if unchanged.Healthy {
		t.Fatal("dry-run changed metadata")
	}

	report, err := RepairCASMetadata(context.Background(), db, root, false)
	if err != nil {
		t.Fatal(err)
	}
	if report.DryRun || len(report.Actions) != 3 || len(report.Skipped) != 0 {
		t.Fatalf("unexpected repair report: %+v", report)
	}
	if !report.After.Healthy || report.After.MissingMetadata != 0 || report.After.RefCountMismatches != 0 || report.After.StateMismatches != 0 {
		t.Fatalf("repair did not restore health: %+v", report.After)
	}
	var shared meta.ContentBlob
	if err := db.First(&shared, "sha256 = ?", sharedHash).Error; err != nil {
		t.Fatal(err)
	}
	if shared.RefCount != 2 || shared.State != meta.ContentBlobStateReady {
		t.Fatalf("shared metadata not repaired: %+v", shared)
	}
	var missing meta.ContentBlob
	if err := db.First(&missing, "sha256 = ?", missingHash).Error; err != nil {
		t.Fatal(err)
	}
	if missing.RefCount != 1 || missing.State != meta.ContentBlobStateReady {
		t.Fatalf("missing metadata not rebuilt: %+v", missing)
	}
	var unreferenced meta.ContentBlob
	if err := db.First(&unreferenced, "sha256 = ?", unreferencedHash).Error; err != nil {
		t.Fatal(err)
	}
	if unreferenced.RefCount != 0 || unreferenced.State != meta.ContentBlobStateDeleting {
		t.Fatalf("unreferenced metadata not marked deleting: %+v", unreferenced)
	}

	verify, err := Verify(db, root)
	if err != nil {
		t.Fatal(err)
	}
	if !verify.OK() {
		t.Fatalf("verify should accept managed deleting blob after repair: %+v", verify)
	}
}

func TestCASRepairSkipsCorruptReferencedObject(t *testing.T) {
	db := newCASMaintenanceTestDB(t, "cas_repair_corrupt")
	root := t.TempDir()
	user, rootNode := newCASMaintenanceUser(t, db)

	expected := "good"
	hash := verifyTestHash(expected)
	key, _ := storage.ContentAddressedKey(hash)
	createCASMaintenanceFile(t, db, rootNode, user.ID, "corrupt.txt", key, hash, int64(len(expected)))
	writeCASMaintenanceBlob(t, root, key, "evil")

	report, err := RepairCASMetadata(context.Background(), db, root, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Actions) != 0 || len(report.Skipped) != 1 {
		t.Fatalf("corrupt object was unexpectedly repaired: %+v", report)
	}
	if report.After.Healthy || report.After.MissingMetadata != 1 {
		t.Fatalf("corruption should remain visible: %+v", report.After)
	}
	var count int64
	if err := db.Model(&meta.ContentBlob{}).Where("sha256 = ?", hash).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("repair created CAS metadata for an unverified physical object")
	}
}

func TestCASHealthStaleDeletingIsWarningNotHardFailure(t *testing.T) {
	db := newCASMaintenanceTestDB(t, "cas_health_warning")
	hash := verifyTestHash("stale")
	key, _ := storage.ContentAddressedKey(hash)
	blob := meta.ContentBlob{
		SHA256: hash, StorageKey: key, Size: 5, RefCount: 0,
		State: meta.ContentBlobStateDeleting,
	}
	if err := db.Create(&blob).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.ContentBlob{}).Where("sha256 = ?", hash).
		UpdateColumn("updated_at", time.Now().Add(-2*time.Hour)).Error; err != nil {
		t.Fatal(err)
	}
	health, err := CASHealth(db, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if !health.Healthy || health.Status != "warning" || health.StaleDeletingBlobs != 1 {
		t.Fatalf("unexpected stale deleting health: %+v", health)
	}
}

func newCASMaintenanceTestDB(t *testing.T, prefix string) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := prefix + "_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{}, &meta.ContentBlob{}, &meta.UploadSession{}, &meta.UploadPart{},
	); err != nil {
		t.Fatal(err)
	}
	return db
}

func newCASMaintenanceUser(t *testing.T, db *gorm.DB) (meta.User, meta.Node) {
	t.Helper()
	user := meta.User{Username: "cas-maintenance", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	return user, root
}

func createCASMaintenanceFile(t *testing.T, db *gorm.DB, root meta.Node, ownerID uint64, name, key, hash string, size int64) {
	t.Helper()
	node := meta.Node{ParentID: &root.ID, Name: name, Type: meta.NodeTypeFile, OwnerID: ownerID, Revision: 1}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{NodeID: node.ID, StorageKey: key, SHA256: hash, Size: size}).Error; err != nil {
		t.Fatal(err)
	}
}

func writeCASMaintenanceBlob(t *testing.T, root, key, content string) {
	t.Helper()
	full := filepath.Join(root, filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(full), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(content), 0o640); err != nil {
		t.Fatal(err)
	}
}
