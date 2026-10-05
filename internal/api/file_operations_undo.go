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
	errFileOperationUndoUnavailable = errors.New("file operation cannot be undone")
	errFileOperationAlreadyUndone   = errors.New("file operation is already undone")
)

const (
	fileOperationUndoKindCopy   = "copy"
	fileOperationUndoKindMove   = "move"
	fileOperationUndoKindDelete = "delete"
)

type fileOperationUndoNodeRef struct {
	ID       uint64 `json:"id"`
	Revision uint64 `json:"revision"`
}

type fileOperationUndoCopyRoot struct {
	Root  fileOperationUndoNodeRef   `json:"root"`
	Name  string                     `json:"name"`
	Nodes []fileOperationUndoNodeRef `json:"nodes"`
}

type fileOperationUndoMove struct {
	ID       uint64 `json:"id"`
	Revision uint64 `json:"revision"`
	ParentID uint64 `json:"parent_id"`
	Name     string `json:"name"`
}

type fileOperationUndoDelete struct {
	ID       uint64 `json:"id"`
	Revision uint64 `json:"revision"`
	Name     string `json:"name"`
}

type fileOperationUndoPlan struct {
	Kind      string                      `json:"kind"`
	CopyRoots []fileOperationUndoCopyRoot `json:"copy_roots,omitempty"`
	Moves     []fileOperationUndoMove     `json:"moves,omitempty"`
	Deletes   []fileOperationUndoDelete   `json:"deletes,omitempty"`
}

func fileOperationUndoPlanItemCount(plan fileOperationUndoPlan) int {
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

func encodeFileOperationUndoPlan(plan fileOperationUndoPlan) (string, error) {
	if fileOperationUndoPlanItemCount(plan) == 0 {
		return "", nil
	}
	raw, err := json.Marshal(plan)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func decodeFileOperationUndoPlan(raw string) (fileOperationUndoPlan, error) {
	var plan fileOperationUndoPlan
	if err := json.Unmarshal([]byte(raw), &plan); err != nil {
		return fileOperationUndoPlan{}, err
	}
	if fileOperationUndoPlanItemCount(plan) == 0 {
		return fileOperationUndoPlan{}, errFileOperationUndoUnavailable
	}
	return plan, nil
}

func storeFileOperationUndoPlanTx(tx *gorm.DB, operationID string, plan fileOperationUndoPlan) error {
	raw, err := encodeFileOperationUndoPlan(plan)
	if err != nil {
		return err
	}
	if raw == "" {
		return nil
	}
	return tx.Model(&meta.FileOperation{}).
		Where("id = ? AND status = ?", operationID, meta.FileOperationStatusRunning).
		Update("undo_plan_json", raw).Error
}

func fileOperationUndoable(operation meta.FileOperation) bool {
	return operation.Status == meta.FileOperationStatusCompleted &&
		operation.Type != meta.FileOperationTypeUndo &&
		operation.UndoOfID == nil &&
		operation.UndoneByID == nil &&
		strings.TrimSpace(operation.UndoPlanJSON) != ""
}

func (s *Server) enqueueFileOperationUndo(
	ctx context.Context,
	uid uint64,
	operationID string,
) (meta.FileOperation, error) {
	var undo meta.FileOperation
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var original meta.FileOperation
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", operationID, uid).
			First(&original).Error; err != nil {
			return err
		}
		if original.UndoneByID != nil {
			return errFileOperationAlreadyUndone
		}
		if !fileOperationUndoable(original) {
			return errFileOperationUndoUnavailable
		}
		plan, err := decodeFileOperationUndoPlan(original.UndoPlanJSON)
		if err != nil {
			return err
		}

		undoID := uuid.NewString()
		originalID := original.ID
		undo = meta.FileOperation{
			ID:         undoID,
			OwnerID:    uid,
			Type:       meta.FileOperationTypeUndo,
			Status:     meta.FileOperationStatusQueued,
			UndoOfID:   &originalID,
			ItemsJSON:  original.UndoPlanJSON,
			TotalItems: int64(fileOperationUndoPlanItemCount(plan)),
			TotalBytes: 0,
		}
		if err := tx.Create(&undo).Error; err != nil {
			return err
		}
		result := tx.Model(&meta.FileOperation{}).
			Where("id = ? AND owner_id = ? AND undone_by_id IS NULL", original.ID, uid).
			Update("undone_by_id", undoID)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errFileOperationAlreadyUndone
		}
		return nil
	})
	return undo, err
}

