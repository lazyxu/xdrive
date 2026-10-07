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

type fileOperationSQLCounter struct {
	logger.Interface
	enabled atomic.Bool
	count   atomic.Int64
}

func (counter *fileOperationSQLCounter) Trace(
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

func (counter *fileOperationSQLCounter) start() {
	counter.count.Store(0)
	counter.enabled.Store(true)
}

func (counter *fileOperationSQLCounter) stop() int64 {
	counter.enabled.Store(false)
	return counter.count.Load()
}

func TestBatchAncestorCoverageUsesConstantSQL(t *testing.T) {
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

	schema := "fileop_ancestor_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}); err != nil {
		t.Fatal(err)
	}

	user := meta.User{
		Username:       "file-operation-ancestor-owner",
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

	parentID := root.ID
	var deepest meta.Node
	for depth := 0; depth < 8; depth++ {
		parent := parentID
		deepest = meta.Node{
			ParentID: &parent,
			Name:     fmt.Sprintf("level-%02d", depth),
			Type:     meta.NodeTypeDir,
			OwnerID:  user.ID,
			Revision: 1,
		}
		if err := db.Create(&deepest).Error; err != nil {
			t.Fatal(err)
		}
		parentID = deepest.ID
	}

	const selectedCount = 120
	files := make([]meta.Node, 0, selectedCount)
	for index := 0; index < selectedCount; index++ {
		parent := parentID
		files = append(files, meta.Node{
			ParentID: &parent,
			Name:     fmt.Sprintf("file-%03d.bin", index),
			Type:     meta.NodeTypeFile,
			OwnerID:  user.ID,
			Revision: 1,
		})
	}
	if err := db.Create(&files).Error; err != nil {
		t.Fatal(err)
	}
	refs := make([]batchNodeRef, 0, len(files))
	for _, file := range files {
		refs = append(refs, batchNodeRef{ID: file.ID, Revision: file.Revision})
	}

	counter.start()
	topLevel, err := topLevelBatchDeleteRefs(db, user.ID, refs)
	topLevelQueries := counter.stop()
	if err != nil {
		t.Fatal(err)
	}
	if len(topLevel) != len(refs) {
		t.Fatalf("top-level refs=%d want=%d", len(topLevel), len(refs))
	}
	if topLevelQueries > 2 {
		t.Fatalf("top-level ancestor coverage used %d SQL statements; want constant-query <=2", topLevelQueries)
	}

	counter.start()
	hasAncestor, err := batchSelectionHasAncestor(db, user.ID, refs)
	selectionQueries := counter.stop()
	if err != nil {
		t.Fatal(err)
	}
	if hasAncestor {
		t.Fatal("sibling-only selection unexpectedly has a selected ancestor")
	}
	if selectionQueries > 2 {
		t.Fatalf("selection ancestor coverage used %d SQL statements; want constant-query <=2", selectionQueries)
	}

	nested := []batchNodeRef{
		{ID: deepest.ID, Revision: deepest.Revision},
		{ID: files[0].ID, Revision: files[0].Revision},
	}
	counter.start()
	nestedTopLevel, err := topLevelBatchDeleteRefs(db, user.ID, nested)
	nestedQueries := counter.stop()
	if err != nil {
		t.Fatal(err)
	}
	if len(nestedTopLevel) != 1 || nestedTopLevel[0].ID != deepest.ID {
		t.Fatalf("nested top-level refs=%+v want only directory %d", nestedTopLevel, deepest.ID)
	}
	if nestedQueries > 2 {
		t.Fatalf("nested top-level coverage used %d SQL statements; want constant-query <=2", nestedQueries)
	}
	hasAncestor, err = batchSelectionHasAncestor(db, user.ID, nested)
	if err != nil {
		t.Fatal(err)
	}
	if !hasAncestor {
		t.Fatal("nested selection must report a selected ancestor")
	}

	missingID := files[len(files)-1].ID + 1_000_000
	_, err = topLevelBatchDeleteRefs(db, user.ID, []batchNodeRef{
		{ID: files[0].ID, Revision: files[0].Revision},
		{ID: missingID, Revision: 1},
	})
	var failure *batchMutationFailure
	if err == nil || !errorsAsBatchMutationFailure(err, &failure) {
		t.Fatalf("missing selected node err=%v want batch mutation failure", err)
	}
	if failure.Index != 1 || failure.ID != missingID || failure.Code != "node_not_found" {
		t.Fatalf("missing selected node failure=%+v", failure)
	}
}

func errorsAsBatchMutationFailure(err error, target **batchMutationFailure) bool {
	for err != nil {
		if failure, ok := err.(*batchMutationFailure); ok {
			*target = failure
			return true
		}
		type unwrapper interface{ Unwrap() error }
		wrapped, ok := err.(unwrapper)
		if !ok {
			return false
		}
		err = wrapped.Unwrap()
	}
	return false
}
