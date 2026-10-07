package api

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
	"gorm.io/gorm/logger"
)

func TestActiveSubtreeSummaryUsesSingleRecursiveQuery(t *testing.T) {
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

	schema := "fileop_delete_subtree_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	counter := &fileOperationSQLCounter{Interface: logger.Discard}
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{Logger: counter})
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

	user := meta.User{
		Username:       "file-operation-delete-subtree-owner",
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
	parent := root.ID
	selected := meta.Node{
		ParentID: &parent,
		Name:     "selected",
		Type:     meta.NodeTypeDir,
		OwnerID:  user.ID,
		Revision: 1,
	}
	if err := db.Create(&selected).Error; err != nil {
		t.Fatal(err)
	}

	const childCount = 120
	directories := make([]meta.Node, 0, childCount)
	for index := 0; index < childCount; index++ {
		parentID := selected.ID
		directories = append(directories, meta.Node{
			ParentID: &parentID,
			Name:     fmt.Sprintf("dir-%03d", index),
			Type:     meta.NodeTypeDir,
			OwnerID:  user.ID,
			Revision: 1,
		})
	}
	if err := db.Create(&directories).Error; err != nil {
		t.Fatal(err)
	}

	fileNodes := make([]meta.Node, 0, childCount)
	for index := range directories {
		parentID := directories[index].ID
		fileNodes = append(fileNodes, meta.Node{
			ParentID: &parentID,
			Name:     fmt.Sprintf("file-%03d.bin", index),
			Type:     meta.NodeTypeFile,
			OwnerID:  user.ID,
			Revision: 1,
		})
	}
	if err := db.Create(&fileNodes).Error; err != nil {
		t.Fatal(err)
	}

	files := make([]meta.File, 0, childCount)
	var expectedBytes int64
	for index := range fileNodes {
		size := int64(index + 1)
		expectedBytes += size
		files = append(files, meta.File{
			NodeID:     fileNodes[index].ID,
			Size:       size,
			StorageKey: fmt.Sprintf("delete-summary/%03d", index),
		})
	}
	if err := db.Create(&files).Error; err != nil {
		t.Fatal(err)
	}

	counter.start()
	summary, err := activeSubtreeSummaryDB(db, user.ID, selected.ID)
	queryCount := counter.stop()
	if err != nil {
		t.Fatal(err)
	}
	if queryCount != 1 {
		t.Fatalf("active subtree summary used %d SQL statements; want exactly 1", queryCount)
	}
	if len(summary.IDs) != 1+childCount+childCount {
		t.Fatalf("active subtree node count=%d want=%d", len(summary.IDs), 1+childCount+childCount)
	}
	if summary.Bytes != expectedBytes {
		t.Fatalf("active subtree bytes=%d want=%d", summary.Bytes, expectedBytes)
	}

	fileSummary, err := activeSubtreeSummaryDB(db, user.ID, fileNodes[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(fileSummary.IDs) != 1 || fileSummary.IDs[0] != fileNodes[0].ID {
		t.Fatalf("file subtree ids=%v want only %d", fileSummary.IDs, fileNodes[0].ID)
	}
	if fileSummary.Bytes != files[0].Size {
		t.Fatalf("file subtree bytes=%d want=%d", fileSummary.Bytes, files[0].Size)
	}
}
