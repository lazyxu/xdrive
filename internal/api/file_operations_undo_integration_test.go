package api

import (
	"context"
	"os"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func setupFileOperationUndoTestDB(t *testing.T) (*gorm.DB, *Server, meta.User, meta.Node) {
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
	sqlDB.SetMaxOpenConns(4)
	sqlDB.SetMaxIdleConns(2)
	t.Cleanup(func() {
		_ = sqlDB.Close()
	})
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

	user := meta.User{Username: "file-operation-undo-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: user.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	return db, &Server{DB: db}, user, root
}

func createUndoTestDirectory(t *testing.T, db *gorm.DB, ownerID uint64, parentID uint64, name string) meta.Node {
	t.Helper()
	node := meta.Node{ParentID: &parentID, Name: name, Type: meta.NodeTypeDir, OwnerID: ownerID, Revision: 1}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	return node
}

func processUndoTestOperation(t *testing.T, srv *Server, ownerID uint64, operation meta.FileOperation) meta.FileOperation {
	t.Helper()
	processed, err := srv.processNextFileOperation(context.Background())
	if err != nil || !processed {
		t.Fatalf("process %s operation: processed=%v err=%v", operation.Type, processed, err)
	}
	current, err := srv.loadOwnedFileOperation(context.Background(), ownerID, operation.ID)
	if err != nil {
		t.Fatal(err)
	}
	return current
}

func assertUndoTestNodeActive(t *testing.T, db *gorm.DB, ownerID, nodeID uint64) meta.Node {
	t.Helper()
	var node meta.Node
	if err := db.Where("id = ? AND owner_id = ? AND deleted_at IS NULL", nodeID, ownerID).First(&node).Error; err != nil {
		t.Fatalf("active node %d: %v", nodeID, err)
	}
	return node
}

func TestFileOperationUndoMoveDeleteAndCopy(t *testing.T) {
	db, srv, user, root := setupFileOperationUndoTestDB(t)
	source := createUndoTestDirectory(t, db, user.ID, root.ID, "source")
	target := createUndoTestDirectory(t, db, user.ID, root.ID, "target")

	moveNode := createUndoTestDirectory(t, db, user.ID, source.ID, "move-me")
	move, err := srv.enqueueFileOperation(
		context.Background(),
		user.ID,
		meta.FileOperationTypeMove,
		[]batchNodeRef{{ID: moveNode.ID, Revision: moveNode.Revision}},
		target.ID,
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	move = processUndoTestOperation(t, srv, user.ID, move)
	if !fileOperationUndoable(move) || toFileOperationDTO(move).Undoable != true {
		t.Fatalf("completed move should be undoable: %+v", move)
	}
	assertBatchNodeParent(t, db, moveNode.ID, target.ID)

	undoMove, err := srv.enqueueFileOperationUndo(context.Background(), user.ID, move.ID)
	if err != nil {
		t.Fatal(err)
	}
	if undoMove.Type != meta.FileOperationTypeUndo || undoMove.UndoOfID == nil || *undoMove.UndoOfID != move.ID {
		t.Fatalf("unexpected undo move: %+v", undoMove)
	}
	undoMove = processUndoTestOperation(t, srv, user.ID, undoMove)
	if undoMove.Status != meta.FileOperationStatusCompleted {
		t.Fatalf("undo move status=%s", undoMove.Status)
	}
	movedBack := assertUndoTestNodeActive(t, db, user.ID, moveNode.ID)
	if movedBack.ParentID == nil || *movedBack.ParentID != source.ID || movedBack.Name != "move-me" || movedBack.Revision != 3 {
		t.Fatalf("move was not restored safely: %+v", movedBack)
	}
	move, err = srv.loadOwnedFileOperation(context.Background(), user.ID, move.ID)
	if err != nil {
		t.Fatal(err)
	}
	if move.UndoneByID == nil || *move.UndoneByID != undoMove.ID || fileOperationUndoable(move) {
		t.Fatalf("original move must retain undo lineage: %+v", move)
	}
	undoMove, err = srv.loadOwnedFileOperation(context.Background(), user.ID, undoMove.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !fileOperationRedoable(undoMove) || !toFileOperationDTO(undoMove).Redoable {
		t.Fatalf("completed undo move should be redoable: %+v", undoMove)
	}
	redoMove, err := srv.enqueueFileOperationRedo(context.Background(), user.ID, undoMove.ID)
	if err != nil {
		t.Fatal(err)
	}
	if redoMove.Type != meta.FileOperationTypeRedo || redoMove.RedoOfID == nil || *redoMove.RedoOfID != undoMove.ID {
		t.Fatalf("unexpected redo move: %+v", redoMove)
	}
	redoMove = processUndoTestOperation(t, srv, user.ID, redoMove)
	if redoMove.Status != meta.FileOperationStatusCompleted || !fileOperationUndoable(redoMove) {
		t.Fatalf("redo move should complete and be undoable: %+v", redoMove)
	}
	movedAgain := assertUndoTestNodeActive(t, db, user.ID, moveNode.ID)
	if movedAgain.ParentID == nil || *movedAgain.ParentID != target.ID || movedAgain.Name != "move-me" || movedAgain.Revision != 4 {
		t.Fatalf("move was not redone safely: %+v", movedAgain)
	}

	deleteNode := createUndoTestDirectory(t, db, user.ID, source.ID, "delete-me")
	deleteChild := createUndoTestDirectory(t, db, user.ID, deleteNode.ID, "child")
	deleteOp, err := srv.enqueueFileOperation(
		context.Background(),
		user.ID,
		meta.FileOperationTypeDelete,
		[]batchNodeRef{{ID: deleteNode.ID, Revision: deleteNode.Revision}},
		0,
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	deleteOp = processUndoTestOperation(t, srv, user.ID, deleteOp)
	if !fileOperationUndoable(deleteOp) {
		t.Fatalf("completed delete should be undoable: %+v", deleteOp)
	}
	assertBatchNodeDeleted(t, db, deleteNode.ID)
	assertBatchNodeDeleted(t, db, deleteChild.ID)

	undoDelete, err := srv.enqueueFileOperationUndo(context.Background(), user.ID, deleteOp.ID)
	if err != nil {
		t.Fatal(err)
	}
	undoDelete = processUndoTestOperation(t, srv, user.ID, undoDelete)
	if undoDelete.Status != meta.FileOperationStatusCompleted {
		t.Fatalf("undo delete status=%s", undoDelete.Status)
	}
	restoredDelete := assertUndoTestNodeActive(t, db, user.ID, deleteNode.ID)
	assertUndoTestNodeActive(t, db, user.ID, deleteChild.ID)
	if restoredDelete.Revision != 3 {
		t.Fatalf("restored delete revision=%d want 3", restoredDelete.Revision)
	}
	undoDelete, err = srv.loadOwnedFileOperation(context.Background(), user.ID, undoDelete.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !fileOperationRedoable(undoDelete) {
		t.Fatalf("completed undo delete should be redoable: %+v", undoDelete)
	}
	redoDelete, err := srv.enqueueFileOperationRedo(context.Background(), user.ID, undoDelete.ID)
	if err != nil {
		t.Fatal(err)
	}
	redoDelete = processUndoTestOperation(t, srv, user.ID, redoDelete)
	if redoDelete.Status != meta.FileOperationStatusCompleted || !fileOperationUndoable(redoDelete) {
		t.Fatalf("redo delete should complete and be undoable: %+v", redoDelete)
	}
	assertBatchNodeDeleted(t, db, deleteNode.ID)
	assertBatchNodeDeleted(t, db, deleteChild.ID)

	copySource := createUndoTestDirectory(t, db, user.ID, source.ID, "copy-me")
	createUndoTestDirectory(t, db, user.ID, copySource.ID, "nested")
	copyOp, err := srv.enqueueFileOperation(
		context.Background(),
		user.ID,
		meta.FileOperationTypeCopy,
		[]batchNodeRef{{ID: copySource.ID, Revision: copySource.Revision}},
		target.ID,
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	copyOp = processUndoTestOperation(t, srv, user.ID, copyOp)
	if !fileOperationUndoable(copyOp) {
		t.Fatalf("completed copy should be undoable: %+v", copyOp)
	}
	copyPlan, err := decodeFileOperationUndoPlan(copyOp.UndoPlanJSON)
	if err != nil || len(copyPlan.CopyRoots) != 1 || len(copyPlan.CopyRoots[0].Nodes) != 2 {
		t.Fatalf("copy undo snapshot=%+v err=%v", copyPlan, err)
	}
	copiedRootID := copyPlan.CopyRoots[0].Root.ID
	assertUndoTestNodeActive(t, db, user.ID, copiedRootID)

	undoCopy, err := srv.enqueueFileOperationUndo(context.Background(), user.ID, copyOp.ID)
	if err != nil {
		t.Fatal(err)
	}
	undoCopy = processUndoTestOperation(t, srv, user.ID, undoCopy)
	if undoCopy.Status != meta.FileOperationStatusCompleted {
		t.Fatalf("undo copy status=%s", undoCopy.Status)
	}
	assertBatchNodeDeleted(t, db, copiedRootID)
	assertUndoTestNodeActive(t, db, user.ID, copySource.ID)

	undoCopy, err = srv.loadOwnedFileOperation(context.Background(), user.ID, undoCopy.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !fileOperationRedoable(undoCopy) {
		t.Fatalf("completed undo copy should be redoable: %+v", undoCopy)
	}
	redoCopy, err := srv.enqueueFileOperationRedo(context.Background(), user.ID, undoCopy.ID)
	if err != nil {
		t.Fatal(err)
	}
	redoCopy = processUndoTestOperation(t, srv, user.ID, redoCopy)
	if redoCopy.Status != meta.FileOperationStatusCompleted || !fileOperationUndoable(redoCopy) {
		t.Fatalf("redo copy should complete and be undoable: %+v", redoCopy)
	}
	restoredCopy := assertUndoTestNodeActive(t, db, user.ID, copiedRootID)
	if restoredCopy.Revision != 3 {
		t.Fatalf("redone copy revision=%d want 3", restoredCopy.Revision)
	}
	assertUndoTestNodeActive(t, db, user.ID, copySource.ID)

	undoRedoCopy, err := srv.enqueueFileOperationUndo(context.Background(), user.ID, redoCopy.ID)
	if err != nil {
		t.Fatal(err)
	}
	undoRedoCopy = processUndoTestOperation(t, srv, user.ID, undoRedoCopy)
	if undoRedoCopy.Status != meta.FileOperationStatusCompleted || !fileOperationRedoable(undoRedoCopy) {
		t.Fatalf("undo of redo copy should complete and be redoable: %+v", undoRedoCopy)
	}
	assertBatchNodeDeleted(t, db, copiedRootID)
}

func TestFileOperationUndoCopyRejectsModifiedSubtreeAndReleasesReservation(t *testing.T) {
	db, srv, user, root := setupFileOperationUndoTestDB(t)
	source := createUndoTestDirectory(t, db, user.ID, root.ID, "source")
	target := createUndoTestDirectory(t, db, user.ID, root.ID, "target")
	copySource := createUndoTestDirectory(t, db, user.ID, source.ID, "copy-me")
	createUndoTestDirectory(t, db, user.ID, copySource.ID, "nested")

	copyOp, err := srv.enqueueFileOperation(
		context.Background(),
		user.ID,
		meta.FileOperationTypeCopy,
		[]batchNodeRef{{ID: copySource.ID, Revision: copySource.Revision}},
		target.ID,
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	copyOp = processUndoTestOperation(t, srv, user.ID, copyOp)
	plan, err := decodeFileOperationUndoPlan(copyOp.UndoPlanJSON)
	if err != nil || len(plan.CopyRoots) != 1 {
		t.Fatalf("copy undo plan: %+v err=%v", plan, err)
	}
	rootSnapshot := plan.CopyRoots[0]
	var changed fileOperationUndoNodeRef
	for _, node := range rootSnapshot.Nodes {
		if node.ID != rootSnapshot.Root.ID {
			changed = node
			break
		}
	}
	if changed.ID == 0 {
		t.Fatal("copy snapshot has no child node")
	}
	if err := db.Model(&meta.Node{}).Where("id = ?", changed.ID).
		Update("revision", gorm.Expr("revision + 1")).Error; err != nil {
		t.Fatal(err)
	}

	undo, err := srv.enqueueFileOperationUndo(context.Background(), user.ID, copyOp.ID)
	if err != nil {
		t.Fatal(err)
	}
	undo = processUndoTestOperation(t, srv, user.ID, undo)
	if undo.Status != meta.FileOperationStatusFailed || undo.FailureCode != "undo_conflict" {
		t.Fatalf("modified copied subtree must block undo: %+v", undo)
	}
	assertUndoTestNodeActive(t, db, user.ID, rootSnapshot.Root.ID)

	copyOp, err = srv.loadOwnedFileOperation(context.Background(), user.ID, copyOp.ID)
	if err != nil {
		t.Fatal(err)
	}
	if copyOp.UndoneByID != nil || !fileOperationUndoable(copyOp) {
		t.Fatalf("failed undo must release original reservation: %+v", copyOp)
	}
}

func TestFileOperationUndoRecoveryReleasesCancelledReservation(t *testing.T) {
	db, srv, user, root := setupFileOperationUndoTestDB(t)
	source := createUndoTestDirectory(t, db, user.ID, root.ID, "source")
	target := createUndoTestDirectory(t, db, user.ID, root.ID, "target")
	node := createUndoTestDirectory(t, db, user.ID, source.ID, "move-me")

	move, err := srv.enqueueFileOperation(
		context.Background(),
		user.ID,
		meta.FileOperationTypeMove,
		[]batchNodeRef{{ID: node.ID, Revision: node.Revision}},
		target.ID,
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	move = processUndoTestOperation(t, srv, user.ID, move)
	undo, err := srv.enqueueFileOperationUndo(context.Background(), user.ID, move.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.FileOperation{}).
		Where("id = ?", undo.ID).
		Update("status", meta.FileOperationStatusCancelRequested).Error; err != nil {
		t.Fatal(err)
	}

	if err := srv.recoverFileOperations(context.Background()); err != nil {
		t.Fatal(err)
	}
	undo, err = srv.loadOwnedFileOperation(context.Background(), user.ID, undo.ID)
	if err != nil {
		t.Fatal(err)
	}
	if undo.Status != meta.FileOperationStatusCancelled {
		t.Fatalf("recovered undo status=%s want cancelled", undo.Status)
	}
	move, err = srv.loadOwnedFileOperation(context.Background(), user.ID, move.ID)
	if err != nil {
		t.Fatal(err)
	}
	if move.UndoneByID != nil || !fileOperationUndoable(move) {
		t.Fatalf("cancelled recovered undo must release reservation: %+v", move)
	}
}

func TestFileOperationRedoDeleteRejectsModifiedRestoredSubtreeAndReleasesReservation(t *testing.T) {
	db, srv, user, root := setupFileOperationUndoTestDB(t)
	source := createUndoTestDirectory(t, db, user.ID, root.ID, "source")
	deleteNode := createUndoTestDirectory(t, db, user.ID, source.ID, "delete-me")
	deleteChild := createUndoTestDirectory(t, db, user.ID, deleteNode.ID, "child")

	deleteOp, err := srv.enqueueFileOperation(
		context.Background(),
		user.ID,
		meta.FileOperationTypeDelete,
		[]batchNodeRef{{ID: deleteNode.ID, Revision: deleteNode.Revision}},
		0,
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	deleteOp = processUndoTestOperation(t, srv, user.ID, deleteOp)
	undo, err := srv.enqueueFileOperationUndo(context.Background(), user.ID, deleteOp.ID)
	if err != nil {
		t.Fatal(err)
	}
	undo = processUndoTestOperation(t, srv, user.ID, undo)
	if !fileOperationRedoable(undo) {
		t.Fatalf("undo delete should be redoable: %+v", undo)
	}
	if err := db.Model(&meta.Node{}).Where("id = ?", deleteChild.ID).
		Update("revision", gorm.Expr("revision + 1")).Error; err != nil {
		t.Fatal(err)
	}

	redo, err := srv.enqueueFileOperationRedo(context.Background(), user.ID, undo.ID)
	if err != nil {
		t.Fatal(err)
	}
	redo = processUndoTestOperation(t, srv, user.ID, redo)
	if redo.Status != meta.FileOperationStatusFailed || redo.FailureCode != "redo_conflict" {
		t.Fatalf("modified restored subtree must block redo: %+v", redo)
	}
	assertUndoTestNodeActive(t, db, user.ID, deleteNode.ID)
	assertUndoTestNodeActive(t, db, user.ID, deleteChild.ID)

	undo, err = srv.loadOwnedFileOperation(context.Background(), user.ID, undo.ID)
	if err != nil {
		t.Fatal(err)
	}
	if undo.RedoneByID != nil || !fileOperationRedoable(undo) {
		t.Fatalf("failed redo must release undo reservation: %+v", undo)
	}
}

func TestFileOperationRedoRecoveryReleasesCancelledReservation(t *testing.T) {
	db, srv, user, root := setupFileOperationUndoTestDB(t)
	source := createUndoTestDirectory(t, db, user.ID, root.ID, "source")
	target := createUndoTestDirectory(t, db, user.ID, root.ID, "target")
	node := createUndoTestDirectory(t, db, user.ID, source.ID, "move-me")

	move, err := srv.enqueueFileOperation(
		context.Background(),
		user.ID,
		meta.FileOperationTypeMove,
		[]batchNodeRef{{ID: node.ID, Revision: node.Revision}},
		target.ID,
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	move = processUndoTestOperation(t, srv, user.ID, move)
	undo, err := srv.enqueueFileOperationUndo(context.Background(), user.ID, move.ID)
	if err != nil {
		t.Fatal(err)
	}
	undo = processUndoTestOperation(t, srv, user.ID, undo)
	redo, err := srv.enqueueFileOperationRedo(context.Background(), user.ID, undo.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.FileOperation{}).
		Where("id = ?", redo.ID).
		Update("status", meta.FileOperationStatusCancelRequested).Error; err != nil {
		t.Fatal(err)
	}

	if err := srv.recoverFileOperations(context.Background()); err != nil {
		t.Fatal(err)
	}
	redo, err = srv.loadOwnedFileOperation(context.Background(), user.ID, redo.ID)
	if err != nil {
		t.Fatal(err)
	}
	if redo.Status != meta.FileOperationStatusCancelled {
		t.Fatalf("recovered redo status=%s want cancelled", redo.Status)
	}
	undo, err = srv.loadOwnedFileOperation(context.Background(), user.ID, undo.ID)
	if err != nil {
		t.Fatal(err)
	}
	if undo.RedoneByID != nil || !fileOperationRedoable(undo) {
		t.Fatalf("cancelled recovered redo must release reservation: %+v", undo)
	}
}
