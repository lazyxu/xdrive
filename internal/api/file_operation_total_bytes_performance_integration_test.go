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

func TestFileOperationSelectionBytesUsesSingleRecursiveQuery(t *testing.T) {
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

	schema := "fileop_bytes_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		Username:       "file-operation-bytes-owner",
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

	const selectedCount = 120
	directories := make([]meta.Node, 0, selectedCount)
	for index := 0; index < selectedCount; index++ {
		parent := root.ID
		directories = append(directories, meta.Node{
			ParentID: &parent,
			Name:     fmt.Sprintf("dir-%03d", index),
			Type:     meta.NodeTypeDir,
			OwnerID:  user.ID,
			Revision: 1,
		})
	}
	if err := db.Create(&directories).Error; err != nil {
		t.Fatal(err)
	}

	fileNodes := make([]meta.Node, 0, selectedCount)
	for index := range directories {
		parent := directories[index].ID
		fileNodes = append(fileNodes, meta.Node{
			ParentID: &parent,
			Name:     fmt.Sprintf("file-%03d.bin", index),
			Type:     meta.NodeTypeFile,
			OwnerID:  user.ID,
			Revision: 1,
		})
	}
	if err := db.Create(&fileNodes).Error; err != nil {
		t.Fatal(err)
	}

	files := make([]meta.File, 0, selectedCount)
	var expected int64
	for index := range fileNodes {
		size := int64(index + 1)
		expected += size
		files = append(files, meta.File{
			NodeID:     fileNodes[index].ID,
			Size:       size,
			StorageKey: fmt.Sprintf("fixture/%03d", index),
		})
	}
	if err := db.Create(&files).Error; err != nil {
		t.Fatal(err)
	}

	counter.start()
	total, err := fileOperationSelectionBytesTx(db, user.ID, directories)
	queryCount := counter.stop()
	if err != nil {
		t.Fatal(err)
	}
	if total != expected {
		t.Fatalf("selection bytes=%d want=%d", total, expected)
	}
	if queryCount != 1 {
		t.Fatalf("selection byte aggregation used %d SQL statements; want exactly 1", queryCount)
	}

	missingParent := root.ID
	missingFile := meta.Node{
		ParentID: &missingParent,
		Name:     "missing-file.bin",
		Type:     meta.NodeTypeFile,
		OwnerID:  user.ID,
		Revision: 1,
	}
	if err := db.Create(&missingFile).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := fileOperationSelectionBytesTx(db, user.ID, []meta.Node{missingFile}); err == nil {
		t.Fatal("selected file without metadata must still fail byte aggregation")
	}
}
