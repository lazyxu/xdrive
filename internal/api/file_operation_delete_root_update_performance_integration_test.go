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

type fileOperationDeleteNodeUpdateCounter struct {
	logger.Interface
	enabled atomic.Bool
	count   atomic.Int64
}

func (counter *fileOperationDeleteNodeUpdateCounter) Trace(
	ctx context.Context,
	begin time.Time,
	fc func() (string, int64),
	err error,
) {
	if counter.enabled.Load() {
		sql, _ := fc()
		normalized := strings.ToLower(sql)
		if strings.Contains(normalized, "update \"xd_nodes\"") ||
			strings.Contains(normalized, "update xd_nodes") {
			counter.count.Add(1)
		}
	}
	counter.Interface.Trace(ctx, begin, fc, err)
}

func (counter *fileOperationDeleteNodeUpdateCounter) start() {
	counter.count.Store(0)
	counter.enabled.Store(true)
}

func (counter *fileOperationDeleteNodeUpdateCounter) stop() int64 {
	counter.enabled.Store(false)
	return counter.count.Load()
}

func TestFileOperationDeleteNodeUpdatesCoalesced(t *testing.T) {
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

	schema := "fileop_delete_node_updates_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	counter := &fileOperationDeleteNodeUpdateCounter{Interface: logger.Discard}
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

	if err := db.AutoMigrate(
		&meta.User{},
		&meta.Node{},
		&meta.File{},
		&meta.Share{},
		&meta.Source{},
		&meta.FileOperation{},
	); err != nil {
		t.Fatal(err)
	}

	user := meta.User{
		Username:       "file-operation-delete-node-update-owner",
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
	nodes := make([]meta.Node, 0, selectedCount)
	for index := 0; index < selectedCount; index++ {
		parent := root.ID
		nodes = append(nodes, meta.Node{
			ParentID: &parent,
			Name:     fmt.Sprintf("delete-%03d.bin", index),
			Type:     meta.NodeTypeFile,
			OwnerID:  user.ID,
			Revision: 1,
		})
	}
	if err := db.Create(&nodes).Error; err != nil {
		t.Fatal(err)
	}

	files := make([]meta.File, 0, selectedCount)
	refs := make([]batchNodeRef, 0, selectedCount)
	var totalBytes int64
	for index := range nodes {
		size := int64(index + 1)
		totalBytes += size
		files = append(files, meta.File{
			NodeID:     nodes[index].ID,
			Size:       size,
			StorageKey: fmt.Sprintf("delete-node-updates/%03d", index),
		})
		refs = append(refs, batchNodeRef{ID: nodes[index].ID, Revision: nodes[index].Revision})
	}
	if err := db.Create(&files).Error; err != nil {
		t.Fatal(err)
	}

	operation := meta.FileOperation{
		ID:             uuid.NewString(),
		OwnerID:        user.ID,
		Type:           meta.FileOperationTypeDelete,
		Status:         meta.FileOperationStatusRunning,
		ItemsJSON:      "[]",
		TotalItems:     selectedCount,
		TotalBytes:     totalBytes,
		ProcessedItems: 0,
		ProcessedBytes: 0,
	}
	if err := db.Create(&operation).Error; err != nil {
		t.Fatal(err)
	}

	server := &Server{DB: db}
	counter.start()
	err = server.executeQueuedBatchDelete(context.Background(), operation, refs)
	nodeUpdates := counter.stop()
	if err != nil {
		t.Fatal(err)
	}

	const wantNodeUpdates = selectedCount
	if nodeUpdates != wantNodeUpdates {
		t.Fatalf("delete xd_nodes UPDATEs=%d want coalesced %d", nodeUpdates, wantNodeUpdates)
	}

	var stored meta.FileOperation
	if err := db.First(&stored, "id = ?", operation.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Status != meta.FileOperationStatusCompleted ||
		stored.ProcessedItems != selectedCount ||
		stored.ProcessedBytes != totalBytes {
		t.Fatalf("completed operation=%+v", stored)
	}

	for index, node := range nodes {
		var deleted meta.Node
		if err := db.Unscoped().First(&deleted, node.ID).Error; err != nil {
			t.Fatal(err)
		}
		if deleted.DeletedAt == nil || deleted.TrashRootID == nil || *deleted.TrashRootID != node.ID {
			t.Fatalf("deleted node %d trash state=%+v", index, deleted)
		}
		if deleted.Revision != refs[index].Revision+1 {
			t.Fatalf("deleted node %d revision=%d want=%d", index, deleted.Revision, refs[index].Revision+1)
		}
	}
}

func TestFileOperationDeleteRootsAreRevisionLockedBeforeMutation(t *testing.T) {
	sourceBytes, err := os.ReadFile("batch_nodes.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(sourceBytes)
	start := strings.Index(source, "func batchLoadNodesTx(")
	if start < 0 {
		t.Fatal("missing batchLoadNodesTx")
	}
	body := source[start:]
	if next := strings.Index(body[1:], "\nfunc "); next >= 0 {
		body = body[:next+1]
	}
	for _, token := range []string{
		`clause.Locking{Strength: "UPDATE"}`,
		`if node.Revision != ref.Revision`,
		`Code: "revision_conflict"`,
	} {
		if !strings.Contains(body, token) {
			t.Fatalf("batchLoadNodesTx must retain pre-mutation root revision lock/validation: missing %q", token)
		}
	}

	fileOperationBytes, err := os.ReadFile("file_operations.go")
	if err != nil {
		t.Fatal(err)
	}
	fileOperations := string(fileOperationBytes)
	deleteStart := strings.Index(fileOperations, "func (s *Server) executeQueuedBatchDelete(")
	if deleteStart < 0 {
		t.Fatal("missing executeQueuedBatchDelete")
	}
	deleteBody := fileOperations[deleteStart:]
	if next := strings.Index(deleteBody[1:], "\nfunc "); next >= 0 {
		deleteBody = deleteBody[:next+1]
	}
	if !strings.Contains(deleteBody, "batchLoadNodesTx(tx, uid, refs, true)") {
		t.Fatal("delete execution must batch-lock and revision-validate roots before mutation")
	}
}

func TestMarkFileOperationDeleteSubtreePreservesSemantics(t *testing.T) {
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

	schema := "fileop_delete_subtree_semantics_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{Logger: logger.Discard})
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
		Username:       "file-operation-delete-subtree-semantics",
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
		Revision: 7,
	}
	if err := db.Create(&selected).Error; err != nil {
		t.Fatal(err)
	}
	childParent := selected.ID
	child := meta.Node{
		ParentID: &childParent,
		Name:     "child",
		Type:     meta.NodeTypeFile,
		OwnerID:  user.ID,
		Revision: 3,
	}
	if err := db.Create(&child).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	updated, err := markFileOperationDeleteSubtreeTx(
		db,
		user.ID,
		selected.ID,
		selected.Revision,
		[]uint64{selected.ID, child.ID},
		now,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !updated {
		t.Fatal("active selected root was not updated")
	}

	var selectedAfter meta.Node
	if err := db.Unscoped().First(&selectedAfter, selected.ID).Error; err != nil {
		t.Fatal(err)
	}
	if selectedAfter.DeletedAt == nil ||
		selectedAfter.TrashRootID == nil ||
		*selectedAfter.TrashRootID != selected.ID ||
		selectedAfter.Revision != selected.Revision+1 ||
		!selectedAfter.UpdatedAt.Equal(now) {
		t.Fatalf("selected root after delete=%+v", selectedAfter)
	}
	var childAfter meta.Node
	if err := db.Unscoped().First(&childAfter, child.ID).Error; err != nil {
		t.Fatal(err)
	}
	if childAfter.DeletedAt == nil ||
		childAfter.TrashRootID == nil ||
		*childAfter.TrashRootID != selected.ID ||
		childAfter.Revision != child.Revision ||
		!childAfter.UpdatedAt.Equal(now) {
		t.Fatalf("child after delete=%+v", childAfter)
	}

	priorDeletedAt := time.Date(2026, 10, 7, 10, 0, 0, 0, time.UTC)
	priorTrashRoot := root.ID
	alreadyDeleted := meta.Node{
		ParentID:    &parent,
		Name:        "already-deleted",
		Type:        meta.NodeTypeFile,
		OwnerID:     user.ID,
		Revision:    11,
		DeletedAt:   &priorDeletedAt,
		TrashRootID: &priorTrashRoot,
	}
	if err := db.Create(&alreadyDeleted).Error; err != nil {
		t.Fatal(err)
	}
	secondNow := now.Add(time.Minute)
	updated, err = markFileOperationDeleteSubtreeTx(
		db,
		user.ID,
		alreadyDeleted.ID,
		alreadyDeleted.Revision,
		[]uint64{alreadyDeleted.ID},
		secondNow,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !updated {
		t.Fatal("already-deleted selected root did not receive its revision bump")
	}
	var alreadyDeletedAfter meta.Node
	if err := db.Unscoped().First(&alreadyDeletedAfter, alreadyDeleted.ID).Error; err != nil {
		t.Fatal(err)
	}
	if alreadyDeletedAfter.DeletedAt == nil ||
		!alreadyDeletedAfter.DeletedAt.Equal(priorDeletedAt) ||
		alreadyDeletedAfter.TrashRootID == nil ||
		*alreadyDeletedAfter.TrashRootID != priorTrashRoot ||
		alreadyDeletedAfter.Revision != alreadyDeleted.Revision+1 ||
		!alreadyDeletedAfter.UpdatedAt.Equal(secondNow) {
		t.Fatalf("already-deleted root after update=%+v", alreadyDeletedAfter)
	}

	mismatchParent := root.ID
	mismatch := meta.Node{
		ParentID: &mismatchParent,
		Name:     "revision-mismatch",
		Type:     meta.NodeTypeFile,
		OwnerID:  user.ID,
		Revision: 5,
	}
	if err := db.Create(&mismatch).Error; err != nil {
		t.Fatal(err)
	}
	updated, err = markFileOperationDeleteSubtreeTx(
		db,
		user.ID,
		mismatch.ID,
		mismatch.Revision+1,
		[]uint64{mismatch.ID},
		secondNow,
	)
	if err != nil {
		t.Fatal(err)
	}
	if updated {
		t.Fatal("revision-mismatched root must not mutate")
	}
	var mismatchAfter meta.Node
	if err := db.Unscoped().First(&mismatchAfter, mismatch.ID).Error; err != nil {
		t.Fatal(err)
	}
	if mismatchAfter.DeletedAt != nil ||
		mismatchAfter.TrashRootID != nil ||
		mismatchAfter.Revision != mismatch.Revision {
		t.Fatalf("revision-mismatched root mutated: %+v", mismatchAfter)
	}
}
