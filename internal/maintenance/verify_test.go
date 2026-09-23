package maintenance

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestVerifyDetectsMissingMismatchAndOrphan(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schemaName := "maintenance_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schemaName)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schemaName)).Error
	}()

	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schemaName)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.File{}); err != nil {
		t.Fatal(err)
	}
	user := meta.User{Username: "verify-user", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	rootNode := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&rootNode).Error; err != nil {
		t.Fatal(err)
	}
	makeFile := func(name, key string, size int64) uint64 {
		t.Helper()
		node := meta.Node{ParentID: &rootNode.ID, Name: name, Type: meta.NodeTypeFile, OwnerID: user.ID, Revision: 1}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.File{NodeID: node.ID, StorageKey: key, Size: size}).Error; err != nil {
			t.Fatal(err)
		}
		return node.ID
	}

	root := t.TempDir()
	okKey := "1/docs/ok"
	mismatchKey := "1/docs/mismatch"
	missingKey := "1/docs/missing"
	okID := makeFile("ok.txt", okKey, 2)
	mismatchID := makeFile("mismatch.txt", mismatchKey, 10)
	missingID := makeFile("missing.txt", missingKey, 7)

	for key, content := range map[string]string{
		okKey:        "ok",
		mismatchKey:  "bad",
		"orphan.bin": "orphan",
	} {
		path := filepath.Join(root, filepath.FromSlash(key))
		if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o640); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, ".xdrive-upload-temp"), []byte("temp"), 0o600); err != nil {
		t.Fatal(err)
	}

	report, err := Verify(db, root)
	if err != nil {
		t.Fatal(err)
	}
	if report.OK() {
		t.Fatal("inconsistent storage reported OK")
	}
	if report.ReferencedFiles != 3 || report.BlobFiles != 3 || report.IgnoredTemps != 1 {
		t.Fatalf("unexpected summary: %+v", report)
	}
	if len(report.Missing) != 1 || report.Missing[0].NodeID != missingID {
		t.Fatalf("missing=%+v want node=%d", report.Missing, missingID)
	}
	if len(report.SizeMismatches) != 1 || report.SizeMismatches[0].NodeID != mismatchID {
		t.Fatalf("mismatches=%+v want node=%d", report.SizeMismatches, mismatchID)
	}
	if len(report.Orphans) != 1 || report.Orphans[0].StorageKey != "orphan.bin" {
		t.Fatalf("orphans=%+v", report.Orphans)
	}

	if err := os.Remove(filepath.Join(root, filepath.FromSlash(mismatchKey))); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(root, "orphan.bin")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, filepath.FromSlash(mismatchKey)), []byte("0123456789"), 0o640); err != nil {
		t.Fatal(err)
	}
	missingPath := filepath.Join(root, filepath.FromSlash(missingKey))
	if err := os.MkdirAll(filepath.Dir(missingPath), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(missingPath, []byte("1234567"), 0o640); err != nil {
		t.Fatal(err)
	}

	report, err = Verify(db, root)
	if err != nil {
		t.Fatal(err)
	}
	if !report.OK() {
		t.Fatalf("repaired storage not OK: %+v; okID=%d", report, okID)
	}
}
