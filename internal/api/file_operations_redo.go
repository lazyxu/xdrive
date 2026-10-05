package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	errFileOperationRedoUnavailable = errors.New("file operation cannot be redone")
	errFileOperationAlreadyRedone   = errors.New("file operation is already redone")
)

type fileOperationRedoTree struct {
	Root     fileOperationUndoNodeRef   `json:"root"`
	ParentID uint64                     `json:"parent_id"`
	Name     string                     `json:"name"`
	Nodes    []fileOperationUndoNodeRef `json:"nodes"`
}

type fileOperationRedoMove struct {
	ID       uint64 `json:"id"`
	Revision uint64 `json:"revision"`
	ParentID uint64 `json:"parent_id"`
	Name     string `json:"name"`
}

type fileOperationRedoPlan struct {
	Kind      string                  `json:"kind"`
	CopyRoots []fileOperationRedoTree `json:"copy_roots,omitempty"`
	Moves     []fileOperationRedoMove `json:"moves,omitempty"`
	Deletes   []fileOperationRedoTree `json:"deletes,omitempty"`
}

func fileOperationRedoPlanItemCount(plan fileOperationRedoPlan) int {
	switch plan.Kind {
	case fileOperationUndoKindCopy:
		return len(plan.CopyRoots)
	case fileOperationUndoKindMove:
		return len(plan.Moves)
	case fileOperationUndoKindDelete:
		return len(plan.Deletes)
	default:
		return 0
	}
}

func encodeFileOperationRedoPlan(plan fileOperationRedoPlan) (string, error) {
	if fileOperationRedoPlanItemCount(plan) == 0 {
		return "", nil
	}
	raw, err := json.Marshal(plan)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func decodeFileOperationRedoPlan(raw string) (fileOperationRedoPlan, error) {
	var plan fileOperationRedoPlan
	if err := json.Unmarshal([]byte(raw), &plan); err != nil {
		return fileOperationRedoPlan{}, err
	}
	if fileOperationRedoPlanItemCount(plan) == 0 {
		return fileOperationRedoPlan{}, errFileOperationRedoUnavailable
	}
	return plan, nil
}

func storeFileOperationRedoPlanTx(tx *gorm.DB, operationID string, plan fileOperationRedoPlan) error {
	raw, err := encodeFileOperationRedoPlan(plan)
	if err != nil {
		return err
	}
	if raw == "" {
		return nil
	}
	return tx.Model(&meta.FileOperation{}).
		Where("id = ? AND status = ?", operationID, meta.FileOperationStatusRunning).
		Update("redo_plan_json", raw).Error
}

func fileOperationRedoable(operation meta.FileOperation) bool {
	return operation.Status == meta.FileOperationStatusCompleted &&
		operation.Type == meta.FileOperationTypeUndo &&
		operation.UndoOfID != nil &&
		operation.RedoneByID == nil &&
		strings.TrimSpace(operation.RedoPlanJSON) != ""
}

func (s *Server) enqueueFileOperationRedo(
	ctx context.Context,
	uid uint64,
	operationID string,
) (meta.FileOperation, error) {
	var redo meta.FileOperation
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var undo meta.FileOperation
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", operationID, uid).
			First(&undo).Error; err != nil {
			return err
		}
		if undo.RedoneByID != nil {
			return errFileOperationAlreadyRedone
		}
		if !fileOperationRedoable(undo) {
			return errFileOperationRedoUnavailable
		}
		plan, err := decodeFileOperationRedoPlan(undo.RedoPlanJSON)
		if err != nil {
			return err
		}

		redoID := uuid.NewString()
		undoID := undo.ID
		redo = meta.FileOperation{
			ID:         redoID,
			OwnerID:    uid,
			Type:       meta.FileOperationTypeRedo,
			Status:     meta.FileOperationStatusQueued,
			RedoOfID:   &undoID,
			ItemsJSON:  undo.RedoPlanJSON,
			TotalItems: int64(fileOperationRedoPlanItemCount(plan)),
			TotalBytes: 0,
		}
		if err := tx.Create(&redo).Error; err != nil {
			return err
		}
		result := tx.Model(&meta.FileOperation{}).
			Where("id = ? AND owner_id = ? AND redone_by_id IS NULL", undo.ID, uid).
			Update("redone_by_id", redoID)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errFileOperationAlreadyRedone
		}
		return nil
	})
	return redo, err
}

