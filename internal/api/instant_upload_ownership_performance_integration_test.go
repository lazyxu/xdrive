package api

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type instantOwnershipSQLCapture struct {
	logger.Interface

	mu         sync.Mutex
	enabled    bool
	statements []string
}

func (capture *instantOwnershipSQLCapture) Trace(
	ctx context.Context,
	begin time.Time,
	fc func() (string, int64),
	err error,
) {
	capture.mu.Lock()
	enabled := capture.enabled
	capture.mu.Unlock()
	if enabled {
		sql, _ := fc()
		capture.mu.Lock()
		if capture.enabled {
			capture.statements = append(capture.statements, sql)
		}
		capture.mu.Unlock()
	}
	capture.Interface.Trace(ctx, begin, fc, err)
}

func (capture *instantOwnershipSQLCapture) start() {
	capture.mu.Lock()
	capture.statements = nil
	capture.enabled = true
	capture.mu.Unlock()
}

func (capture *instantOwnershipSQLCapture) stop() []string {
	capture.mu.Lock()
	defer capture.mu.Unlock()
	capture.enabled = false
	return append([]string(nil), capture.statements...)
}

func TestInstantUploadOwnershipUsesExistsProbe(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}

	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	baseSQL, err := baseDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	baseSQL.SetMaxOpenConns(2)
	baseSQL.SetMaxIdleConns(0)
	t.Cleanup(func() { _ = baseSQL.Close() })

	schema := "instant_upload_ownership_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	capture := &instantOwnershipSQLCapture{Interface: logger.Discard}
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{Logger: capture})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(2)
	sqlDB.SetMaxIdleConns(0)
	t.Cleanup(func() { _ = sqlDB.Close() })

	if err := db.AutoMigrate(
		&meta.User{},
		&meta.Node{},
		&meta.File{},
		&meta.FileVersion{},
	); err != nil {
		t.Fatal(err)
	}

	owner := meta.User{
		Username:       "instant-owner",
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	other := meta.User{
		Username:       "instant-other",
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}

	ownerRoot := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 1}
	otherRoot := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: other.ID, Revision: 1}
	if err := db.Create(&ownerRoot).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&otherRoot).Error; err != nil {
		t.Fatal(err)
	}

	const referenceCount = 120
	const currentKey = ".xdrive-blobs/sha256/aa/current"
	const versionKey = ".xdrive-blobs/sha256/bb/version"
	const foreignKey = ".xdrive-blobs/sha256/cc/foreign"

	nodes := make([]meta.Node, 0, referenceCount)
	for index := 0; index < referenceCount; index++ {
		parentID := ownerRoot.ID
		nodes = append(nodes, meta.Node{
			ParentID: &parentID,
			Name:     fmt.Sprintf("file-%03d.bin", index),
			Type:     meta.NodeTypeFile,
			OwnerID:  owner.ID,
			Revision: 2,
		})
	}
	if err := db.Create(&nodes).Error; err != nil {
		t.Fatal(err)
	}

	files := make([]meta.File, 0, referenceCount)
	versions := make([]meta.FileVersion, 0, referenceCount)
	for _, node := range nodes {
		files = append(files, meta.File{
			NodeID: node.ID, Size: 1, StorageKey: currentKey,
		})
		versions = append(versions, meta.FileVersion{
			NodeID: node.ID, Revision: 1, Size: 1, StorageKey: versionKey,
		})
	}
	if err := db.Create(&files).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&versions).Error; err != nil {
		t.Fatal(err)
	}

	foreignParentID := otherRoot.ID
	foreignNode := meta.Node{
		ParentID: &foreignParentID,
		Name:     "foreign.bin",
		Type:     meta.NodeTypeFile,
		OwnerID:  other.ID,
		Revision: 1,
	}
	if err := db.Create(&foreignNode).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{
		NodeID: foreignNode.ID, Size: 1, StorageKey: foreignKey,
	}).Error; err != nil {
		t.Fatal(err)
	}

	check := func(name, key string, want bool) {
		t.Helper()
		capture.start()
		got, err := userOwnsStorageKey(db, owner.ID, key)
		statements := capture.stop()
		if err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Fatalf("%s ownership=%v want=%v", name, got, want)
		}
		if len(statements) != 1 {
			t.Fatalf("%s ownership SQL statements=%d want=1: %v", name, len(statements), statements)
		}
		sql := strings.ToLower(statements[0])
		if !strings.Contains(sql, "select exists") {
			t.Fatalf("%s ownership query must use EXISTS: %s", name, statements[0])
		}
		if strings.Contains(sql, "count(") {
			t.Fatalf("%s ownership query must not aggregate all matching refs: %s", name, statements[0])
		}
		for _, table := range []string{"xd_files", "xd_file_versions"} {
			if !strings.Contains(sql, table) {
				t.Fatalf("%s ownership query missing %s probe: %s", name, table, statements[0])
			}
		}
	}

	check("current file", currentKey, true)
	check("historical version", versionKey, true)
	check("foreign user", foreignKey, false)
	check("missing", ".xdrive-blobs/sha256/dd/missing", false)
}
