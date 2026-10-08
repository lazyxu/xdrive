package api

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const maxNodeBatchItems = 200

type batchNodeRef struct {
	ID       uint64 `json:"id"`
	Revision uint64 `json:"revision"`
}

type batchTargetRequest struct {
	Items    []batchNodeRef `json:"items"`
	ParentID uint64         `json:"parent_id"`
}

type batchDeleteRequest struct {
	Items []batchNodeRef `json:"items"`
}

type batchNodesResponse struct {
	OperationID string    `json:"operation_id"`
	Items       []nodeDTO `json:"items,omitempty"`
	DeletedIDs  []uint64  `json:"deleted_ids,omitempty"`
}

type batchMutationFailure struct {
	Index           int
	ID              uint64
	Status          int
	Code            string
	Message         string
	CurrentRevision uint64
}

func (e *batchMutationFailure) Error() string {
	return e.Message
}

func validateBatchNodeRefs(items []batchNodeRef) error {
	if len(items) == 0 {
		return &batchMutationFailure{Status: http.StatusBadRequest, Code: "batch_empty", Message: "items are required"}
	}
	if len(items) > maxNodeBatchItems {
		return &batchMutationFailure{Status: http.StatusBadRequest, Code: "batch_too_large", Message: "batch may contain at most 200 items"}
	}
	seen := make(map[uint64]struct{}, len(items))
	for index, item := range items {
		if item.ID == 0 || item.Revision == 0 {
			return &batchMutationFailure{Index: index, ID: item.ID, Status: http.StatusBadRequest, Code: "invalid_batch_item", Message: "each item requires id and revision"}
		}
		if _, exists := seen[item.ID]; exists {
			return &batchMutationFailure{Index: index, ID: item.ID, Status: http.StatusBadRequest, Code: "duplicate_batch_item", Message: "duplicate node id in batch"}
		}
		seen[item.ID] = struct{}{}
	}
	return nil
}

func writeBatchMutationFailure(c *gin.Context, operation string, err error) {
	var failure *batchMutationFailure
	if !errors.As(err, &failure) {
		fail(c, http.StatusInternalServerError, operation+" batch failed")
		return
	}
	body := gin.H{
		"error":     failure.Code,
		"message":   failure.Message,
		"operation": operation,
	}
	if failure.ID != 0 {
		body["item_id"] = failure.ID
		body["item_index"] = failure.Index
	}
	if failure.CurrentRevision != 0 {
		body["current_revision"] = failure.CurrentRevision
	}
	c.AbortWithStatusJSON(failure.Status, body)
}

func batchLoadNodeTx(tx *gorm.DB, uid uint64, ref batchNodeRef, index int, preload bool) (meta.Node, error) {
	var node meta.Node
	query := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND owner_id = ? AND deleted_at IS NULL", ref.ID, uid)
	if preload {
		query = query.Preload("File")
	}
	if err := query.First(&node).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return meta.Node{}, &batchMutationFailure{Index: index, ID: ref.ID, Status: http.StatusNotFound, Code: "node_not_found", Message: "node not found"}
		}
		return meta.Node{}, err
	}
	if node.ParentID == nil {
		return meta.Node{}, &batchMutationFailure{Index: index, ID: ref.ID, Status: http.StatusBadRequest, Code: "root_mutation", Message: "root cannot be changed by batch operation"}
	}
	if node.Revision != ref.Revision {
		return meta.Node{}, &batchMutationFailure{
			Index: index, ID: ref.ID, Status: http.StatusConflict, Code: "revision_conflict",
			Message: "node revision changed", CurrentRevision: node.Revision,
		}
	}
	return node, nil
}

func batchLoadNodesTx(
	tx *gorm.DB,
	uid uint64,
	refs []batchNodeRef,
	preload bool,
) ([]meta.Node, error) {
	if len(refs) == 0 {
		return nil, nil
	}
	ids := make([]uint64, 0, len(refs))
	for _, ref := range refs {
		ids = append(ids, ref.ID)
	}

	var loaded []meta.Node
	query := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id IN ? AND owner_id = ? AND deleted_at IS NULL", ids, uid).
		Order("id ASC")
	if preload {
		query = query.Preload("File")
	}
	if err := query.Find(&loaded).Error; err != nil {
		return nil, err
	}

	byID := make(map[uint64]meta.Node, len(loaded))
	for _, node := range loaded {
		byID[node.ID] = node
	}
	out := make([]meta.Node, 0, len(refs))
	for index, ref := range refs {
		node, ok := byID[ref.ID]
		if !ok {
			return nil, &batchMutationFailure{
				Index: index, ID: ref.ID, Status: http.StatusNotFound,
				Code: "node_not_found", Message: "node not found",
			}
		}
		if node.ParentID == nil {
			return nil, &batchMutationFailure{
				Index: index, ID: ref.ID, Status: http.StatusBadRequest,
				Code: "root_mutation", Message: "root cannot be changed by batch operation",
			}
		}
		if node.Revision != ref.Revision {
			return nil, &batchMutationFailure{
				Index: index, ID: ref.ID, Status: http.StatusConflict,
				Code: "revision_conflict", Message: "node revision changed",
				CurrentRevision: node.Revision,
			}
		}
		out = append(out, node)
	}
	return out, nil
}