func (s *Server) redoFileOperation(c *gin.Context) {
	operation, err := s.enqueueFileOperationRedo(
		c.Request.Context(),
		userID(c),
		c.Param("id"),
	)
	if err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "file operation not found")
		case errors.Is(err, errFileOperationAlreadyRedone):
			fail(c, http.StatusConflict, "file operation is already being redone or has already been redone")
		case errors.Is(err, errFileOperationRedoUnavailable):
			fail(c, http.StatusConflict, "file operation cannot be redone")
		default:
			fail(c, http.StatusInternalServerError, "enqueue file operation redo failed")
		}
		return
	}
	c.JSON(http.StatusAccepted, toFileOperationDTO(operation))
}

func releaseFileOperationRedoReservationTx(tx *gorm.DB, operation meta.FileOperation) error {
	if operation.Type != meta.FileOperationTypeRedo || operation.RedoOfID == nil {
		return nil
	}
	return tx.Model(&meta.FileOperation{}).
		Where(
			"id = ? AND owner_id = ? AND redone_by_id = ?",
			*operation.RedoOfID,
			operation.OwnerID,
			operation.ID,
		).
		Update("redone_by_id", nil).Error
}

func releaseFileOperationLineageReservationTx(tx *gorm.DB, operation meta.FileOperation) error {
	switch operation.Type {
	case meta.FileOperationTypeUndo:
		return releaseFileOperationUndoReservationTx(tx, operation)
	case meta.FileOperationTypeRedo:
		return releaseFileOperationRedoReservationTx(tx, operation)
	default:
		return nil
	}
}

func redoConflict(index int, id uint64, message string) error {
	return &batchMutationFailure{
		Index:   index,
		ID:      id,
		Status:  http.StatusConflict,
		Code:    "redo_conflict",
		Message: message,
	}
}

func fileOperationNodeRefsWithRevision(
	nodes []fileOperationUndoNodeRef,
	nodeID uint64,
	revision uint64,
) []fileOperationUndoNodeRef {
	out := make([]fileOperationUndoNodeRef, len(nodes))
	copy(out, nodes)
	for index := range out {
		if out[index].ID == nodeID {
			out[index].Revision = revision
			break
		}
	}
	return out
}

func fileOperationNodeRefsMatch(
	current []fileOperationUndoNodeRef,
	expected []fileOperationUndoNodeRef,
) bool {
	if len(current) != len(expected) {
		return false
	}
	revisions := make(map[uint64]uint64, len(expected))
	for _, node := range expected {
		revisions[node.ID] = node.Revision
	}
	if len(revisions) != len(expected) {
		return false
	}
	for _, node := range current {
		revision, ok := revisions[node.ID]
		if !ok || revision != node.Revision {
			return false
		}
	}
	return true
}

func fileOperationTrashNodeRefsTx(
	tx *gorm.DB,
	uid uint64,
	rootID uint64,
) ([]fileOperationUndoNodeRef, error) {
	var nodes []meta.Node
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Select("id", "revision").
		Where(
			"owner_id = ? AND trash_root_id = ? AND deleted_at IS NOT NULL",
			uid,
			rootID,
		).
		Order("id ASC").
		Find(&nodes).Error; err != nil {
		return nil, err
	}
	refs := make([]fileOperationUndoNodeRef, 0, len(nodes))
	for _, node := range nodes {
		refs = append(refs, fileOperationUndoNodeRef{ID: node.ID, Revision: node.Revision})
	}
	return refs, nil
}

func fileOperationActiveNodeRefsTx(
	tx *gorm.DB,
	uid uint64,
	rootID uint64,
) ([]fileOperationUndoNodeRef, error) {
	ids, err := activeSubtreeIDsDB(tx, uid, rootID)
	if err != nil {
		return nil, err
	}
	var nodes []meta.Node
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Select("id", "revision").
		Where("id IN ? AND owner_id = ? AND deleted_at IS NULL", ids, uid).
		Order("id ASC").
		Find(&nodes).Error; err != nil {
		return nil, err
	}
	refs := make([]fileOperationUndoNodeRef, 0, len(nodes))
	for _, node := range nodes {
		refs = append(refs, fileOperationUndoNodeRef{ID: node.ID, Revision: node.Revision})
	}
	return refs, nil
}

func fileOperationNodeRefIDs(nodes []fileOperationUndoNodeRef) []uint64 {
	ids := make([]uint64, 0, len(nodes))
	for _, node := range nodes {
		ids = append(ids, node.ID)
	}
	return ids
}