func (s *Server) undoFileOperation(c *gin.Context) {
	operation, err := s.enqueueFileOperationUndo(
		c.Request.Context(),
		userID(c),
		c.Param("id"),
	)
	if err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "file operation not found")
		case errors.Is(err, errFileOperationAlreadyUndone):
			fail(c, http.StatusConflict, "file operation is already being undone or has already been undone")
		case errors.Is(err, errFileOperationUndoUnavailable):
			fail(c, http.StatusConflict, "file operation cannot be undone")
		default:
			fail(c, http.StatusInternalServerError, "enqueue file operation undo failed")
		}
		return
	}
	c.JSON(http.StatusAccepted, toFileOperationDTO(operation))
}

func releaseFileOperationUndoReservationTx(tx *gorm.DB, operation meta.FileOperation) error {
	if operation.Type != meta.FileOperationTypeUndo || operation.UndoOfID == nil {
		return nil
	}
	return tx.Model(&meta.FileOperation{}).
		Where(
			"id = ? AND owner_id = ? AND undone_by_id = ?",
			*operation.UndoOfID,
			operation.OwnerID,
			operation.ID,
		).
		Update("undone_by_id", nil).Error
}

func undoConflict(index int, id uint64, message string) error {
	return &batchMutationFailure{
		Index:   index,
		ID:      id,
		Status:  http.StatusConflict,
		Code:    "undo_conflict",
		Message: message,
	}
}

func (s *Server) executeQueuedUndo(
	ctx context.Context,
	operation meta.FileOperation,
) error {
	plan, err := decodeFileOperationUndoPlan(operation.ItemsJSON)
	if err != nil {
		return err
	}
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		redoPlan := fileOperationRedoPlan{Kind: plan.Kind}
		switch plan.Kind {
		case fileOperationUndoKindCopy:
			if err := s.executeUndoCopyTx(ctx, tx, operation, plan.CopyRoots, &redoPlan); err != nil {
				return err
			}
		case fileOperationUndoKindMove:
			if err := s.executeUndoMoveTx(ctx, tx, operation, plan.Moves, &redoPlan); err != nil {
				return err
			}
		case fileOperationUndoKindDelete:
			if err := s.executeUndoDeleteTx(ctx, tx, operation, plan.Deletes, &redoPlan); err != nil {
				return err
			}
		default:
			return errFileOperationUndoUnavailable
		}
		if err := storeFileOperationRedoPlanTx(tx, operation.ID, redoPlan); err != nil {
			return err
		}
		return s.completeFileOperationTx(tx, operation)
	})
}