type batchAncestorCoverageRow struct {
	OriginID uint64 `gorm:"column:origin_id"`
	Covered  bool   `gorm:"column:covered"`
}

func batchAncestorCoverageTx(tx *gorm.DB, uid uint64, items []batchNodeRef) (map[uint64]bool, error) {
	coverage := make(map[uint64]bool, len(items))
	if len(items) == 0 {
		return coverage, nil
	}

	ids := make([]uint64, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}

	var rows []batchAncestorCoverageRow
	if err := tx.Raw(`WITH RECURSIVE ancestry AS (
SELECT id AS origin_id, parent_id
FROM xd_nodes
WHERE id IN ? AND owner_id = ? AND deleted_at IS NULL
UNION
SELECT ancestry.origin_id, parent.parent_id
FROM ancestry
JOIN xd_nodes AS parent
  ON parent.id = ancestry.parent_id
 AND parent.owner_id = ?
 AND parent.deleted_at IS NULL
WHERE ancestry.parent_id IS NOT NULL
)
SELECT origin_id,
       COALESCE(BOOL_OR(parent_id IN ?), FALSE) AS covered
FROM ancestry
GROUP BY origin_id`, ids, uid, uid, ids).Scan(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		coverage[row.OriginID] = row.Covered
	}
	for index, item := range items {
		if _, ok := coverage[item.ID]; !ok {
			return nil, &batchMutationFailure{
				Index: index, ID: item.ID, Status: http.StatusNotFound,
				Code: "node_not_found", Message: "node not found",
			}
		}
	}
	return coverage, nil
}

func batchSelectionHasAncestor(tx *gorm.DB, uid uint64, items []batchNodeRef) (bool, error) {
	coverage, err := batchAncestorCoverageTx(tx, uid, items)
	if err != nil {
		return false, err
	}
	for _, item := range items {
		if coverage[item.ID] {
			return true, nil
		}
	}
	return false, nil
}

func topLevelBatchDeleteRefs(tx *gorm.DB, uid uint64, items []batchNodeRef) ([]batchNodeRef, error) {
	coverage, err := batchAncestorCoverageTx(tx, uid, items)
	if err != nil {
		return nil, err
	}
	out := make([]batchNodeRef, 0, len(items))
	for _, item := range items {
		if !coverage[item.ID] {
			out = append(out, item)
		}
	}
	return out, nil
}

func batchTargetDirectoryTx(tx *gorm.DB, uid, parentID uint64) (meta.Node, error) {
	if parentID == 0 {
		return meta.Node{}, &batchMutationFailure{Status: http.StatusBadRequest, Code: "invalid_target", Message: "parent_id is required"}
	}
	var target meta.Node
	if err := tx.Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL", parentID, uid, meta.NodeTypeDir).
		First(&target).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return meta.Node{}, &batchMutationFailure{Status: http.StatusBadRequest, Code: "invalid_target", Message: "target directory not found"}
		}
		return meta.Node{}, err
	}
	return target, nil
}

func batchTargetInsideNode(tx *gorm.DB, uid, targetID, nodeID uint64) (bool, error) {
	var inside bool
	row := tx.Raw(`
WITH RECURSIVE ancestors AS (
	SELECT id, parent_id
	FROM xd_nodes
	WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
	UNION ALL
	SELECT parent.id, parent.parent_id
	FROM xd_nodes AS parent
	JOIN ancestors AS child ON child.parent_id = parent.id
	WHERE parent.owner_id = ? AND parent.deleted_at IS NULL
)
SELECT EXISTS (
	SELECT 1
	FROM ancestors
	WHERE id = ?
)`, targetID, uid, uid, nodeID).Row()
	if err := row.Scan(&inside); err != nil {
		return false, err
	}
	return inside, nil
}

