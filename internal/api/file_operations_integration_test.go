package api

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestFileOperationWorkerLifecycle(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(
		&meta.FileOperation{}, &meta.Share{}, &meta.File{}, &meta.Node{}, &meta.User{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{}, &meta.Share{}, &meta.FileOperation{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error; err != nil {
		t.Fatal(err)
	}

	user := meta.User{Username: "file-operation-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
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

	createFile := func(name string, size int64) meta.Node {
		node := meta.Node{ParentID: &source.ID, Name: name, Type: meta.NodeTypeFile, OwnerID: user.ID, Revision: 1}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.File{NodeID: node.ID, Size: size, StorageKey: "legacy/" + name}).Error; err != nil {
			t.Fatal(err)
		}
		return node
	}
	first := createFile("a.txt", 3)
	second := createFile("b.txt", 4)

	srv := &Server{DB: db}
	refs := []batchNodeRef{
		{ID: first.ID, Revision: first.Revision},
		{ID: second.ID, Revision: second.Revision},
	}
	move, err := srv.enqueueFileOperation(context.Background(), user.ID, meta.FileOperationTypeMove, refs, target.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if move.Status != meta.FileOperationStatusQueued || move.TotalItems != 2 || move.TotalBytes != 7 {
		t.Fatalf("unexpected queued move: %+v", move)
	}
	processed, err := srv.processNextFileOperation(context.Background())
	if err != nil || !processed {
		t.Fatalf("process move: processed=%v err=%v", processed, err)
	}
	move, err = srv.loadOwnedFileOperation(context.Background(), user.ID, move.ID)
	if err != nil {
		t.Fatal(err)
	}
	if move.Status != meta.FileOperationStatusCompleted || move.ProcessedItems != 2 || move.ProcessedBytes != 7 {
		t.Fatalf("unexpected completed move: %+v", move)
	}
	assertBatchNodeParent(t, db, first.ID, target.ID)
	assertBatchNodeParent(t, db, second.ID, target.ID)

	cancelled, err := srv.enqueueFileOperation(context.Background(), user.ID, meta.FileOperationTypeDelete, []batchNodeRef{
		{ID: first.ID, Revision: 2},
		{ID: second.ID, Revision: 2},
	}, 0, nil)
	if err != nil {
		t.Fatal(err)
	}
	now := cancelled.CreatedAt
	if err := db.Model(&meta.FileOperation{}).Where("id = ?", cancelled.ID).Updates(map[string]any{
		"status": meta.FileOperationStatusCancelled, "cancel_requested_at": &now, "finished_at": &now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	retryOf := cancelled.ID
	retry, err := srv.enqueueFileOperation(context.Background(), user.ID, meta.FileOperationTypeDelete, []batchNodeRef{
		{ID: first.ID, Revision: 2},
		{ID: second.ID, Revision: 2},
	}, 0, &retryOf)
	if err != nil {
		t.Fatal(err)
	}
	if retry.RetryOfID == nil || *retry.RetryOfID != cancelled.ID {
		t.Fatalf("retry lineage missing: %+v", retry)
	}
	processed, err = srv.processNextFileOperation(context.Background())
	if err != nil || !processed {
		t.Fatalf("process retried delete: processed=%v err=%v", processed, err)
	}
	assertBatchNodeDeleted(t, db, first.ID)
	assertBatchNodeDeleted(t, db, second.ID)

	failureSource := meta.Node{ParentID: &root.ID, Name: "failure-source", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	failureTarget := meta.Node{ParentID: &root.ID, Name: "failure-target", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&failureSource).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&failureTarget).Error; err != nil {
		t.Fatal(err)
	}
	source = failureSource
	staleA := createFile("stale-a.txt", 1)
	staleB := createFile("stale-b.txt", 1)
	failed, err := srv.enqueueFileOperation(context.Background(), user.ID, meta.FileOperationTypeMove, []batchNodeRef{
		{ID: staleA.ID, Revision: 1},
		{ID: staleB.ID, Revision: 1},
	}, failureTarget.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.Node{}).Where("id = ?", staleB.ID).Update("revision", gorm.Expr("revision + 1")).Error; err != nil {
		t.Fatal(err)
	}
	processed, err = srv.processNextFileOperation(context.Background())
	if err != nil || !processed {
		t.Fatalf("process stale move: processed=%v err=%v", processed, err)
	}
	failed, err = srv.loadOwnedFileOperation(context.Background(), user.ID, failed.ID)
	if err != nil {
		t.Fatal(err)
	}
	if failed.Status != meta.FileOperationStatusFailed || failed.ProcessedItems != 0 || failed.ProcessedBytes != 0 || failed.FailedItemID != staleB.ID {
		t.Fatalf("failed operation did not expose atomic rollback: %+v", failed)
	}
	assertBatchNodeParent(t, db, staleA.ID, failureSource.ID)
	assertBatchNodeParent(t, db, staleB.ID, failureSource.ID)

	recovery, err := srv.enqueueFileOperation(context.Background(), user.ID, meta.FileOperationTypeMove, []batchNodeRef{
		{ID: staleA.ID, Revision: 1},
	}, failureTarget.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.FileOperation{}).Where("id = ?", recovery.ID).Updates(map[string]any{
		"status": meta.FileOperationStatusRunning, "processed_items": 1, "processed_bytes": 1, "current_item": staleA.Name,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := srv.recoverFileOperations(context.Background()); err != nil {
		t.Fatal(err)
	}
	recovery, err = srv.loadOwnedFileOperation(context.Background(), user.ID, recovery.ID)
	if err != nil {
		t.Fatal(err)
	}
	if recovery.Status != meta.FileOperationStatusQueued || recovery.ProcessedItems != 0 || recovery.ProcessedBytes != 0 || recovery.CurrentItem != "" {
		t.Fatalf("running operation was not safely re-queued: %+v", recovery)
	}

	other := meta.User{Username: "file-operation-other", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := srv.loadOwnedFileOperation(context.Background(), other.ID, move.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("cross-user operation lookup err=%v want record not found", err)
	}
}

func assertBatchNodeDeleted(t *testing.T, db *gorm.DB, id uint64) {
	t.Helper()
	var node meta.Node
	if err := db.First(&node, id).Error; err != nil {
		t.Fatal(err)
	}
	if node.DeletedAt == nil {
		t.Fatalf("node %d should be deleted", id)
	}
}
