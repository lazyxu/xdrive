package api

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestUploadConflictPreflightBatchUsesOneSQLStatement(t *testing.T) {
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

	schema := "upload_preflight_batch_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error })

	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := u.Query()
	query.Set("search_path", schema)
	u.RawQuery = query.Encode()

	capture := &fileOperationSQLCapture{Interface: logger.Discard}
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

	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error; err != nil {
		t.Fatal(err)
	}

	user := meta.User{Username: "upload-preflight-batch-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}

	const itemCount = 120
	requests := make([]uploadConflictPreflightRequest, 0, itemCount)
	for index := 0; index < itemCount; index++ {
		name := fmt.Sprintf("file-%03d.bin", index)
		requests = append(requests, uploadConflictPreflightRequest{ParentID: root.ID, Name: name})
		if index%2 == 0 {
			node := meta.Node{ParentID: &root.ID, Name: name, Type: meta.NodeTypeFile, OwnerID: user.ID, Revision: 1}
			if err := db.Create(&node).Error; err != nil {
				t.Fatal(err)
			}
		}
	}

	capture.reset()
	results, err := batchUploadConflictPreflights(context.Background(), db, user.ID, requests)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != itemCount {
		t.Fatalf("batch results=%d want=%d", len(results), itemCount)
	}
	for index, result := range results {
		wantConflict := index%2 == 0
		if result.Conflict != wantConflict {
			t.Fatalf("result %d conflict=%v want=%v", index, result.Conflict, wantConflict)
		}
		if wantConflict && (result.TargetType != meta.NodeTypeFile || !result.CanOverwrite) {
			t.Fatalf("result %d=%+v want overwritable file conflict", index, result)
		}
		if result.Error != "" {
			t.Fatalf("result %d unexpected error=%q", index, result.Error)
		}
	}

	statements := capture.snapshot()
	batchQueries := 0
	for _, statement := range statements {
		lower := strings.ToLower(statement)
		if strings.Contains(lower, "with requested(idx, parent_id, name) as") &&
			strings.Contains(lower, "left join xd_nodes as parent") &&
			strings.Contains(lower, "left join xd_nodes as conflict") {
			batchQueries++
		}
	}
	if batchQueries != 1 || len(statements) != 1 {
		t.Fatalf("upload preflight batch SQL statements=%d batch=%d want total=1 batch=1; statements=%v", len(statements), batchQueries, statements)
	}

	mixed, err := batchUploadConflictPreflights(context.Background(), db, user.ID, []uploadConflictPreflightRequest{
		{ParentID: root.ID, Name: "file-000.bin"},
		{ParentID: 0, Name: "missing-parent.bin"},
		{ParentID: root.ID + 999999, Name: "missing-directory.bin"},
		{ParentID: root.ID, Name: ""},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(mixed) != 4 ||
		!mixed[0].Conflict ||
		mixed[1].Error != "parent_id is required" ||
		mixed[2].Error != "parent directory not found" ||
		mixed[3].Error == "" {
		t.Fatalf("mixed batch results=%+v", mixed)
	}
}