func batchNameExistsTx(tx *gorm.DB, uid, parentID uint64, name string, except uint64) (bool, error) {
	var count int64
	query := tx.Model(&meta.Node{}).
		Where("owner_id = ? AND parent_id = ? AND deleted_at IS NULL AND lower(name) = lower(?)", uid, parentID, name)
	if except != 0 {
		query = query.Where("id <> ?", except)
	}
	if err := query.Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func (s *Server) batchCopyNodes(c *gin.Context) {
	var req batchTargetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	if err := validateBatchNodeRefs(req.Items); err != nil {
		writeBatchMutationFailure(c, "copy", err)
		return
	}
	uid := userID(c)
	copied := make([]meta.Node, 0, len(req.Items))
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		if _, err := batchTargetDirectoryTx(tx, uid, req.ParentID); err != nil {
			return err
		}
		nested, err := batchSelectionHasAncestor(tx, uid, req.Items)
		if err != nil {
			return err
		}
		if nested {
			return &batchMutationFailure{Status: http.StatusBadRequest, Code: "nested_batch_selection", Message: "copy selection cannot contain both a directory and its descendant"}
		}
		for index, ref := range req.Items {
			source, err := batchLoadNodeTx(tx, uid, ref, index, true)
			if err != nil {
				return err
			}
			if source.Type == meta.NodeTypeDir {
				inside, err := batchTargetInsideNode(tx, uid, req.ParentID, source.ID)
				if err != nil {
					return err
				}
				if inside {
					return &batchMutationFailure{Index: index, ID: ref.ID, Status: http.StatusBadRequest, Code: "invalid_target", Message: "cannot copy a directory into itself or its descendant"}
				}
			}
			name, err := copyDestinationNameTx(tx, uid, req.ParentID, source.Name, source.Type, nil)
			if err != nil {
				return &batchMutationFailure{Index: index, ID: ref.ID, Status: http.StatusConflict, Code: "name_conflict", Message: "cannot allocate destination name"}
			}
			node, err := s.copyNodeTx(tx, uid, source, req.ParentID, name)
			if err != nil {
				return err
			}
			copied = append(copied, node)
		}
		return nil
	})
	if err != nil {
		writeBatchMutationFailure(c, "copy", err)
		return
	}
	items := make([]nodeDTO, 0, len(copied))
	for _, node := range copied {
		_ = s.DB.Preload("File").First(&node, node.ID).Error
		items = append(items, toNodeDTO(node))
	}
	c.JSON(http.StatusCreated, batchNodesResponse{OperationID: uuid.NewString(), Items: items})
}

func (s *Server) batchMoveNodes(c *gin.Context) {
	var req batchTargetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	if err := validateBatchNodeRefs(req.Items); err != nil {
		writeBatchMutationFailure(c, "move", err)
		return
	}
	uid := userID(c)
	moved := make([]meta.Node, 0, len(req.Items))
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		if _, err := batchTargetDirectoryTx(tx, uid, req.ParentID); err != nil {
			return err
		}
		nested, err := batchSelectionHasAncestor(tx, uid, req.Items)
		if err != nil {
			return err
		}
		if nested {
			return &batchMutationFailure{Status: http.StatusBadRequest, Code: "nested_batch_selection", Message: "move selection cannot contain both a directory and its descendant"}
		}
		for index, ref := range req.Items {
			node, err := batchLoadNodeTx(tx, uid, ref, index, true)
			if err != nil {
				return err
			}
			if node.ID == req.ParentID {
				return &batchMutationFailure{Index: index, ID: ref.ID, Status: http.StatusBadRequest, Code: "invalid_target", Message: "cannot move a node into itself"}
			}
			if node.Type == meta.NodeTypeDir {
				inside, err := batchTargetInsideNode(tx, uid, req.ParentID, node.ID)
				if err != nil {
					return err
				}
				if inside {
					return &batchMutationFailure{Index: index, ID: ref.ID, Status: http.StatusBadRequest, Code: "invalid_target", Message: "cannot move a directory into its descendant"}
				}
			}
			protected, err := yikeManagedTargetInSubtreeDB(c.Request.Context(), tx, uid, node.ID)
			if err != nil {
				return err
			}
			if protected {
				return &batchMutationFailure{Index: index, ID: ref.ID, Status: http.StatusConflict, Code: "managed_source_target", Message: "managed Yike target path cannot be moved"}
			}
			if node.ParentID != nil && *node.ParentID == req.ParentID {
				moved = append(moved, node)
				continue
			}
			exists, err := batchNameExistsTx(tx, uid, req.ParentID, node.Name, node.ID)
			if err != nil {
				return err
			}
			if exists {
				return &batchMutationFailure{Index: index, ID: ref.ID, Status: http.StatusConflict, Code: "name_conflict", Message: "name already exists in target directory"}
			}
			now := time.Now()
			result := tx.Model(&meta.Node{}).
				Where("id = ? AND owner_id = ? AND revision = ? AND deleted_at IS NULL", node.ID, uid, ref.Revision).
				Updates(map[string]any{"parent_id": req.ParentID, "revision": gorm.Expr("revision + 1"), "updated_at": now})
			if result.Error != nil {
				if isDuplicate(result.Error) {
					return &batchMutationFailure{Index: index, ID: ref.ID, Status: http.StatusConflict, Code: "name_conflict", Message: "name already exists in target directory"}
				}
				return result.Error
			}
			if result.RowsAffected == 0 {
				var current meta.Node
				if err := tx.Where("id = ? AND owner_id = ?", node.ID, uid).First(&current).Error; err == nil {
					return &batchMutationFailure{
						Index: index, ID: ref.ID, Status: http.StatusConflict, Code: "revision_conflict",
						Message: "node revision changed", CurrentRevision: current.Revision,
					}
				}
				return &batchMutationFailure{Index: index, ID: ref.ID, Status: http.StatusNotFound, Code: "node_not_found", Message: "node not found"}
			}
			node.ParentID = &req.ParentID
			node.Revision++
			node.UpdatedAt = now
			moved = append(moved, node)
		}
		return nil
	})
	if err != nil {
		writeBatchMutationFailure(c, "move", err)
		return
	}
	items := make([]nodeDTO, 0, len(moved))
	for _, node := range moved {
		items = append(items, toNodeDTO(node))
	}
	c.JSON(http.StatusOK, batchNodesResponse{OperationID: uuid.NewString(), Items: items})
}

