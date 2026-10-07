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

func TestFileOperationMoveUsesGroupedRootBytes(t *testing.T) {
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

	schema := "fileop_move_root_bytes_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.File{}, &meta.FileOperation{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error; err != nil {
		t.Fatal(err)
	}

	user := meta.User{Username: "file-operation-move-root-bytes-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Node{ParentID: &root.ID, Name: "source", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	target := meta.Node{ParentID: &root.ID, Name: "target", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&target).Error; err != nil {
		t.Fatal(err)
	}

	const selectedCount = 120
	refs := make([]batchNodeRef, 0, selectedCount)
	selectedIDs := make([]uint64, 0, selectedCount)
	var wantBytes int64
	for index := 0; index < selectedCount; index++ {
		dir := meta.Node{ParentID: &source.ID, Name: fmt.Sprintf("dir-%03d", index), Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
		if err := db.Create(&dir).Error; err != nil {
			t.Fatal(err)
		}
		fileSize := int64(index + 1)
		file := meta.Node{ParentID: &dir.ID, Name: "payload.bin", Type: meta.NodeTypeFile, OwnerID: user.ID, Revision: 1}
		if err := db.Create(&file).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.File{NodeID: file.ID, Size: fileSize, StorageKey: fmt.Sprintf("legacy/move-root-bytes/%03d", index)}).Error; err != nil {
			t.Fatal(err)
		}
		wantBytes += fileSize
		refs = append(refs, batchNodeRef{ID: dir.ID, Revision: dir.Revision})
		selectedIDs = append(selectedIDs, dir.ID)
	}

	srv := &Server{DB: db}
	operation, err := srv.enqueueFileOperation(context.Background(), user.ID, meta.FileOperationTypeMove, refs, target.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if operation.TotalBytes != wantBytes {
		t.Fatalf("queued total bytes=%d want=%d", operation.TotalBytes, wantBytes)
	}

	capture.reset()
	processed, err := srv.processNextFileOperation(context.Background())
	if err != nil || !processed {
		t.Fatalf("process move: processed=%v err=%v", processed, err)
	}

	operation, err = srv.loadOwnedFileOperation(context.Background(), user.ID, operation.ID)
	if err != nil {
		t.Fatal(err)
	}
	if operation.Status != meta.FileOperationStatusCompleted ||
		operation.ProcessedItems != selectedCount ||
		operation.ProcessedBytes != wantBytes {
		t.Fatalf("completed move=%+v want items=%d bytes=%d", operation, selectedCount, wantBytes)
	}

	var movedCount int64
	if err := db.Model(&meta.Node{}).
		Where("id IN ? AND owner_id = ? AND parent_id = ? AND deleted_at IS NULL", selectedIDs, user.ID, target.ID).
		Count(&movedCount).Error; err != nil {
		t.Fatal(err)
	}
	if movedCount != selectedCount {
		t.Fatalf("moved roots=%d want=%d", movedCount, selectedCount)
	}

	statements := capture.snapshot()
	grouped := 0
	legacyRecursive := 0
	rootFilePreloads := 0
	for _, statement := range statements {
		lower := strings.ToLower(statement)
		if strings.Contains(lower, "with recursive roots as") && strings.Contains(lower, "group by tree.root_id") {
			grouped++
		}
		if strings.Contains(lower, "with recursive tree as") &&
			strings.Contains(lower, "select id from xd_nodes where id =") &&
			strings.Contains(lower, "sum(f.size)") {
			legacyRecursive++
		}
		if strings.Contains(lower, `from "xd_files"`) && strings.Contains(lower, `where "xd_files"."node_id" =`) {
			rootFilePreloads++
		}
	}
	if grouped != 1 {
		t.Fatalf("grouped move root-byte CTE count=%d want=1", grouped)
	}
	if legacyRecursive != 0 {
		t.Fatalf("legacy per-root recursive byte CTE count=%d want=0", legacyRecursive)
	}
	if rootFilePreloads != 0 {
		t.Fatalf("Move root File preload query count=%d want=0", rootFilePreloads)
	}
}