func (s *Server) executeQueuedRedo(
	ctx context.Context,
	operation meta.FileOperation,
) error {
	plan, err := decodeFileOperationRedoPlan(operation.ItemsJSON)
	if err != nil {
		return err
	}
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		undoPlan := fileOperationUndoPlan{Kind: plan.Kind}
		switch plan.Kind {
		case fileOperationUndoKindCopy:
			if err := s.executeRedoCopyTx(ctx, tx, operation, plan.CopyRoots, &undoPlan); err != nil {
				return err
			}
		case fileOperationUndoKindMove:
			if err := s.executeRedoMoveTx(ctx, tx, operation, plan.Moves, &undoPlan); err != nil {
				return err
			}
		case fileOperationUndoKindDelete:
			if err := s.executeRedoDeleteTx(ctx, tx, operation, plan.Deletes, &undoPlan); err != nil {
				return err
			}
		default:
			return errFileOperationRedoUnavailable
		}
		if err := storeFileOperationUndoPlanTx(tx, operation.ID, undoPlan); err != nil {
			return err
		}
		return s.completeFileOperationTx(tx, operation)
	})
}

func (s *Server) executeRedoCopyTx(
	ctx context.Context,
	tx *gorm.DB,
	operation meta.FileOperation,
	roots []fileOperationRedoTree,
	undoPlan *fileOperationUndoPlan,
) error {
	uid := operation.OwnerID
	for index, snapshot := range roots {
		if err := s.beginFileOperationItem(ctx, operation.ID, snapshot.Name); err != nil {
			return err
		}
		var root meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"id = ? AND owner_id = ? AND deleted_at IS NOT NULL AND trash_root_id = ?",
				snapshot.Root.ID,
				uid,
				snapshot.Root.ID,
			).
			First(&root).Error; err != nil {
			return redoConflict(index, snapshot.Root.ID, "copied item is no longer available in the trash")
		}
		if root.Revision != snapshot.Root.Revision ||
			root.ParentID == nil ||
			*root.ParentID != snapshot.ParentID ||
			root.Name != snapshot.Name {
			return redoConflict(index, root.ID, "copied item changed after undo")
		}
		if _, err := batchTargetDirectoryTx(tx, uid, snapshot.ParentID); err != nil {
			return redoConflict(index, root.ID, "copy target folder is unavailable")
		}
		exists, err := batchNameExistsTx(tx, uid, snapshot.ParentID, snapshot.Name, root.ID)
		if err != nil {
			return err
		}
		if exists {
			return redoConflict(index, root.ID, "copy target now contains an item with the same name")
		}

		currentNodes, err := fileOperationTrashNodeRefsTx(tx, uid, root.ID)
		if err != nil {
			return err
		}
		if !fileOperationNodeRefsMatch(currentNodes, snapshot.Nodes) {
			return redoConflict(index, root.ID, "copied item subtree changed after undo")
		}

		if err := tx.Model(&meta.Node{}).
			Where("owner_id = ? AND trash_root_id = ?", uid, root.ID).
			Updates(map[string]any{"deleted_at": nil, "trash_root_id": nil}).Error; err != nil {
			return err
		}
		now := time.Now()
		result := tx.Model(&meta.Node{}).
			Where("id = ? AND owner_id = ? AND revision = ?", root.ID, uid, snapshot.Root.Revision).
			Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return redoConflict(index, root.ID, "copied item changed after undo")
		}

		if undoPlan != nil {
			undoRevision := snapshot.Root.Revision + 1
			undoPlan.CopyRoots = append(undoPlan.CopyRoots, fileOperationUndoCopyRoot{
				Root:  fileOperationUndoNodeRef{ID: root.ID, Revision: undoRevision},
				Name:  root.Name,
				Nodes: fileOperationNodeRefsWithRevision(snapshot.Nodes, root.ID, undoRevision),
			})
		}
		if err := s.recordFileOperationProgress(ctx, operation.ID, 0); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) executeRedoMoveTx(
	ctx context.Context,
	tx *gorm.DB,
	operation meta.FileOperation,
	moves []fileOperationRedoMove,
	undoPlan *fileOperationUndoPlan,
) error {
	uid := operation.OwnerID
	for index, snapshot := range moves {
		if err := s.beginFileOperationItem(ctx, operation.ID, snapshot.Name); err != nil {
			return err
		}
		var node meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ? AND deleted_at IS NULL", snapshot.ID, uid).
			First(&node).Error; err != nil {
			return redoConflict(index, snapshot.ID, "moved item is no longer available")
		}
		if node.Revision != snapshot.Revision {
			return redoConflict(index, node.ID, "moved item changed after undo")
		}
		if node.ParentID == nil {
			return redoConflict(index, node.ID, "moved item has no current parent")
		}
		currentParentID := *node.ParentID
		currentName := node.Name

		if _, err := batchTargetDirectoryTx(tx, uid, snapshot.ParentID); err != nil {
			return redoConflict(index, node.ID, "move target folder is unavailable")
		}
		if node.Type == meta.NodeTypeDir {
			inside, err := batchTargetInsideNode(tx, uid, snapshot.ParentID, node.ID)
			if err != nil {
				return err
			}
			if inside {
				return redoConflict(index, node.ID, "move target is now inside the moved folder")
			}
		}
		protected, err := yikeManagedTargetInSubtreeDB(ctx, tx, uid, node.ID)
		if err != nil {
			return err
		}
		if protected {
			return redoConflict(index, node.ID, "managed source target cannot be moved")
		}
		exists, err := batchNameExistsTx(tx, uid, snapshot.ParentID, snapshot.Name, node.ID)
		if err != nil {
			return err
		}
		if exists {
			return redoConflict(index, node.ID, "move target now contains an item with the same name")
		}

		now := time.Now()
		result := tx.Model(&meta.Node{}).
			Where("id = ? AND owner_id = ? AND revision = ? AND deleted_at IS NULL", node.ID, uid, snapshot.Revision).
			Updates(map[string]any{
				"parent_id":  snapshot.ParentID,
				"name":       snapshot.Name,
				"revision":   gorm.Expr("revision + 1"),
				"updated_at": now,
			})
		if result.Error != nil {
			if isDuplicate(result.Error) {
				return redoConflict(index, node.ID, "move target now contains an item with the same name")
			}
			return result.Error
		}
		if result.RowsAffected != 1 {
			return redoConflict(index, node.ID, "moved item changed after undo")
		}

		if undoPlan != nil {
			undoPlan.Moves = append(undoPlan.Moves, fileOperationUndoMove{
				ID:       node.ID,
				Revision: snapshot.Revision + 1,
				ParentID: currentParentID,
				Name:     currentName,
			})
		}
		if err := s.recordFileOperationProgress(ctx, operation.ID, 0); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) executeRedoDeleteTx(
	ctx context.Context,
	tx *gorm.DB,
	operation meta.FileOperation,
	deletes []fileOperationRedoTree,
	undoPlan *fileOperationUndoPlan,
) error {
	uid := operation.OwnerID
	for index, snapshot := range deletes {
		if err := s.beginFileOperationItem(ctx, operation.ID, snapshot.Name); err != nil {
			return err
		}
		var root meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ? AND deleted_at IS NULL", snapshot.Root.ID, uid).
			First(&root).Error; err != nil {
			return redoConflict(index, snapshot.Root.ID, "restored item is no longer available")
		}
		if root.Revision != snapshot.Root.Revision ||
			root.ParentID == nil ||
			*root.ParentID != snapshot.ParentID ||
			root.Name != snapshot.Name {
			return redoConflict(index, root.ID, "restored item changed after undo")
		}

		currentNodes, err := fileOperationActiveNodeRefsTx(tx, uid, root.ID)
		if err != nil {
			return err
		}
		if !fileOperationNodeRefsMatch(currentNodes, snapshot.Nodes) {
			return redoConflict(index, root.ID, "restored item subtree changed after undo")
		}
		ids := fileOperationNodeRefIDs(currentNodes)
		protected, err := yikeManagedTargetInIDsDB(ctx, tx, uid, ids)
		if err != nil {
			return err
		}
		if protected {
			return redoConflict(index, root.ID, "managed source target cannot be deleted")
		}

		now := time.Now()
		if err := tx.Model(&meta.Share{}).
			Where("node_id IN ? AND owner_id = ? AND revoked_at IS NULL", ids, uid).
			Update("revoked_at", &now).Error; err != nil {
			return err
		}
		if err := tx.Model(&meta.Node{}).
			Where("id IN ? AND owner_id = ? AND deleted_at IS NULL", ids, uid).
			Updates(map[string]any{"deleted_at": &now, "trash_root_id": root.ID}).Error; err != nil {
			return err
		}
		result := tx.Model(&meta.Node{}).
			Where("id = ? AND owner_id = ? AND revision = ?", root.ID, uid, snapshot.Root.Revision).
			Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return redoConflict(index, root.ID, "restored item changed after undo")
		}

		if undoPlan != nil {
			undoPlan.Deletes = append(undoPlan.Deletes, fileOperationUndoDelete{
				ID:       root.ID,
				Revision: snapshot.Root.Revision + 1,
				Name:     root.Name,
			})
		}
		if err := s.recordFileOperationProgress(ctx, operation.ID, 0); err != nil {
			return err
		}
	}
	return nil
}