func (s *Server) batchDeleteNodes(c *gin.Context) {
	var req batchDeleteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	if err := validateBatchNodeRefs(req.Items); err != nil {
		writeBatchMutationFailure(c, "delete", err)
		return
	}
	uid := userID(c)
	requestedIDs := make([]uint64, 0, len(req.Items))
	for _, item := range req.Items {
		requestedIDs = append(requestedIDs, item.ID)
	}
	err := s.DB.Transaction(func(tx *gorm.DB) error {
		topLevel, err := topLevelBatchDeleteRefs(tx, uid, req.Items)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return &batchMutationFailure{Status: http.StatusNotFound, Code: "node_not_found", Message: "node not found"}
			}
			return err
		}
		indexByID := make(map[uint64]int, len(req.Items))
		for index, item := range req.Items {
			indexByID[item.ID] = index
		}
		for _, ref := range topLevel {
			index := indexByID[ref.ID]
			node, err := batchLoadNodeTx(tx, uid, ref, index, false)
			if err != nil {
				return err
			}
			ids, err := activeSubtreeIDsDB(tx, uid, node.ID)
			if err != nil {
				return err
			}
			protected, err := yikeManagedTargetInIDsDB(c.Request.Context(), tx, uid, ids)
			if err != nil {
				return err
			}
			if protected {
				return &batchMutationFailure{Index: index, ID: ref.ID, Status: http.StatusConflict, Code: "managed_source_target", Message: "managed Yike target path cannot be deleted"}
			}
			now := time.Now()
			if err := tx.Model(&meta.Share{}).
				Where("node_id IN ? AND owner_id = ? AND revoked_at IS NULL", ids, uid).
				Update("revoked_at", &now).Error; err != nil {
				return err
			}
			if err := tx.Model(&meta.Node{}).
				Where("id IN ? AND owner_id = ? AND deleted_at IS NULL", ids, uid).
				Updates(map[string]any{"deleted_at": &now, "trash_root_id": node.ID}).Error; err != nil {
				return err
			}
			result := tx.Model(&meta.Node{}).
				Where("id = ? AND owner_id = ? AND revision = ?", node.ID, uid, ref.Revision).
				Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": now})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 0 {
				return &batchMutationFailure{Index: index, ID: ref.ID, Status: http.StatusConflict, Code: "revision_conflict", Message: "node revision changed"}
			}
		}
		return nil
	})
	if err != nil {
		writeBatchMutationFailure(c, "delete", err)
		return
	}
	c.JSON(http.StatusOK, batchNodesResponse{OperationID: uuid.NewString(), DeletedIDs: requestedIDs})
}
