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

func TestFileOperationCopyMergeLoadsSourceSubtreeOnce(t *testing.T) {
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

	schema := "fileop_copy_merge_source_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error })

	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()

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
		Username:       "copy-merge-source-perf-owner",
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
			StorageKey: fmt.Sprintf("legacy-copy-merge-%03d", index),
			SHA256:     fmt.Sprintf("%064x", index+1),
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
	copied, merged, err := srv.copyNodeReplaceOrMergeTx(
		context.Background(),
		tx,
		user.ID,
		sourceRoot,
		targetParent.ID,
		sourceRoot.Name,
		sourceRoot.Name,
		nil,
		0,
	)
	statements := capture.snapshot()
	if err != nil {
		_ = tx.Rollback().Error
		t.Fatal(err)
	}
	if !merged || copied.ID != targetRoot.ID {
		_ = tx.Rollback().Error
		t.Fatalf("copy merge result merged=%v copied=%+v want target=%d", merged, copied, targetRoot.ID)
	}
	if err := tx.Commit().Error; err != nil {
		t.Fatal(err)
	}

	sourceCTEs := 0
	legacyChildLists := 0
	legacyFilePreloads := 0
	for _, statement := range statements {
		lower := strings.ToLower(statement)
		if strings.Contains(lower, "with recursive tree as") &&
			strings.Contains(lower, "left join xd_files as f") &&
			strings.Contains(lower, "path_ids") {
			sourceCTEs++
		}
		if strings.Contains(lower, "order by type asc, name asc") {
			legacyChildLists++
		}
		if strings.Contains(lower, `from "xd_files"`) {
			legacyFilePreloads++
		}
	}
	if sourceCTEs != 1 {
		t.Fatalf("Copy merge source-subtree CTEs=%d want=1; statements=%v", sourceCTEs, statements)
	}
	if legacyChildLists != 0 {
		t.Fatalf("Copy merge legacy source child-list SELECTs=%d want=0", legacyChildLists)
	}
	if legacyFilePreloads != 0 {
		t.Fatalf("Copy merge legacy File preload SELECTs=%d want=0", legacyFilePreloads)
	}

	var copiedFiles int64
	if err := db.Model(&meta.Node{}).
		Where(
			"owner_id = ? AND parent_id IN ? AND name = ? AND type = ? AND deleted_at IS NULL",
			user.ID, targetChildIDs, "payload.bin", meta.NodeTypeFile,
		).
		Count(&copiedFiles).Error; err != nil {
		t.Fatal(err)
	}
	if copiedFiles != directoryCount {
		t.Fatalf("copied files=%d want=%d", copiedFiles, directoryCount)
	}

	var sourceFiles int64
	if err := db.Raw(`WITH RECURSIVE tree AS (
SELECT id, type FROM xd_nodes WHERE id = ? AND owner_id = ?
UNION ALL
SELECT n.id, n.type
FROM xd_nodes AS n
JOIN tree ON n.parent_id = tree.id
WHERE n.owner_id = ? AND n.deleted_at IS NULL
)
SELECT COUNT(*) FROM tree WHERE type = ?
`, sourceRoot.ID, user.ID, user.ID, meta.NodeTypeFile).Scan(&sourceFiles).Error; err != nil {
		t.Fatal(err)
	}
	if sourceFiles != directoryCount {
		t.Fatalf("source files after Copy=%d want=%d", sourceFiles, directoryCount)
	}
}
