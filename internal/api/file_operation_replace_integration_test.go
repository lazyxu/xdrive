package api

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func setupFileOperationReplaceTestDB(t *testing.T) (*gorm.DB, *Server, meta.User, meta.Node) {
	t.Helper()
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(2)
	sqlDB.SetMaxIdleConns(1)
	t.Cleanup(func() {
		_ = sqlDB.Close()
	})
	if err := db.Migrator().DropTable(&meta.FileOperation{}, &meta.Share{}, &meta.File{}, &meta.Node{}, &meta.User{}); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.File{}, &meta.Share{}, &meta.FileOperation{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	user := meta.User{Username: "file-operation-replace-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	return db, &Server{DB: db}, user, root
}

func createReplaceTestDir(t *testing.T, db *gorm.DB, uid, parentID uint64, name string) meta.Node {
	t.Helper()
	node := meta.Node{ParentID: &parentID, Name: name, Type: meta.NodeTypeDir, OwnerID: uid, Revision: 1}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	return node
}

func createReplaceTestFile(t *testing.T, db *gorm.DB, uid, parentID uint64, name string, size int64) meta.Node {
	t.Helper()
	node := meta.Node{ParentID: &parentID, Name: name, Type: meta.NodeTypeFile, OwnerID: uid, Revision: 1}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	file := meta.File{NodeID: node.ID, Size: size, StorageKey: fmt.Sprintf("legacy/%d/%s/%d", parentID, name, node.ID)}
	if err := db.Create(&file).Error; err != nil {
		t.Fatal(err)
	}
	node.File = &file
	return node
}

func activeReplaceTestNode(t *testing.T, db *gorm.DB, uid, parentID uint64, name string) meta.Node {
	t.Helper()
	var node meta.Node
	if err := db.Preload("File").Where("owner_id = ? AND parent_id = ? AND deleted_at IS NULL AND lower(name) = lower(?)", uid, parentID, name).First(&node).Error; err != nil {
		t.Fatal(err)
	}
	return node
}

func assertReplaceTestTrashed(t *testing.T, db *gorm.DB, nodeID uint64) {
	t.Helper()
	var node meta.Node
	if err := db.Where("id = ?", nodeID).First(&node).Error; err != nil {
		t.Fatal(err)
	}
	if node.DeletedAt == nil || node.TrashRootID == nil || *node.TrashRootID != node.ID {
		t.Fatalf("node %d was not retained as a trash root: %+v", nodeID, node)
	}
}

func processReplaceTestOperation(t *testing.T, srv *Server, uid uint64, operation meta.FileOperation) meta.FileOperation {
	t.Helper()
	processed, err := srv.processNextFileOperation(context.Background())
	if err != nil || !processed {
		t.Fatalf("process operation: processed=%v err=%v", processed, err)
	}
	operation, err = srv.loadOwnedFileOperation(context.Background(), uid, operation.ID)
	if err != nil {
		t.Fatal(err)
	}
	if operation.Status != meta.FileOperationStatusCompleted {
		t.Fatalf("operation did not complete: %+v", operation)
	}
	return operation
}

func TestFileOperationReplaceFilesAndMergeDirectories(t *testing.T) {
	db, srv, user, root := setupFileOperationReplaceTestDB(t)
	source := createReplaceTestDir(t, db, user.ID, root.ID, "source")
	target := createReplaceTestDir(t, db, user.ID, root.ID, "target")

	moveTarget := createReplaceTestFile(t, db, user.ID, target.ID, "move.txt", 2)
	moveSource := createReplaceTestFile(t, db, user.ID, source.ID, "move.txt", 3)
	move, err := srv.enqueueFileOperationWithConflictPolicy(context.Background(), user.ID, meta.FileOperationTypeMove, []batchNodeRef{{ID: moveSource.ID, Revision: moveSource.Revision}}, target.ID, nil, meta.FileOperationConflictPolicyReplace)
	if err != nil {
		t.Fatal(err)
	}
	move = processReplaceTestOperation(t, srv, user.ID, move)
	moved := activeReplaceTestNode(t, db, user.ID, target.ID, "move.txt")
	if moved.ID != moveSource.ID || moved.File == nil || moved.File.Size != 3 {
		t.Fatalf("move replace result=%+v", moved)
	}
	assertReplaceTestTrashed(t, db, moveTarget.ID)
	if fileOperationUndoable(move) {
		t.Fatalf("replace must not advertise unsafe undo: %+v", move)
	}

	copyTarget := createReplaceTestFile(t, db, user.ID, target.ID, "copy.txt", 4)
	copySource := createReplaceTestFile(t, db, user.ID, source.ID, "copy.txt", 5)
	copyOp, err := srv.enqueueFileOperationWithConflictPolicy(context.Background(), user.ID, meta.FileOperationTypeCopy, []batchNodeRef{{ID: copySource.ID, Revision: copySource.Revision}}, target.ID, nil, meta.FileOperationConflictPolicyReplace)
	if err != nil {
		t.Fatal(err)
	}
	copyOp = processReplaceTestOperation(t, srv, user.ID, copyOp)
	copied := activeReplaceTestNode(t, db, user.ID, target.ID, "copy.txt")
	if copied.ID == copyTarget.ID || copied.ID == copySource.ID || copied.File == nil || copied.File.Size != 5 {
		t.Fatalf("copy replace result=%+v", copied)
	}
	assertReplaceTestTrashed(t, db, copyTarget.ID)
	activeReplaceTestNode(t, db, user.ID, source.ID, "copy.txt")
	if fileOperationUndoable(copyOp) {
		t.Fatalf("copy replace must not advertise unsafe undo: %+v", copyOp)
	}

	copySourceDir := createReplaceTestDir(t, db, user.ID, source.ID, "copy-merge")
	copyTargetDir := createReplaceTestDir(t, db, user.ID, target.ID, "copy-merge")
	createReplaceTestFile(t, db, user.ID, copyTargetDir.ID, "target-only.txt", 7)
	copyOld := createReplaceTestFile(t, db, user.ID, copyTargetDir.ID, "same.txt", 8)
	createReplaceTestFile(t, db, user.ID, copySourceDir.ID, "same.txt", 9)
	copyNestedSource := createReplaceTestDir(t, db, user.ID, copySourceDir.ID, "nested")
	copyNestedTarget := createReplaceTestDir(t, db, user.ID, copyTargetDir.ID, "nested")
	copyNestedOld := createReplaceTestFile(t, db, user.ID, copyNestedTarget.ID, "inside.txt", 10)
	createReplaceTestFile(t, db, user.ID, copyNestedSource.ID, "inside.txt", 11)

	copyMerge, err := srv.enqueueFileOperationWithConflictPolicy(context.Background(), user.ID, meta.FileOperationTypeCopy, []batchNodeRef{{ID: copySourceDir.ID, Revision: copySourceDir.Revision}}, target.ID, nil, meta.FileOperationConflictPolicyReplace)
	if err != nil {
		t.Fatal(err)
	}
	copyMerge = processReplaceTestOperation(t, srv, user.ID, copyMerge)
	if got := activeReplaceTestNode(t, db, user.ID, target.ID, "copy-merge"); got.ID != copyTargetDir.ID {
		t.Fatalf("copy merge replaced target root: %+v", got)
	}
	activeReplaceTestNode(t, db, user.ID, copyTargetDir.ID, "target-only.txt")
	if got := activeReplaceTestNode(t, db, user.ID, copyTargetDir.ID, "same.txt"); got.File == nil || got.File.Size != 9 {
		t.Fatalf("merged copy file=%+v", got)
	}
	if got := activeReplaceTestNode(t, db, user.ID, copyNestedTarget.ID, "inside.txt"); got.File == nil || got.File.Size != 11 {
		t.Fatalf("nested merged copy file=%+v", got)
	}
	assertReplaceTestTrashed(t, db, copyOld.ID)
	assertReplaceTestTrashed(t, db, copyNestedOld.ID)
	activeReplaceTestNode(t, db, user.ID, source.ID, "copy-merge")
	if fileOperationUndoable(copyMerge) {
		t.Fatalf("folder merge must not advertise unsafe undo: %+v", copyMerge)
	}

	moveSourceDir := createReplaceTestDir(t, db, user.ID, source.ID, "move-merge")
	moveTargetDir := createReplaceTestDir(t, db, user.ID, target.ID, "move-merge")
	createReplaceTestFile(t, db, user.ID, moveTargetDir.ID, "target-only.txt", 12)
	moveOld := createReplaceTestFile(t, db, user.ID, moveTargetDir.ID, "same.txt", 13)
	moveChild := createReplaceTestFile(t, db, user.ID, moveSourceDir.ID, "same.txt", 14)
	moveSourceOnly := createReplaceTestFile(t, db, user.ID, moveSourceDir.ID, "source-only.txt", 15)

	moveMerge, err := srv.enqueueFileOperationWithConflictPolicy(context.Background(), user.ID, meta.FileOperationTypeMove, []batchNodeRef{{ID: moveSourceDir.ID, Revision: moveSourceDir.Revision}}, target.ID, nil, meta.FileOperationConflictPolicyReplace)
	if err != nil {
		t.Fatal(err)
	}
	moveMerge = processReplaceTestOperation(t, srv, user.ID, moveMerge)
	if got := activeReplaceTestNode(t, db, user.ID, target.ID, "move-merge"); got.ID != moveTargetDir.ID {
		t.Fatalf("move merge replaced target root: %+v", got)
	}
	if got := activeReplaceTestNode(t, db, user.ID, moveTargetDir.ID, "same.txt"); got.ID != moveChild.ID {
		t.Fatalf("move merge did not preserve moving node identity: %+v", got)
	}
	if got := activeReplaceTestNode(t, db, user.ID, moveTargetDir.ID, "source-only.txt"); got.ID != moveSourceOnly.ID {
		t.Fatalf("move merge did not move source-only entry: %+v", got)
	}
	activeReplaceTestNode(t, db, user.ID, moveTargetDir.ID, "target-only.txt")
	assertReplaceTestTrashed(t, db, moveOld.ID)
	var removed meta.Node
	if err := db.Where("id = ?", moveSourceDir.ID).First(&removed).Error; !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("merged source root must be removed, got=%+v err=%v", removed, err)
	}
	if fileOperationUndoable(moveMerge) {
		t.Fatalf("move merge must not advertise unsafe undo: %+v", moveMerge)
	}
}

func TestFileOperationDefaultCopyConflictsButSameFolderStillDuplicates(t *testing.T) {
	db, srv, user, root := setupFileOperationReplaceTestDB(t)
	source := createReplaceTestDir(t, db, user.ID, root.ID, "source")
	target := createReplaceTestDir(t, db, user.ID, root.ID, "target")
	existing := createReplaceTestFile(t, db, user.ID, target.ID, "same.txt", 1)
	copySource := createReplaceTestFile(t, db, user.ID, source.ID, "same.txt", 2)
	conflicting, err := srv.enqueueFileOperation(context.Background(), user.ID, meta.FileOperationTypeCopy, []batchNodeRef{{ID: copySource.ID, Revision: copySource.Revision}}, target.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if conflicting.ConflictPolicy != meta.FileOperationConflictPolicyFail {
		t.Fatalf("default cross-folder copy policy=%q", conflicting.ConflictPolicy)
	}
	if processed, err := srv.processNextFileOperation(context.Background()); err != nil || !processed {
		t.Fatalf("process conflicting copy: processed=%v err=%v", processed, err)
	}
	conflicting, err = srv.loadOwnedFileOperation(context.Background(), user.ID, conflicting.ID)
	if err != nil {
		t.Fatal(err)
	}
	if conflicting.Status != meta.FileOperationStatusFailed || conflicting.FailureCode != "name_conflict" {
		t.Fatalf("cross-folder copy must expose a resolvable conflict: %+v", conflicting)
	}
	if got := activeReplaceTestNode(t, db, user.ID, target.ID, "same.txt"); got.ID != existing.ID {
		t.Fatalf("failed copy mutated destination: %+v", got)
	}

	local := createReplaceTestFile(t, db, user.ID, source.ID, "local.txt", 3)
	duplicate, err := srv.enqueueFileOperation(context.Background(), user.ID, meta.FileOperationTypeCopy, []batchNodeRef{{ID: local.ID, Revision: local.Revision}}, source.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	duplicate = processReplaceTestOperation(t, srv, user.ID, duplicate)
	activeReplaceTestNode(t, db, user.ID, source.ID, "local - 副本.txt")
	if !fileOperationUndoable(duplicate) {
		t.Fatalf("same-folder duplicate should remain safely undoable: %+v", duplicate)
	}
}
