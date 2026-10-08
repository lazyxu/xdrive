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

func TestFileOperationMoveMergeAvoidsFilePreloads(t *testing.T) {
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

	schema := "fileop_move_merge_preload_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.File{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error; err != nil {
		t.Fatal(err)
	}

	user := meta.User{
		Username:       "file-operation-move-merge-preload-owner",
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	sourceParent := meta.Node{ParentID: &root.ID, Name: "source-parent", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	targetParent := meta.Node{ParentID: &root.ID, Name: "target-parent", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&sourceParent).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&targetParent).Error; err != nil {
		t.Fatal(err)
	}
	sourceRoot := meta.Node{ParentID: &sourceParent.ID, Name: "merge", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	targetRoot := meta.Node{ParentID: &targetParent.ID, Name: "merge", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&sourceRoot).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&targetRoot).Error; err != nil {
		t.Fatal(err)
	}

	const directoryCount = 120
	targetChildIDs := make([]uint64, 0, directoryCount)
	for index := 0; index < directoryCount; index++ {
		name := fmt.Sprintf("dir-%03d", index)
		sourceDir := meta.Node{ParentID: &sourceRoot.ID, Name: name, Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
		targetDir := meta.Node{ParentID: &targetRoot.ID, Name: name, Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
		if err := db.Create(&sourceDir).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&targetDir).Error; err != nil {
			t.Fatal(err)
		}
		targetChildIDs = append(targetChildIDs, targetDir.ID)

		file := meta.Node{ParentID: &sourceDir.ID, Name: "payload.bin", Type: meta.NodeTypeFile, OwnerID: user.ID, Revision: 1}
		if err := db.Create(&file).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.File{
			NodeID:     file.ID,
			Size:       int64(index + 1),
			StorageKey: fmt.Sprintf("fixture/move-merge/%03d", index),
		}).Error; err != nil {
			t.Fatal(err)
		}
	}

	srv := &Server{DB: db}
	tx := db.Begin()
	if tx.Error != nil {
		t.Fatal(tx.Error)
	}
	capture.reset()
	moved, merged, err := srv.moveNodeReplaceOrMergeTx(
		context.Background(),
		tx,
		user.ID,
		sourceRoot,
		targetParent.ID,
		0,
	)
	statements := capture.snapshot()
	if err != nil {
		_ = tx.Rollback().Error
		t.Fatal(err)
	}
	if !merged || moved.ID != targetRoot.ID {
		_ = tx.Rollback().Error
		t.Fatalf("move merge result merged=%v moved=%+v want target=%d", merged, moved, targetRoot.ID)
	}
	if err := tx.Commit().Error; err != nil {
		t.Fatal(err)
	}

	fileSelects := 0
	for _, statement := range statements {
		if strings.Contains(strings.ToLower(statement), `from "xd_files"`) {
			fileSelects++
		}
	}
	if fileSelects != 0 {
		t.Fatalf("Move merge xd_files SELECTs=%d want=0; statements=%v", fileSelects, statements)
	}

	var movedFiles int64
	if err := db.Model(&meta.Node{}).
		Where("owner_id = ? AND parent_id IN ? AND name = ? AND type = ? AND deleted_at IS NULL", user.ID, targetChildIDs, "payload.bin", meta.NodeTypeFile).
		Count(&movedFiles).Error; err != nil {
		t.Fatal(err)
	}
	if movedFiles != directoryCount {
		t.Fatalf("moved files=%d want=%d", movedFiles, directoryCount)
	}

	var sourceRootCount int64
	if err := db.Model(&meta.Node{}).Where("id = ? AND owner_id = ?", sourceRoot.ID, user.ID).Count(&sourceRootCount).Error; err != nil {
		t.Fatal(err)
	}
	if sourceRootCount != 0 {
		t.Fatalf("source merge root still exists: count=%d", sourceRootCount)
	}
}
