package maintenance

import (
	"context"
	"errors"
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

func TestStorageRepairMigratesLegacyReferencesToCAS(t *testing.T) {
	db := newCASMaintenanceTestDB(t, "storage_repair_legacy")
	root := t.TempDir()
	user, rootNode := newCASMaintenanceUser(t, db)

	content := "legacy-content"
	legacyKey := "legacy/user/old-object"
	parentID := rootNode.ID
	node := meta.Node{
		ParentID: &parentID,
		Name:     "legacy.txt",
		Type:     meta.NodeTypeFile,
		OwnerID:  user.ID,
		Revision: 2,
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{
		NodeID: node.ID, StorageKey: legacyKey, Size: int64(len(content)),
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.FileVersion{
		NodeID: node.ID, Revision: 1, StorageKey: legacyKey, Size: int64(len(content)),
	}).Error; err != nil {
		t.Fatal(err)
	}
	writeCASMaintenanceBlob(t, root, legacyKey, content)

	report, err := RepairStorage(context.Background(), db, root, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Skipped) != 0 {
		t.Fatalf("legacy migration unexpectedly skipped: %+v", report.Skipped)
	}
	var migration *CASRepairAction
	for index := range report.Actions {
		if report.Actions[index].Kind == "migrate_legacy" {
			migration = &report.Actions[index]
			break
		}
	}
	if migration == nil || !migration.Applied || migration.SourceStorageKey != legacyKey {
		t.Fatalf("legacy migration action missing: %+v", report.Actions)
	}

	hash := verifyTestHash(content)
	canonicalKey, err := storage.ContentAddressedKey(hash)
	if err != nil {
		t.Fatal(err)
	}
	if migration.SHA256 != hash || migration.StorageKey != canonicalKey || migration.AfterRefCount != 2 {
		t.Fatalf("unexpected migration action: %+v", migration)
	}

	var file meta.File
	if err := db.First(&file, "node_id = ?", node.ID).Error; err != nil {
		t.Fatal(err)
	}
	if file.StorageKey != canonicalKey || file.SHA256 != hash {
		t.Fatalf("current file not migrated: %+v", file)
	}
	var version meta.FileVersion
	if err := db.First(&version, "node_id = ?", node.ID).Error; err != nil {
		t.Fatal(err)
	}
	if version.StorageKey != canonicalKey || version.SHA256 != hash {
		t.Fatalf("historical version not migrated: %+v", version)
	}
	var blob meta.ContentBlob
	if err := db.First(&blob, "sha256 = ?", hash).Error; err != nil {
		t.Fatal(err)
	}
	if blob.StorageKey != canonicalKey || blob.RefCount != 2 || blob.State != meta.ContentBlobStateReady {
		t.Fatalf("canonical metadata after migration: %+v", blob)
	}
	if err := verifyCASObject(root, canonicalKey, int64(len(content)), hash); err != nil {
		t.Fatalf("canonical bytes not verified: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(legacyKey))); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("legacy source still exists after reference switch: %v", err)
	}
}

func TestStorageRepairLegacyDryRunDoesNotMutate(t *testing.T) {
	db := newCASMaintenanceTestDB(t, "storage_repair_legacy_dry")
	root := t.TempDir()
	user, rootNode := newCASMaintenanceUser(t, db)

	content := "legacy-dry-run"
	legacyKey := "legacy/dry/object"
	createCASMaintenanceFile(t, db, rootNode, user.ID, "legacy-dry.txt", legacyKey, "", int64(len(content)))
	writeCASMaintenanceBlob(t, root, legacyKey, content)

	report, err := RepairStorage(context.Background(), db, root, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Actions) != 1 || report.Actions[0].Kind != "migrate_legacy" || report.Actions[0].Applied {
		t.Fatalf("unexpected legacy dry-run report: %+v", report)
	}
	var file meta.File
	if err := db.First(&file, "storage_key = ?", legacyKey).Error; err != nil {
		t.Fatal(err)
	}
	if file.StorageKey != legacyKey {
		t.Fatalf("dry-run changed legacy reference: %+v", file)
	}
	hash := verifyTestHash(content)
	canonicalKey, _ := storage.ContentAddressedKey(hash)
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(canonicalKey))); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("dry-run created canonical bytes: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(legacyKey))); err != nil {
		t.Fatalf("dry-run removed legacy bytes: %v", err)
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

func TestVerifyCASObjectWithContextRejectsCancelledWork(t *testing.T) {
	content := strings.Repeat("x", 1024)
	root := t.TempDir()
	hash := verifyTestHash(content)
	key, err := storage.ContentAddressedKey(hash)
	if err != nil {
		t.Fatal(err)
	}
	writeCASMaintenanceBlob(t, root, key, content)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err = verifyCASObjectWithContext(
		ctx,
		root,
		key,
		int64(len(content)),
		hash,
	)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("verify CAS object error=%v want context.Canceled", err)
	}
}

func TestRepairStorageRejectsCancelledWork(t *testing.T) {
	db := newCASMaintenanceTestDB(t, "storage_repair_cancelled")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := RepairStorage(ctx, db, t.TempDir(), false)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("repair storage error=%v want context.Canceled", err)
	}
}

func TestRepairCASMetadataRejectsCancelledWork(t *testing.T) {
	db := newCASMaintenanceTestDB(t, "cas_repair_cancelled")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := RepairCASMetadata(ctx, db, t.TempDir(), false)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("repair CAS metadata error=%v want context.Canceled", err)
	}
}
