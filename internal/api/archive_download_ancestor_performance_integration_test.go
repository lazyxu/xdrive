package api

import (
	"context"
	"errors"
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

type archiveAncestorSQLCounter struct {
	logger.Interface
	enabled atomic.Bool
	count   atomic.Int64
}

func (counter *archiveAncestorSQLCounter) Trace(
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

func (counter *archiveAncestorSQLCounter) start() {
	counter.count.Store(0)
	counter.enabled.Store(true)
}

func (counter *archiveAncestorSQLCounter) stop() int64 {
	counter.enabled.Store(false)
	return counter.count.Load()
}

func TestArchiveSelectedAncestorCoverageUsesSingleRecursiveQuery(t *testing.T) {
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

	schema := "archive_ancestor_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	counter := &archiveAncestorSQLCounter{Interface: logger.Discard}
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

	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}); err != nil {
		t.Fatal(err)
	}

	user := meta.User{
		Username:       "archive-ancestor-owner",
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

	const (
		selectedCount = 120
		branchDepth   = 8
	)
	parents := make([]uint64, selectedCount)
	for index := range parents {
		parents[index] = root.ID
	}
	var deepest []meta.Node
	for depth := 0; depth < branchDepth; depth++ {
		level := make([]meta.Node, 0, selectedCount)
		for index := 0; index < selectedCount; index++ {
			parentID := parents[index]
			level = append(level, meta.Node{
				ParentID: &parentID,
				Name:     fmt.Sprintf("branch-%03d-level-%02d", index, depth),
				Type:     meta.NodeTypeDir,
				OwnerID:  user.ID,
				Revision: 1,
			})
		}
		if err := db.Create(&level).Error; err != nil {
			t.Fatal(err)
		}
		for index := range level {
			parents[index] = level[index].ID
		}
		deepest = level
	}

	files := make([]meta.Node, 0, selectedCount)
	for index := 0; index < selectedCount; index++ {
		parentID := parents[index]
		files = append(files, meta.Node{
			ParentID: &parentID,
			Name:     fmt.Sprintf("file-%03d.bin", index),
			Type:     meta.NodeTypeFile,
			OwnerID:  user.ID,
			Revision: 1,
		})
	}
	if err := db.Create(&files).Error; err != nil {
		t.Fatal(err)
	}
	ids := make([]uint64, 0, len(files))
	for _, file := range files {
		ids = append(ids, file.ID)
	}

	counter.start()
	coverage, err := archiveSelectedAncestorCoverage(context.Background(), db, user.ID, ids)
	queryCount := counter.stop()
	if err != nil {
		t.Fatal(err)
	}
	if queryCount != 1 {
		t.Fatalf("archive ancestor coverage SQL queries=%d want=1", queryCount)
	}
	for _, id := range ids {
		if coverage[id] {
			t.Fatalf("sibling selected node %d unexpectedly has selected ancestor", id)
		}
	}

	nestedIDs := []uint64{deepest[0].ID, files[0].ID}
	nested, err := archiveSelectedAncestorCoverage(context.Background(), db, user.ID, nestedIDs)
	if err != nil {
		t.Fatal(err)
	}
	if nested[deepest[0].ID] {
		t.Fatal("selected ancestor directory must remain a top-level archive root")
	}
	if !nested[files[0].ID] {
		t.Fatal("selected descendant file must be suppressed as a duplicate archive root")
	}

	missingParentID := uint64(9_999_999_999)
	broken := meta.Node{
		ParentID: &missingParentID,
		Name:     "broken.bin",
		Type:     meta.NodeTypeFile,
		OwnerID:  user.ID,
		Revision: 1,
	}
	if err := db.Create(&broken).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := archiveSelectedAncestorCoverage(
		context.Background(), db, user.ID, []uint64{broken.ID},
	); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("missing-parent coverage err=%v want record not found", err)
	}

	rootID := root.ID
	cycleA := meta.Node{
		ParentID: &rootID, Name: "cycle-a", Type: meta.NodeTypeDir,
		OwnerID: user.ID, Revision: 1,
	}
	if err := db.Create(&cycleA).Error; err != nil {
		t.Fatal(err)
	}
	cycleAID := cycleA.ID
	cycleB := meta.Node{
		ParentID: &cycleAID, Name: "cycle-b", Type: meta.NodeTypeDir,
		OwnerID: user.ID, Revision: 1,
	}
	if err := db.Create(&cycleB).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.Node{}).
		Where("id = ?", cycleA.ID).
		UpdateColumn("parent_id", cycleB.ID).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := archiveSelectedAncestorCoverage(
		context.Background(), db, user.ID, []uint64{cycleB.ID},
	); !errors.Is(err, errArchiveInvalidStoredEntry) {
		t.Fatalf("cycle coverage err=%v want invalid stored entry", err)
	}
}