func (s *Server) executeUndoCopyTx(
	ctx context.Context,
	tx *gorm.DB,
	operation meta.FileOperation,
	roots []fileOperationUndoCopyRoot,
	redoPlan *fileOperationRedoPlan,
) error {
	uid := operation.OwnerID
	for index, snapshot := range roots {
		if err := s.beginFileOperationItem(ctx, operation.ID, snapshot.Name); err != nil {
			return err
		}
		var root meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ? AND deleted_at IS NULL", snapshot.Root.ID, uid).
			First(&root).Error; err != nil {
			return undoConflict(index, snapshot.Root.ID, "copied item is no longer available")
		}
		if root.Revision != snapshot.Root.Revision {
			return undoConflict(index, root.ID, "copied item changed after the copy operation")
		}
		if root.ParentID == nil {
			return undoConflict(index, root.ID, "copied item has no restorable parent")
		}
		parentID := *root.ParentID

		ids, err := activeSubtreeIDsDB(tx, uid, root.ID)
		if err != nil {
			return err
		}
		if len(ids) != len(snapshot.Nodes) {
			return undoConflict(index, root.ID, "copied folder contents changed after the copy operation")
		}
		expected := make(map[uint64]uint64, len(snapshot.Nodes))
		for _, node := range snapshot.Nodes {
			expected[node.ID] = node.Revision
		}
		var current []meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Select("id", "revision").
			Where("id IN ? AND owner_id = ? AND deleted_at IS NULL", ids, uid).
			Find(&current).Error; err != nil {
			return err
		}
		if len(current) != len(expected) {
			return undoConflict(index, root.ID, "copied folder contents changed after the copy operation")
		}
		for _, node := range current {
			revision, ok := expected[node.ID]
			if !ok || revision != node.Revision {
				return undoConflict(index, node.ID, "copied item changed after the copy operation")
			}
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
			return undoConflict(index, root.ID, "copied item changed after the copy operation")
		}
		if redoPlan != nil {
			redoRevision := snapshot.Root.Revision + 1
			redoPlan.CopyRoots = append(redoPlan.CopyRoots, fileOperationRedoTree{
				Root:     fileOperationUndoNodeRef{ID: root.ID, Revision: redoRevision},
				ParentID: parentID,
				Name:     root.Name,
				Nodes:    fileOperationNodeRefsWithRevision(snapshot.Nodes, root.ID, redoRevision),
			})
		}
		if err := s.recordFileOperationProgress(ctx, operation.ID, 0); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) executeUndoMoveTx(
	ctx context.Context,
	tx *gorm.DB,
	operation meta.FileOperation,
	moves []fileOperationUndoMove,
	redoPlan *fileOperationRedoPlan,
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
			return undoConflict(index, snapshot.ID, "moved item is no longer available")
		}
		if node.Revision != snapshot.Revision {
			return undoConflict(index, node.ID, "moved item changed after the move operation")
		}
		if node.ParentID == nil {
			return undoConflict(index, node.ID, "moved item has no redo target parent")
		}
		redoParentID := *node.ParentID
		redoName := node.Name
		if _, err := batchTargetDirectoryTx(tx, uid, snapshot.ParentID); err != nil {
			return undoConflict(index, node.ID, "original parent folder is unavailable")
		}
		if node.Type == meta.NodeTypeDir {
			inside, err := batchTargetInsideNode(tx, uid, snapshot.ParentID, node.ID)
			if err != nil {
				return err
			}
			if inside {
				return undoConflict(index, node.ID, "original parent is now inside the moved folder")
			}
		}
		exists, err := batchNameExistsTx(tx, uid, snapshot.ParentID, snapshot.Name, node.ID)
		if err != nil {
			return err
		}
		if exists {
			return undoConflict(index, node.ID, "original location now contains an item with the same name")
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
				return undoConflict(index, node.ID, "original location now contains an item with the same name")
			}
			return result.Error
		}
		if result.RowsAffected != 1 {
			return undoConflict(index, node.ID, "moved item changed after the move operation")
		}
		if redoPlan != nil {
			redoPlan.Moves = append(redoPlan.Moves, fileOperationRedoMove{
				ID:       node.ID,
				Revision: snapshot.Revision + 1,
				ParentID: redoParentID,
				Name:     redoName,
			})
		}
		if err := s.recordFileOperationProgress(ctx, operation.ID, 0); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) executeUndoDeleteTx(
	ctx context.Context,
	tx *gorm.DB,
	operation meta.FileOperation,
	deletes []fileOperationUndoDelete,
	redoPlan *fileOperationRedoPlan,
) error {
	uid := operation.OwnerID
	for index, snapshot := range deletes {
		if err := s.beginFileOperationItem(ctx, operation.ID, snapshot.Name); err != nil {
			return err
		}
		var root meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"id = ? AND owner_id = ? AND deleted_at IS NOT NULL AND trash_root_id = ?",
				snapshot.ID,
				uid,
				snapshot.ID,
			).
			First(&root).Error; err != nil {
			return undoConflict(index, snapshot.ID, "deleted item is no longer available in the trash")
		}
		if root.Revision != snapshot.Revision {
			return undoConflict(index, root.ID, "deleted item changed after the delete operation")
		}
		if root.ParentID == nil {
			return undoConflict(index, root.ID, "deleted item has no restorable parent")
		}
		var parent meta.Node
		if err := tx.Where(
			"id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			*root.ParentID,
			uid,
			meta.NodeTypeDir,
		).First(&parent).Error; err != nil {
			return undoConflict(index, root.ID, "original parent folder is unavailable")
		}
		var count int64
		if err := tx.Model(&meta.Node{}).
			Where(
				"owner_id = ? AND parent_id = ? AND deleted_at IS NULL AND lower(name) = lower(?)",
				uid,
				*root.ParentID,
				root.Name,
			).
			Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return undoConflict(index, root.ID, "original location now contains an item with the same name")
		}

		trashNodes, err := fileOperationTrashNodeRefsTx(tx, uid, root.ID)
		if err != nil {
			return err
		}
		if len(trashNodes) == 0 {
			return undoConflict(index, root.ID, "deleted item subtree is no longer available")
		}

		if err := tx.Model(&meta.Node{}).
			Where("owner_id = ? AND trash_root_id = ?", uid, root.ID).
			Updates(map[string]any{"deleted_at": nil, "trash_root_id": nil}).Error; err != nil {
			return err
		}
		now := time.Now()
		result := tx.Model(&meta.Node{}).
			Where("id = ? AND owner_id = ? AND revision = ?", root.ID, uid, snapshot.Revision).
			Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return undoConflict(index, root.ID, "deleted item changed after the delete operation")
		}
		if redoPlan != nil {
			redoRevision := snapshot.Revision + 1
			redoPlan.Deletes = append(redoPlan.Deletes, fileOperationRedoTree{
				Root:     fileOperationUndoNodeRef{ID: root.ID, Revision: redoRevision},
				ParentID: *root.ParentID,
				Name:     root.Name,
				Nodes:    fileOperationNodeRefsWithRevision(trashNodes, root.ID, redoRevision),
			})
		}
		if err := s.recordFileOperationProgress(ctx, operation.ID, 0); err != nil {
			return err
		}
	}
	return nil
}
