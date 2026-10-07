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

type archiveSubtreeSQLCounter struct {
	logger.Interface
	enabled atomic.Bool
	count   atomic.Int64
}

func (counter *archiveSubtreeSQLCounter) Trace(
	ctx context.Context,
	begin time.Time,
	fc func() (string, int64),
	err error,
) {
	if counter.enabled.Load() {
		counter.count.Add(1)
	}
	counter.Interface.Trace(ctx, begin, fc, err)
}

func (counter *archiveSubtreeSQLCounter) start() {
	counter.count.Store(0)
	counter.enabled.Store(true)
}

func (counter *archiveSubtreeSQLCounter) stop() int64 {
	counter.enabled.Store(false)
	return counter.count.Load()
}

func TestArchiveDownloadSubtreeUsesSingleRecursiveQuery(t *testing.T) {
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

	schema := "archive_subtree_perf_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	counter := &archiveSubtreeSQLCounter{Interface: logger.Discard}
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
		Username:       "archive-subtree-perf-owner",
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
	selected := meta.Node{
		ParentID: &rootID,
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
		selectedID := selected.ID
		directories = append(directories, meta.Node{
			ParentID: &selectedID,
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
			StorageKey: fmt.Sprintf("blob-%03d", index),
			SHA256:     fmt.Sprintf("%064x", index+1),
		})
	}
	if err := db.Create(&metadata).Error; err != nil {
		t.Fatal(err)
	}

	counter.start()
	children, err := loadArchiveDownloadSubtree(context.Background(), db, user.ID, selected.ID)
	queryCount := counter.stop()
	if err != nil {
		t.Fatal(err)
	}
	if queryCount != 1 {
		t.Fatalf("archive subtree SQL queries=%d want=1", queryCount)
	}
	if got := len(children[selected.ID]); got != childCount {
		t.Fatalf("selected child folders=%d want=%d", got, childCount)
	}
	for _, directory := range directories {
		items := children[directory.ID]
		if len(items) != 1 || items[0].Type != meta.NodeTypeFile || items[0].File == nil {
			t.Fatalf("directory %d children=%+v", directory.ID, items)
		}
	}
}
