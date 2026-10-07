package api

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type fileOperationCopySourceSQLCounter struct {
	logger.Interface
	enabled atomic.Bool
	count   atomic.Int64
}

func (counter *fileOperationCopySourceSQLCounter) Trace(
	ctx context.Context,
	begin time.Time,
	fc func() (string, int64),
	err error,
) {
	sql, rows := fc()
	if counter.enabled.Load() {
		lower := strings.ToLower(sql)
		if strings.Contains(lower, "select") &&
			(strings.Contains(lower, "xd_nodes") || strings.Contains(lower, "xd_files")) {
			counter.count.Add(1)
		}
	}
	counter.Interface.Trace(ctx, begin, func() (string, int64) {
		return sql, rows
	}, err)
}

func (counter *fileOperationCopySourceSQLCounter) start() {
	counter.count.Store(0)
	counter.enabled.Store(true)
}

func (counter *fileOperationCopySourceSQLCounter) stop() int64 {
	counter.enabled.Store(false)
	return counter.count.Load()
}

func TestFileOperationCopyLoadsSourceSubtreeOnce(t *testing.T) {
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

	schema := "copy_subtree_perf_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	counter := &fileOperationCopySourceSQLCounter{Interface: logger.Discard}
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
		Username:       "copy-subtree-perf-owner",
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
	rootID := root.ID
	source := meta.Node{
		ParentID: &rootID,
		Name:     "source",
		Type:     meta.NodeTypeDir,
		OwnerID:  user.ID,
		Revision: 1,
	}
	target := meta.Node{
		ParentID: &rootID,
		Name:     "target",
		Type:     meta.NodeTypeDir,
		OwnerID:  user.ID,
		Revision: 1,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&target).Error; err != nil {
		t.Fatal(err)
	}

	const childCount = 120
	directories := make([]meta.Node, 0, childCount)
	for index := 0; index < childCount; index++ {
		sourceID := source.ID
		directories = append(directories, meta.Node{
			ParentID: &sourceID,
			Name:     fmt.Sprintf("dir-%03d", index),
			Type:     meta.NodeTypeDir,
			OwnerID:  user.ID,
			Revision: 1,
		})
	}
	if err := db.Create(&directories).Error; err != nil {
		t.Fatal(err)
	}

	files := make([]meta.Node, 0, childCount)
	for index := range directories {
		directoryID := directories[index].ID
		files = append(files, meta.Node{
			ParentID: &directoryID,
			Name:     "payload.bin",
			Type:     meta.NodeTypeFile,
			OwnerID:  user.ID,
			Revision: 1,
		})
	}
	if err := db.Create(&files).Error; err != nil {
		t.Fatal(err)
	}

	metadata := make([]meta.File, 0, childCount)
	for index := range files {
		metadata = append(metadata, meta.File{
			NodeID:     files[index].ID,
			Size:       int64(index + 1),
			StorageKey: fmt.Sprintf("legacy-copy-source-%03d", index),
			SHA256:     fmt.Sprintf("%064x", index+1),
		})
	}
	if err := db.Create(&metadata).Error; err != nil {
		t.Fatal(err)
	}

	server := &Server{}
	var copied meta.Node
	counter.start()
	err = db.Transaction(func(tx *gorm.DB) error {
		var copyErr error
		copied, copyErr = server.copyNodeTxWithHooks(
			tx,
			user.ID,
			source,
			target.ID,
			source.Name,
			source.Name,
			nil,
		)
		return copyErr
	})
	sourceQueries := counter.stop()
	if err != nil {
		t.Fatal(err)
	}
	if sourceQueries != 1 {
		t.Fatalf("copy source-tree SELECTs=%d want=1", sourceQueries)
	}
	if copied.Name != source.Name || copied.Type != meta.NodeTypeDir || copied.ParentID == nil || *copied.ParentID != target.ID {
		t.Fatalf("copied root=%+v", copied)
	}

	var copiedNodeCount int64
	if err := db.Raw(`WITH RECURSIVE tree AS (
SELECT id, type FROM xd_nodes WHERE id = ? AND owner_id = ?
UNION ALL
SELECT n.id, n.type
FROM xd_nodes AS n
JOIN tree ON n.parent_id = tree.id
WHERE n.owner_id = ? AND n.deleted_at IS NULL
)
SELECT COUNT(*) FROM tree
`, copied.ID, user.ID, user.ID).Scan(&copiedNodeCount).Error; err != nil {
		t.Fatal(err)
	}
	if copiedNodeCount != 1+2*childCount {
		t.Fatalf("copied subtree nodes=%d want=%d", copiedNodeCount, 1+2*childCount)
	}

	var copiedFileCount int64
	if err := db.Raw(`WITH RECURSIVE tree AS (
SELECT id FROM xd_nodes WHERE id = ? AND owner_id = ?
UNION ALL
SELECT n.id
FROM xd_nodes AS n
JOIN tree ON n.parent_id = tree.id
WHERE n.owner_id = ? AND n.deleted_at IS NULL
)
SELECT COUNT(*)
FROM tree
JOIN xd_files AS f ON f.node_id = tree.id
`, copied.ID, user.ID, user.ID).Scan(&copiedFileCount).Error; err != nil {
		t.Fatal(err)
	}
	if copiedFileCount != childCount {
		t.Fatalf("copied file metadata rows=%d want=%d", copiedFileCount, childCount)
	}
}
