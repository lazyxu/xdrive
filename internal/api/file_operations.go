package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	errFileOperationCancelled        = errors.New("file operation cancelled")
	errFileOperationTerminal         = errors.New("file operation is already terminal")
	errFileOperationRetryUnavailable = errors.New("file operation cannot be retried")
)

const (
	fileOperationTerminalHistoryLimit = 200
	fileOperationFallbackInterval     = 5 * time.Second
)

var fileOperationTerminalStatuses = []string{
	meta.FileOperationStatusCancelled,
	meta.FileOperationStatusCompleted,
	meta.FileOperationStatusFailed,
}

func (s *Server) registerFileOperationCancel(operationID string, cancel context.CancelCauseFunc) {
	if s == nil || operationID == "" || cancel == nil {
		return
	}
	s.fileOperationCancelMu.Lock()
	defer s.fileOperationCancelMu.Unlock()
	if s.fileOperationCancels == nil {
		s.fileOperationCancels = make(map[string]context.CancelCauseFunc)
	}
	s.fileOperationCancels[operationID] = cancel
}

func (s *Server) unregisterFileOperationCancel(operationID string) {
	if s == nil || operationID == "" {
		return
	}
	s.fileOperationCancelMu.Lock()
	defer s.fileOperationCancelMu.Unlock()
	delete(s.fileOperationCancels, operationID)
	if len(s.fileOperationCancels) == 0 {
		s.fileOperationCancels = nil
	}
}

func (s *Server) interruptFileOperation(operationID string) bool {
	if s == nil || operationID == "" {
		return false
	}
	s.fileOperationCancelMu.Lock()
	cancel := s.fileOperationCancels[operationID]
	s.fileOperationCancelMu.Unlock()
	if cancel == nil {
		return false
	}
	cancel(errFileOperationCancelled)
	return true
}

type fileOperationDTO struct {
	ID                string     `json:"id"`
	Type              string     `json:"type"`
	Status            string     `json:"status"`
	ParentID          *uint64    `json:"parent_id,omitempty"`
	RetryOfID         *string    `json:"retry_of_id,omitempty"`
	UndoOfID          *string    `json:"undo_of_id,omitempty"`
	UndoneByID        *string    `json:"undone_by_id,omitempty"`
	RedoOfID          *string    `json:"redo_of_id,omitempty"`
	RedoneByID        *string    `json:"redone_by_id,omitempty"`
	Undoable          bool       `json:"undoable"`
	Redoable          bool       `json:"redoable"`
	ConflictPolicy    string     `json:"conflict_policy,omitempty"`
	TotalItems        int64      `json:"total_items"`
	ProcessedItems    int64      `json:"processed_items"`
	TotalBytes        int64      `json:"total_bytes"`
	ProcessedBytes    int64      `json:"processed_bytes"`
	Percent           float64    `json:"percent"`
	CurrentItem       string     `json:"current_item,omitempty"`
	FailedItemID      uint64     `json:"failed_item_id,omitempty"`
	FailureCode       string     `json:"failure_code,omitempty"`
	Error             string     `json:"error,omitempty"`
	Retryable         bool       `json:"retryable"`
	CancelRequestedAt *time.Time `json:"cancel_requested_at,omitempty"`
	StartedAt         *time.Time `json:"started_at,omitempty"`
	FinishedAt        *time.Time `json:"finished_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

type createFileOperationRequest struct {
	Type           string         `json:"type"`
	Items          []batchNodeRef `json:"items"`
	ParentID       uint64         `json:"parent_id"`
	ConflictPolicy string         `json:"conflict_policy,omitempty"`
}

type resolveFileOperationConflictRequest struct {
	ConflictPolicy string `json:"conflict_policy"`
}

func toFileOperationDTO(operation meta.FileOperation) fileOperationDTO {
	percent := 0.0
	if operation.TotalBytes > 0 {
		percent = float64(operation.ProcessedBytes) * 100 / float64(operation.TotalBytes)
	} else if operation.TotalItems > 0 {
		percent = float64(operation.ProcessedItems) * 100 / float64(operation.TotalItems)
	}
	if percent < 0 {
		percent = 0
	}
	if percent > 100 {
		percent = 100
	}
	if operation.Status == meta.FileOperationStatusCompleted {
		percent = 100
	}
	return fileOperationDTO{
		ID:                operation.ID,
		Type:              operation.Type,
		Status:            operation.Status,
		ParentID:          operation.ParentID,
		RetryOfID:         operation.RetryOfID,
		UndoOfID:          operation.UndoOfID,
		UndoneByID:        operation.UndoneByID,
		RedoOfID:          operation.RedoOfID,
		RedoneByID:        operation.RedoneByID,
		Undoable:          fileOperationUndoable(operation),
		Redoable:          fileOperationRedoable(operation),
		ConflictPolicy:    operation.ConflictPolicy,
		TotalItems:        operation.TotalItems,
		ProcessedItems:    operation.ProcessedItems,
		TotalBytes:        operation.TotalBytes,
		ProcessedBytes:    operation.ProcessedBytes,
		Percent:           percent,
		CurrentItem:       operation.CurrentItem,
		FailedItemID:      operation.FailedItemID,
		FailureCode:       operation.FailureCode,
		Error:             operation.Error,
		Retryable:         fileOperationRetryable(operation),
		CancelRequestedAt: operation.CancelRequestedAt,
		StartedAt:         operation.StartedAt,
		FinishedAt:        operation.FinishedAt,
		CreatedAt:         operation.CreatedAt,
		UpdatedAt:         operation.UpdatedAt,
	}
}

func fileOperationRetryable(operation meta.FileOperation) bool {
	if operation.Type == meta.FileOperationTypeUndo || operation.Type == meta.FileOperationTypeRedo {
		return false
	}
	if operation.Status == meta.FileOperationStatusCancelled {
		return true
	}
	if operation.Status != meta.FileOperationStatusFailed {
		return false
	}
	switch operation.FailureCode {
	case "batch_empty",
		"batch_too_large",
		"invalid_batch_item",
		"duplicate_batch_item",
		"node_not_found",
		"root_mutation",
		"revision_conflict",
		"invalid_target",
		"nested_batch_selection",
		"name_conflict",
		"managed_source_target":
		return false
	default:
		return true
	}
}

func pruneFileOperationHistoryTx(tx *gorm.DB, uid uint64) error {
	if tx == nil || uid == 0 {
		return nil
	}
	var staleIDs []string
	if err := tx.Model(&meta.FileOperation{}).
		Where("owner_id = ? AND status IN ?", uid, fileOperationTerminalStatuses).
		Order("created_at DESC, id DESC").
		Offset(fileOperationTerminalHistoryLimit).
		Pluck("id", &staleIDs).Error; err != nil {
		return err
	}
	if len(staleIDs) == 0 {
		return nil
	}
	return tx.Where("owner_id = ? AND id IN ?", uid, staleIDs).Delete(&meta.FileOperation{}).Error
}

func (s *Server) createFileOperation(c *gin.Context) {
	var req createFileOperationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	operation, err := s.enqueueFileOperationWithConflictPolicy(
		c.Request.Context(), userID(c), req.Type, req.Items, req.ParentID, nil, req.ConflictPolicy,
	)
	if err != nil {
		writeFileOperationError(c, req.Type, err)
		return
	}
	c.JSON(http.StatusAccepted, toFileOperationDTO(operation))
}

func (s *Server) listFileOperations(c *gin.Context) {
	limit := 50
	if raw := c.Query("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 200 {
			fail(c, http.StatusBadRequest, "limit must be between 1 and 200")
			return
		}
		limit = parsed
	}
	var operations []meta.FileOperation
	if err := s.DB.WithContext(c.Request.Context()).
		Where("owner_id = ?", userID(c)).
		Order("created_at DESC, id DESC").
		Limit(limit).
		Find(&operations).Error; err != nil {
		fail(c, http.StatusInternalServerError, "list file operations failed")
		return
	}
	out := make([]fileOperationDTO, 0, len(operations))
	for _, operation := range operations {
		out = append(out, toFileOperationDTO(operation))
	}
	c.JSON(http.StatusOK, out)
}

func clearFileOperationHistoryTx(tx *gorm.DB, uid uint64) error {
	if tx == nil || uid == 0 {
		return nil
	}
	return tx.
		Where("owner_id = ? AND status IN ?", uid, fileOperationTerminalStatuses).
		Delete(&meta.FileOperation{}).Error
}

func (s *Server) clearFileOperationHistory(c *gin.Context) {
	if err := clearFileOperationHistoryTx(s.DB.WithContext(c.Request.Context()), userID(c)); err != nil {
		fail(c, http.StatusInternalServerError, "clear file operation history failed")
		return
	}
	c.Status(http.StatusNoContent)
}

func (s *Server) getFileOperation(c *gin.Context) {
	operation, err := s.loadOwnedFileOperation(c.Request.Context(), userID(c), c.Param("id"))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "file operation not found")
		} else {
			fail(c, http.StatusInternalServerError, "load file operation failed")
		}
		return
	}
	c.JSON(http.StatusOK, toFileOperationDTO(operation))
}

func (s *Server) requestFileOperationCancel(ctx context.Context, uid uint64, id string) error {
	now := time.Now()
	interruptWorker := false
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var operation meta.FileOperation
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", id, uid).
			First(&operation).Error; err != nil {
			return err
		}
		switch operation.Status {
		case meta.FileOperationStatusQueued:
			if err := tx.Model(&meta.FileOperation{}).Where("id = ?", id).Updates(map[string]any{
				"status":              meta.FileOperationStatusCancelled,
				"processed_items":     0,
				"processed_bytes":     0,
				"current_item":        "",
				"failed_item_id":      0,
				"failure_code":        "",
				"error":               "",
				"cancel_requested_at": &now,
				"finished_at":         &now,
				"updated_at":          now,
			}).Error; err != nil {
				return err
			}
			if err := releaseFileOperationLineageReservationTx(tx, operation); err != nil {
				return err
			}
			return pruneFileOperationHistoryTx(tx, uid)
		case meta.FileOperationStatusRunning:
			interruptWorker = true
			return tx.Model(&meta.FileOperation{}).Where("id = ?", id).Updates(map[string]any{
				"status":              meta.FileOperationStatusCancelRequested,
				"cancel_requested_at": &now,
				"updated_at":          now,
			}).Error
		case meta.FileOperationStatusCancelRequested:
			interruptWorker = true
			return nil
		default:
			return errFileOperationTerminal
		}
	})
	if err != nil {
		return err
	}
	if interruptWorker {
		s.interruptFileOperation(id)
	}
	return nil
}

func (s *Server) cancelFileOperation(c *gin.Context) {
	id := c.Param("id")
	uid := userID(c)
	if err := s.requestFileOperationCancel(c.Request.Context(), uid, id); err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "file operation not found")
		case errors.Is(err, errFileOperationTerminal):
			fail(c, http.StatusConflict, "file operation is already finished")
		default:
			fail(c, http.StatusInternalServerError, "cancel file operation failed")
		}
		return
	}
	operation, err := s.loadOwnedFileOperation(c.Request.Context(), uid, id)
	if err != nil {
		fail(c, http.StatusInternalServerError, "reload file operation failed")
		return
	}
	c.JSON(http.StatusOK, toFileOperationDTO(operation))
}

func (s *Server) enqueueFileOperationRetry(
	ctx context.Context,
	uid uint64,
	id string,
) (meta.FileOperation, error) {
	old, err := s.loadOwnedFileOperation(ctx, uid, id)
	if err != nil {
		return meta.FileOperation{}, err
	}
	if old.Status != meta.FileOperationStatusFailed &&
		old.Status != meta.FileOperationStatusCancelled {
		return meta.FileOperation{}, errFileOperationRetryUnavailable
	}
	if !fileOperationRetryable(old) {
		return meta.FileOperation{}, errFileOperationRetryUnavailable
	}
	refs, err := decodeFileOperationRefs(old.ItemsJSON)
	if err != nil {
		return meta.FileOperation{}, fmt.Errorf("decode stored file operation refs: %w", err)
	}
	parentID := uint64(0)
	if old.ParentID != nil {
		parentID = *old.ParentID
	}
	retryOf := old.ID
	return s.enqueueFileOperationWithConflictPolicy(
		ctx,
		uid,
		old.Type,
		refs,
		parentID,
		&retryOf,
		old.ConflictPolicy,
	)
}

func (s *Server) retryFileOperation(c *gin.Context) {
	operation, err := s.enqueueFileOperationRetry(
		c.Request.Context(),
		userID(c),
		c.Param("id"),
	)
	if err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "file operation not found")
		case errors.Is(err, errFileOperationRetryUnavailable):
			fail(c, http.StatusConflict, "file operation cannot be retried")
		default:
			fail(c, http.StatusInternalServerError, "retry file operation failed")
		}
		return
	}
	c.JSON(http.StatusAccepted, toFileOperationDTO(operation))
}

func (s *Server) resolveFileOperationConflict(c *gin.Context) {
	old, err := s.loadOwnedFileOperation(c.Request.Context(), userID(c), c.Param("id"))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "file operation not found")
		} else {
			fail(c, http.StatusInternalServerError, "load file operation failed")
		}
		return
	}
	if old.Status != meta.FileOperationStatusFailed || old.FailureCode != "name_conflict" {
		fail(c, http.StatusConflict, "file operation has no resolvable name conflict")
		return
	}

	var req resolveFileOperationConflictRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	policy, ok := meta.NormalizeFileOperationConflictPolicy(old.Type, req.ConflictPolicy)
	if !ok || policy == meta.FileOperationConflictPolicyFail {
		fail(c, http.StatusBadRequest, "conflict_policy must be skip, keep_both, or replace")
		return
	}

	refs, err := decodeFileOperationRefs(old.ItemsJSON)
	if err != nil {
		fail(c, http.StatusInternalServerError, "stored file operation is invalid")
		return
	}
	parentID := uint64(0)
	if old.ParentID != nil {
		parentID = *old.ParentID
	}
	retryOf := old.ID
	operation, err := s.enqueueFileOperationWithConflictPolicy(
		c.Request.Context(), userID(c), old.Type, refs, parentID, &retryOf, policy,
	)
	if err != nil {
		writeFileOperationError(c, old.Type, err)
		return
	}
	c.JSON(http.StatusAccepted, toFileOperationDTO(operation))
}

func writeFileOperationError(c *gin.Context, operationType string, err error) {
	var failure *batchMutationFailure
	if errors.As(err, &failure) {
		writeBatchMutationFailure(c, operationType, err)
		return
	}
	if errors.Is(err, errFileOperationTerminal) {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	if err != nil {
		switch err.Error() {
		case "invalid file operation type",
			"invalid file operation conflict policy",
			"undo and redo operations must be created from completed lineage operations":
			fail(c, http.StatusBadRequest, err.Error())
			return
		}
	}
	fail(c, http.StatusInternalServerError, "file operation failed")
}

func decodeFileOperationRefs(raw string) ([]batchNodeRef, error) {
	var refs []batchNodeRef
	if err := json.Unmarshal([]byte(raw), &refs); err != nil {
		return nil, err
	}
	if err := validateBatchNodeRefs(refs); err != nil {
		return nil, err
	}
	return refs, nil
}

func (s *Server) enqueueFileOperation(
	ctx context.Context,
	uid uint64,
	operationType string,
	requested []batchNodeRef,
	parentID uint64,
	retryOfID *string,
) (meta.FileOperation, error) {
	return s.enqueueFileOperationWithConflictPolicy(
		ctx, uid, operationType, requested, parentID, retryOfID, "",
	)
}

func (s *Server) enqueueFileOperationWithConflictPolicy(
	ctx context.Context,
	uid uint64,
	operationType string,
	requested []batchNodeRef,
	parentID uint64,
	retryOfID *string,
	conflictPolicy string,
) (meta.FileOperation, error) {
	if !meta.ValidFileOperationType(operationType) {
		return meta.FileOperation{}, errors.New("invalid file operation type")
	}
	if operationType == meta.FileOperationTypeUndo || operationType == meta.FileOperationTypeRedo {
		return meta.FileOperation{}, errors.New("undo and redo operations must be created from completed lineage operations")
	}
	resolvedConflictPolicy, ok := meta.NormalizeFileOperationConflictPolicy(operationType, conflictPolicy)
	if !ok {
		return meta.FileOperation{}, errors.New("invalid file operation conflict policy")
	}
	if err := validateBatchNodeRefs(requested); err != nil {
		return meta.FileOperation{}, err
	}

	var operation meta.FileOperation
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		refs := append([]batchNodeRef(nil), requested...)
		switch operationType {
		case meta.FileOperationTypeCopy, meta.FileOperationTypeMove:
			if _, err := batchTargetDirectoryTx(tx, uid, parentID); err != nil {
				return err
			}
			nested, err := batchSelectionHasAncestor(tx, uid, refs)
			if err != nil {
				return err
			}
			if nested {
				return &batchMutationFailure{
					Status:  http.StatusBadRequest,
					Code:    "nested_batch_selection",
					Message: operationType + " selection cannot contain both a directory and its descendant",
				}
			}
		case meta.FileOperationTypeDelete:
			topLevel, err := topLevelBatchDeleteRefs(tx, uid, refs)
			if err != nil {
				return err
			}
			refs = topLevel
		}

		nodes, err := batchLoadNodesTx(tx, uid, refs, true)
		if err != nil {
			return err
		}
		totalBytes, err := fileOperationSelectionBytesTx(tx, uid, nodes)
		if err != nil {
			return err
		}

		rawRefs, err := json.Marshal(refs)
		if err != nil {
			return err
		}
		operation = meta.FileOperation{
			ID:             uuid.NewString(),
			OwnerID:        uid,
			Type:           operationType,
			Status:         meta.FileOperationStatusQueued,
			RetryOfID:      retryOfID,
			ConflictPolicy: resolvedConflictPolicy,
			ItemsJSON:      string(rawRefs),
			TotalItems:     int64(len(refs)),
			TotalBytes:     totalBytes,
		}
		if operationType == meta.FileOperationTypeCopy || operationType == meta.FileOperationTypeMove {
			target := parentID
			operation.ParentID = &target
		}
		return tx.Create(&operation).Error
	})
	return operation, err
}

func fileOperationSelectionBytesTx(tx *gorm.DB, uid uint64, nodes []meta.Node) (int64, error) {
	if len(nodes) == 0 {
		return 0, nil
	}

	ids := make([]uint64, 0, len(nodes))
	for _, node := range nodes {
		ids = append(ids, node.ID)
		if node.Type == meta.NodeTypeFile && node.File == nil {
			var file meta.File
			if err := tx.Where("node_id = ?", node.ID).First(&file).Error; err != nil {
				return 0, err
			}
		}
	}

	var row struct {
		Bytes    int64 `gorm:"column:bytes"`
		Overflow bool  `gorm:"column:overflow"`
	}
	err := tx.Raw(`WITH RECURSIVE tree AS (
SELECT id
FROM xd_nodes
WHERE id IN ? AND owner_id = ? AND deleted_at IS NULL
UNION
SELECT n.id
FROM xd_nodes n
JOIN tree t ON n.parent_id = t.id
WHERE n.owner_id = ? AND n.deleted_at IS NULL
),
total AS (
SELECT COALESCE(SUM(f.size), 0)::numeric AS bytes
FROM tree
LEFT JOIN xd_files f ON f.node_id = tree.id
)
SELECT CASE
         WHEN bytes > 9223372036854775807 THEN 9223372036854775807
         WHEN bytes < -9223372036854775808 THEN -9223372036854775808
         ELSE bytes
       END::bigint AS bytes,
       (bytes > 9223372036854775807 OR bytes < -9223372036854775808) AS overflow
FROM total`, ids, uid, uid).Scan(&row).Error
	if err != nil {
		return 0, err
	}
	if row.Overflow {
		return 0, errors.New("file operation size overflow")
	}
	return row.Bytes, nil
}

func fileOperationNodeBytesTx(tx *gorm.DB, uid uint64, node meta.Node) (int64, error) {
	if node.Type == meta.NodeTypeFile {
		if node.File != nil {
			return node.File.Size, nil
		}
		var file meta.File
		if err := tx.Where("node_id = ?", node.ID).First(&file).Error; err != nil {
			return 0, err
		}
		return file.Size, nil
	}
	var row struct {
		Bytes int64 `gorm:"column:bytes"`
	}
	err := tx.Raw(`WITH RECURSIVE tree AS (
SELECT id FROM xd_nodes WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
UNION ALL
SELECT n.id FROM xd_nodes n JOIN tree t ON n.parent_id = t.id
WHERE n.owner_id = ? AND n.deleted_at IS NULL
)
SELECT COALESCE(SUM(f.size), 0) AS bytes
FROM tree
LEFT JOIN xd_files f ON f.node_id = tree.id`, node.ID, uid, uid).Scan(&row).Error
	return row.Bytes, err
}

type fileOperationMoveRootBytes struct {
	Bytes       int64
	MissingFile bool
}

func fileOperationMoveRootBytesTx(
	tx *gorm.DB,
	uid uint64,
	refs []batchNodeRef,
) (map[uint64]fileOperationMoveRootBytes, error) {
	if len(refs) == 0 {
		return map[uint64]fileOperationMoveRootBytes{}, nil
	}
	ids := make([]uint64, 0, len(refs))
	for _, ref := range refs {
		ids = append(ids, ref.ID)
	}
	var rows []struct {
		RootID      uint64 `gorm:"column:root_id"`
		Bytes       int64  `gorm:"column:bytes"`
		Overflow    bool   `gorm:"column:overflow"`
		MissingFile bool   `gorm:"column:missing_file"`
	}
	err := tx.Raw(`
WITH RECURSIVE roots AS (
	SELECT id, type
	FROM xd_nodes
	WHERE id IN ? AND owner_id = ? AND deleted_at IS NULL
),
tree AS (
	SELECT roots.id AS root_id, roots.id AS id
	FROM roots
	UNION ALL
	SELECT tree.root_id, child.id
	FROM tree
	JOIN xd_nodes AS child ON child.parent_id = tree.id
	WHERE child.owner_id = ? AND child.deleted_at IS NULL
),
totals AS (
	SELECT tree.root_id, COALESCE(SUM(file.size), 0)::numeric AS bytes
	FROM tree
	LEFT JOIN xd_files AS file ON file.node_id = tree.id
	GROUP BY tree.root_id
)
SELECT
	roots.id AS root_id,
	CASE
		WHEN totals.bytes > 9223372036854775807 THEN 9223372036854775807
		WHEN totals.bytes < -9223372036854775808 THEN -9223372036854775808
		ELSE totals.bytes
	END::bigint AS bytes,
	(totals.bytes > 9223372036854775807 OR totals.bytes < -9223372036854775808) AS overflow,
	(roots.type = ? AND root_file.node_id IS NULL) AS missing_file
FROM roots
JOIN totals ON totals.root_id = roots.id
LEFT JOIN xd_files AS root_file ON root_file.node_id = roots.id
ORDER BY roots.id
`, ids, uid, uid, meta.NodeTypeFile).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make(map[uint64]fileOperationMoveRootBytes, len(rows))
	for _, row := range rows {
		if row.Overflow {
			return nil, errors.New("file operation size overflow")
		}
		out[row.RootID] = fileOperationMoveRootBytes{
			Bytes:       row.Bytes,
			MissingFile: row.MissingFile,
		}
	}
	return out, nil
}

func fileOperationMoveNodeBytes(
	byRoot map[uint64]fileOperationMoveRootBytes,
	node meta.Node,
) (int64, error) {
	info, ok := byRoot[node.ID]
	if !ok || (node.Type == meta.NodeTypeFile && info.MissingFile) {
		return 0, gorm.ErrRecordNotFound
	}
	return info.Bytes, nil
}

func (s *Server) loadOwnedFileOperation(ctx context.Context, uid uint64, id string) (meta.FileOperation, error) {
	var operation meta.FileOperation
	err := s.DB.WithContext(ctx).
		Where("id = ? AND owner_id = ?", id, uid).
		First(&operation).Error
	return operation, err
}

func (s *Server) StartFileOperationWorker(ctx context.Context) {
	if s == nil || s.DB == nil {
		return
	}
	if err := s.recoverFileOperations(ctx); err != nil {
		slog.Error("file_operation_recovery_failed", "error", err)
	}
	go func() {
		fallback := time.NewTicker(fileOperationFallbackInterval)
		defer fallback.Stop()
		wakeups := s.FileOperationWakeups
		for {
			for {
				processed, err := s.processNextFileOperation(ctx)
				if err != nil && !errors.Is(err, context.Canceled) {
					slog.Error("file_operation_worker_failed", "error", err)
				}
				if !processed {
					break
				}
			}
			select {
			case <-ctx.Done():
				return
			case _, ok := <-wakeups:
				if !ok {
					wakeups = nil
				}
			case <-fallback.C:
			}
		}
	}()
}

func (s *Server) recoverFileOperations(ctx context.Context) error {
	now := time.Now()
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&meta.FileOperation{}).
			Where("status = ?", meta.FileOperationStatusRunning).
			Updates(map[string]any{
				"status":              meta.FileOperationStatusQueued,
				"processed_items":     0,
				"processed_bytes":     0,
				"current_item":        "",
				"failed_item_id":      0,
				"failure_code":        "",
				"error":               "",
				"cancel_requested_at": nil,
				"started_at":          nil,
				"finished_at":         nil,
				"updated_at":          now,
			}).Error; err != nil {
			return err
		}

		var cancellingOwners []uint64
		if err := tx.Model(&meta.FileOperation{}).
			Where("status = ?", meta.FileOperationStatusCancelRequested).
			Distinct("owner_id").
			Pluck("owner_id", &cancellingOwners).Error; err != nil {
			return err
		}
		var cancellingLineageOperations []meta.FileOperation
		if err := tx.Select("id", "owner_id", "type", "undo_of_id", "redo_of_id").
			Where(
				"status = ? AND type IN ?",
				meta.FileOperationStatusCancelRequested,
				[]string{meta.FileOperationTypeUndo, meta.FileOperationTypeRedo},
			).
			Find(&cancellingLineageOperations).Error; err != nil {
			return err
		}
		if err := tx.Model(&meta.FileOperation{}).
			Where("status = ?", meta.FileOperationStatusCancelRequested).
			Updates(map[string]any{
				"status":          meta.FileOperationStatusCancelled,
				"processed_items": 0,
				"processed_bytes": 0,
				"current_item":    "",
				"failed_item_id":  0,
				"failure_code":    "",
				"error":           "",
				"finished_at":     &now,
				"updated_at":      now,
			}).Error; err != nil {
			return err
		}
		for _, operation := range cancellingLineageOperations {
			if err := releaseFileOperationLineageReservationTx(tx, operation); err != nil {
				return err
			}
		}
		for _, ownerID := range cancellingOwners {
			if err := pruneFileOperationHistoryTx(tx, ownerID); err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *Server) processNextFileOperation(ctx context.Context) (bool, error) {
	operation, ok, err := s.claimNextFileOperation(ctx)
	if err != nil || !ok {
		return ok, err
	}

	operationCtx, cancelOperation := context.WithCancelCause(ctx)
	s.registerFileOperationCancel(operation.ID, cancelOperation)
	defer func() {
		s.unregisterFileOperationCancel(operation.ID)
		cancelOperation(nil)
	}()

	var refs []batchNodeRef
	if operation.Type != meta.FileOperationTypeUndo && operation.Type != meta.FileOperationTypeRedo {
		refs, err = decodeFileOperationRefs(operation.ItemsJSON)
		if err != nil {
			if errors.Is(context.Cause(operationCtx), errFileOperationCancelled) {
				return true, s.cancelRunningFileOperation(context.Background(), operation.OwnerID, operation.ID)
			}
			return true, s.failFileOperation(operationCtx, operation.OwnerID, operation.ID, err)
		}
	}

	switch operation.Type {
	case meta.FileOperationTypeCopy:
		err = s.executeQueuedBatchCopy(operationCtx, operation, refs)
	case meta.FileOperationTypeMove:
		err = s.executeQueuedBatchMove(operationCtx, operation, refs)
	case meta.FileOperationTypeDelete:
		err = s.executeQueuedBatchDelete(operationCtx, operation, refs)
	case meta.FileOperationTypeUndo:
		err = s.executeQueuedUndo(operationCtx, operation)
	case meta.FileOperationTypeRedo:
		err = s.executeQueuedRedo(operationCtx, operation)
	default:
		err = errors.New("unsupported file operation type")
	}
	if err == nil {
		return true, nil
	}
	if errors.Is(err, errFileOperationCancelled) || errors.Is(context.Cause(operationCtx), errFileOperationCancelled) {
		return true, s.cancelRunningFileOperation(context.Background(), operation.OwnerID, operation.ID)
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		// Server shutdown must not turn an interrupted operation into a user
		// cancellation. Its node transaction is rolled back and startup
		// recovery safely re-queues the running operation.
		return true, err
	}
	return true, s.failFileOperation(operationCtx, operation.OwnerID, operation.ID, err)
}

func (s *Server) claimNextFileOperation(ctx context.Context) (meta.FileOperation, bool, error) {
	var operation meta.FileOperation
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
			Where("status = ?", meta.FileOperationStatusQueued).
			Order("created_at ASC, id ASC").
			Limit(1).
			Find(&operation)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		now := time.Now()
		if err := tx.Model(&meta.FileOperation{}).Where("id = ?", operation.ID).Updates(map[string]any{
			"status":              meta.FileOperationStatusRunning,
			"processed_items":     0,
			"processed_bytes":     0,
			"current_item":        "",
			"failed_item_id":      0,
			"failure_code":        "",
			"error":               "",
			"cancel_requested_at": nil,
			"started_at":          &now,
			"finished_at":         nil,
			"updated_at":          now,
		}).Error; err != nil {
			return err
		}
		operation.Status = meta.FileOperationStatusRunning
		operation.ProcessedItems = 0
		operation.ProcessedBytes = 0
		operation.CurrentItem = ""
		operation.FailedItemID = 0
		operation.FailureCode = ""
		operation.Error = ""
		operation.CancelRequestedAt = nil
		operation.StartedAt = &now
		operation.FinishedAt = nil
		return nil
	})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return meta.FileOperation{}, false, nil
	}
	return operation, err == nil, err
}

func (s *Server) beginFileOperationItemWithProgress(
	ctx context.Context,
	operationID string,
	name string,
	itemDelta int64,
	byteDelta int64,
) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	updates := map[string]any{
		"current_item": name,
		"updated_at":   time.Now(),
	}
	if itemDelta != 0 {
		updates["processed_items"] = gorm.Expr("processed_items + ?", itemDelta)
	}
	if byteDelta != 0 {
		updates["processed_bytes"] = gorm.Expr("processed_bytes + ?", byteDelta)
	}
	result := s.DB.WithContext(ctx).Model(&meta.FileOperation{}).
		Where("id = ? AND status = ?", operationID, meta.FileOperationStatusRunning).
		Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 1 {
		return nil
	}
	var operation meta.FileOperation
	if err := s.DB.WithContext(ctx).Select("status").Where("id = ?", operationID).First(&operation).Error; err != nil {
		return err
	}
	if operation.Status == meta.FileOperationStatusCancelRequested || operation.Status == meta.FileOperationStatusCancelled {
		return errFileOperationCancelled
	}
	return errors.New("file operation is no longer running")
}

func (s *Server) beginFileOperationItem(ctx context.Context, operationID, name string) error {
	return s.beginFileOperationItemWithProgress(ctx, operationID, name, 0, 0)
}

func (s *Server) recordFileOperationProgressDelta(
	ctx context.Context,
	operationID string,
	itemDelta int64,
	byteDelta int64,
) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if itemDelta == 0 && byteDelta == 0 {
		return nil
	}
	updates := map[string]any{"updated_at": time.Now()}
	if itemDelta != 0 {
		updates["processed_items"] = gorm.Expr("processed_items + ?", itemDelta)
	}
	if byteDelta != 0 {
		updates["processed_bytes"] = gorm.Expr("processed_bytes + ?", byteDelta)
	}
	return s.DB.WithContext(ctx).Model(&meta.FileOperation{}).
		Where("id = ? AND status IN ?", operationID, []string{
			meta.FileOperationStatusRunning,
			meta.FileOperationStatusCancelRequested,
		}).
		Updates(updates).Error
}

func (s *Server) recordFileOperationProgress(ctx context.Context, operationID string, bytes int64) error {
	return s.recordFileOperationProgressDelta(ctx, operationID, 1, bytes)
}

func (s *Server) recordSkippedFileOperationItem(ctx context.Context, operationID string, bytes int64) error {
	return s.recordFileOperationProgress(ctx, operationID, bytes)
}

type fileOperationProgressCoalescer struct {
	server       *Server
	ctx          context.Context
	operationID  string
	pendingItems int64
	pendingBytes int64
}

func newFileOperationProgressCoalescer(
	server *Server,
	ctx context.Context,
	operationID string,
) *fileOperationProgressCoalescer {
	return &fileOperationProgressCoalescer{
		server:      server,
		ctx:         ctx,
		operationID: operationID,
	}
}

func (progress *fileOperationProgressCoalescer) begin(name string) error {
	if err := progress.server.beginFileOperationItemWithProgress(
		progress.ctx,
		progress.operationID,
		name,
		progress.pendingItems,
		progress.pendingBytes,
	); err != nil {
		return err
	}
	progress.pendingItems = 0
	progress.pendingBytes = 0
	return nil
}

func (progress *fileOperationProgressCoalescer) add(itemDelta, byteDelta int64) {
	progress.pendingItems += itemDelta
	progress.pendingBytes += byteDelta
}

func (progress *fileOperationProgressCoalescer) flush() error {
	if progress.pendingItems == 0 && progress.pendingBytes == 0 {
		return nil
	}
	if err := progress.server.recordFileOperationProgressDelta(
		progress.ctx,
		progress.operationID,
		progress.pendingItems,
		progress.pendingBytes,
	); err != nil {
		return err
	}
	progress.pendingItems = 0
	progress.pendingBytes = 0
	return nil
}

func (s *Server) fileOperationCopyHooks(progress *fileOperationProgressCoalescer) *copyNodeTxHooks {
	return &copyNodeTxHooks{
		BeforeNode: func(_ meta.Node, relativePath string) error {
			return progress.begin(relativePath)
		},
		AfterFile: func(source meta.Node, _ string) error {
			if source.File == nil {
				return errors.New("copied source file metadata is unavailable")
			}
			progress.add(0, source.File.Size)
			return nil
		},
	}
}

func (s *Server) completeFileOperationTx(tx *gorm.DB, operation meta.FileOperation) error {
	now := time.Now()
	result := tx.Model(&meta.FileOperation{}).
		Where("id = ? AND status = ?", operation.ID, meta.FileOperationStatusRunning).
		Updates(map[string]any{
			"status":          meta.FileOperationStatusCompleted,
			"processed_items": operation.TotalItems,
			"processed_bytes": operation.TotalBytes,
			"current_item":    "",
			"failed_item_id":  0,
			"failure_code":    "",
			"error":           "",
			"finished_at":     &now,
			"updated_at":      now,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 1 {
		return pruneFileOperationHistoryTx(tx, operation.OwnerID)
	}
	var current meta.FileOperation
	if err := tx.Select("status").Where("id = ?", operation.ID).First(&current).Error; err != nil {
		return err
	}
	if current.Status == meta.FileOperationStatusCancelRequested || current.Status == meta.FileOperationStatusCancelled {
		return errFileOperationCancelled
	}
	return errors.New("file operation is no longer running")
}

func (s *Server) executeQueuedBatchCopy(ctx context.Context, operation meta.FileOperation, refs []batchNodeRef) error {
	if operation.ParentID == nil {
		return errors.New("copy operation has no target directory")
	}
	uid := operation.OwnerID
	parentID := *operation.ParentID
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := batchTargetDirectoryTx(tx, uid, parentID); err != nil {
			return err
		}
		nested, err := batchSelectionHasAncestor(tx, uid, refs)
		if err != nil {
			return err
		}
		if nested {
			return &batchMutationFailure{Status: http.StatusBadRequest, Code: "nested_batch_selection", Message: "copy selection cannot contain both a directory and its descendant"}
		}
		roots, err := batchLoadNodesTx(tx, uid, refs, true)
		if err != nil {
			return err
		}
		targetInsideRoots, err := batchTargetInsideNodesTx(tx, uid, parentID, roots)
		if err != nil {
			return err
		}
		plan := fileOperationUndoPlan{Kind: fileOperationUndoKindCopy}
		replaceOrMerge := false
		operationProgress := newFileOperationProgressCoalescer(s, ctx, operation.ID)
		hooks := s.fileOperationCopyHooks(operationProgress)
		var copiedNodes []fileOperationUndoNodeRef
		hooks.AfterNode = func(_ meta.Node, copied meta.Node, _ string) error {
			copiedNodes = append(copiedNodes, fileOperationUndoNodeRef{ID: copied.ID, Revision: copied.Revision})
			return nil
		}
		for index, ref := range refs {
			source := roots[index]
			if err := operationProgress.begin(source.Name); err != nil {
				return err
			}
			if source.Type == meta.NodeTypeDir {
				if _, inside := targetInsideRoots[source.ID]; inside {
					return &batchMutationFailure{Index: index, ID: ref.ID, Status: http.StatusBadRequest, Code: "invalid_target", Message: "cannot copy a directory into itself or its descendant"}
				}
			}
			policy := operation.ConflictPolicy
			if policy == "" {
				policy = meta.DefaultFileOperationConflictPolicy(operation.Type)
			}
			if source.ParentID != nil && *source.ParentID == parentID {
				if policy == meta.FileOperationConflictPolicySkip {
					size, err := fileOperationNodeBytesTx(tx, uid, source)
					if err != nil {
						return err
					}
					operationProgress.add(1, size)
					continue
				}
				name, err := copyDestinationNameTx(tx, uid, parentID, source.Name, source.Type, nil)
				if err != nil {
					return &batchMutationFailure{Index: index, ID: ref.ID, Status: http.StatusConflict, Code: "name_conflict", Message: "cannot allocate destination name"}
				}
				copiedNodes = copiedNodes[:0]
				copiedRoot, err := s.copyNodeTxWithHooks(tx, uid, source, parentID, name, source.Name, hooks)
				if err != nil {
					return err
				}
				plan.CopyRoots = append(plan.CopyRoots, fileOperationUndoCopyRoot{
					Root:  fileOperationUndoNodeRef{ID: copiedRoot.ID, Revision: copiedRoot.Revision},
					Name:  copiedRoot.Name,
					Nodes: append([]fileOperationUndoNodeRef(nil), copiedNodes...),
				})
				operationProgress.add(1, 0)
				continue
			}
			if policy == meta.FileOperationConflictPolicyReplace {
				copiedNodes = copiedNodes[:0]
				copiedRoot, replaced, err := s.copyNodeReplaceOrMergeTx(
					ctx, tx, uid, source, parentID, source.Name, source.Name, hooks, index,
				)
				if err != nil {
					return err
				}
				if replaced {
					replaceOrMerge = true
				} else {
					plan.CopyRoots = append(plan.CopyRoots, fileOperationUndoCopyRoot{
						Root:  fileOperationUndoNodeRef{ID: copiedRoot.ID, Revision: copiedRoot.Revision},
						Name:  copiedRoot.Name,
						Nodes: append([]fileOperationUndoNodeRef(nil), copiedNodes...),
					})
				}
				operationProgress.add(1, 0)
				continue
			}
			name := source.Name
			exists, err := batchNameExistsTx(tx, uid, parentID, source.Name, 0)
			if err != nil {
				return err
			}
			if exists {
				switch policy {
				case meta.FileOperationConflictPolicySkip:
					size, err := fileOperationNodeBytesTx(tx, uid, source)
					if err != nil {
						return err
					}
					operationProgress.add(1, size)
					continue
				case meta.FileOperationConflictPolicyKeepBoth:
					name, err = copyDestinationNameTx(tx, uid, parentID, source.Name, source.Type, nil)
					if err != nil {
						return &batchMutationFailure{Index: index, ID: ref.ID, Status: http.StatusConflict, Code: "name_conflict", Message: "cannot allocate destination name"}
					}
				default:
					return &batchMutationFailure{Index: index, ID: ref.ID, Status: http.StatusConflict, Code: "name_conflict", Message: "name already exists in target directory"}
				}
			}
			copiedNodes = copiedNodes[:0]
			copiedRoot, err := s.copyNodeTxWithHooks(tx, uid, source, parentID, name, source.Name, hooks)
			if err != nil {
				return err
			}
			plan.CopyRoots = append(plan.CopyRoots, fileOperationUndoCopyRoot{
				Root:  fileOperationUndoNodeRef{ID: copiedRoot.ID, Revision: copiedRoot.Revision},
				Name:  copiedRoot.Name,
				Nodes: append([]fileOperationUndoNodeRef(nil), copiedNodes...),
			})
			operationProgress.add(1, 0)
		}
		if err := operationProgress.flush(); err != nil {
			return err
		}
		if !replaceOrMerge {
			if err := storeFileOperationUndoPlanTx(tx, operation.ID, plan); err != nil {
				return err
			}
		}
		return s.completeFileOperationTx(tx, operation)
	})
}

func (s *Server) executeQueuedBatchMove(ctx context.Context, operation meta.FileOperation, refs []batchNodeRef) error {
	if operation.ParentID == nil {
		return errors.New("move operation has no target directory")
	}
	uid := operation.OwnerID
	parentID := *operation.ParentID
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := batchTargetDirectoryTx(tx, uid, parentID); err != nil {
			return err
		}
		nested, err := batchSelectionHasAncestor(tx, uid, refs)
		if err != nil {
			return err
		}
		if nested {
			return &batchMutationFailure{Status: http.StatusBadRequest, Code: "nested_batch_selection", Message: "move selection cannot contain both a directory and its descendant"}
		}
		roots, err := batchLoadNodesTx(tx, uid, refs, false)
		if err != nil {
			return err
		}
		targetInsideRoots, err := batchTargetInsideNodesTx(tx, uid, parentID, roots)
		if err != nil {
			return err
		}
		plan := fileOperationUndoPlan{Kind: fileOperationUndoKindMove}
		replaceOrMerge := false
		operationProgress := newFileOperationProgressCoalescer(s, ctx, operation.ID)
		var rootBytes map[uint64]fileOperationMoveRootBytes
		moveNodeBytes := func(node meta.Node) (int64, error) {
			if rootBytes == nil {
				var err error
				rootBytes, err = fileOperationMoveRootBytesTx(tx, uid, refs)
				if err != nil {
					return 0, err
				}
			}
			return fileOperationMoveNodeBytes(rootBytes, node)
		}
		for index, ref := range refs {
			node := roots[index]
			if err := operationProgress.begin(node.Name); err != nil {
				return err
			}
			if node.ID == parentID {
				return &batchMutationFailure{Index: index, ID: ref.ID, Status: http.StatusBadRequest, Code: "invalid_target", Message: "cannot move a node into itself"}
			}
			if node.Type == meta.NodeTypeDir {
				if _, inside := targetInsideRoots[node.ID]; inside {
					return &batchMutationFailure{Index: index, ID: ref.ID, Status: http.StatusBadRequest, Code: "invalid_target", Message: "cannot move a directory into its descendant"}
				}
			}
			protected, err := yikeManagedTargetInSubtreeDB(ctx, tx, uid, node.ID)
			if err != nil {
				return err
			}
			if protected {
				return &batchMutationFailure{Index: index, ID: ref.ID, Status: http.StatusConflict, Code: "managed_source_target", Message: "managed Yike target path cannot be moved"}
			}
			if node.ParentID == nil || *node.ParentID != parentID {
				originalParentID := uint64(0)
				if node.ParentID != nil {
					originalParentID = *node.ParentID
				}
				originalName := node.Name
				policy := operation.ConflictPolicy
				if policy == "" {
					policy = meta.DefaultFileOperationConflictPolicy(operation.Type)
				}
				if policy == meta.FileOperationConflictPolicyReplace {
					size, err := moveNodeBytes(node)
					if err != nil {
						return err
					}
					moved, replaced, err := s.moveNodeReplaceOrMergeTx(ctx, tx, uid, node, parentID, index)
					if err != nil {
						return err
					}
					if replaced {
						replaceOrMerge = true
					} else {
						plan.Moves = append(plan.Moves, fileOperationUndoMove{
							ID:       moved.ID,
							Revision: moved.Revision,
							ParentID: originalParentID,
							Name:     originalName,
						})
					}
					operationProgress.add(1, size)
					continue
				}
				targetName := node.Name
				exists, err := batchNameExistsTx(tx, uid, parentID, node.Name, node.ID)
				if err != nil {
					return err
				}
				if exists {
					switch policy {
					case meta.FileOperationConflictPolicySkip:
						size, err := moveNodeBytes(node)
						if err != nil {
							return err
						}
						operationProgress.add(1, size)
						continue
					case meta.FileOperationConflictPolicyKeepBoth:
						targetName, err = copyDestinationNameTx(tx, uid, parentID, node.Name, node.Type, nil)
						if err != nil {
							return &batchMutationFailure{Index: index, ID: ref.ID, Status: http.StatusConflict, Code: "name_conflict", Message: "cannot allocate destination name"}
						}
					default:
						return &batchMutationFailure{Index: index, ID: ref.ID, Status: http.StatusConflict, Code: "name_conflict", Message: "name already exists in target directory"}
					}
				}
				now := time.Now()
				updates := map[string]any{"parent_id": parentID, "revision": gorm.Expr("revision + 1"), "updated_at": now}
				if targetName != node.Name {
					updates["name"] = targetName
				}
				result := tx.Model(&meta.Node{}).
					Where("id = ? AND owner_id = ? AND revision = ? AND deleted_at IS NULL", node.ID, uid, ref.Revision).
					Updates(updates)
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
				plan.Moves = append(plan.Moves, fileOperationUndoMove{
					ID:       node.ID,
					Revision: ref.Revision + 1,
					ParentID: originalParentID,
					Name:     originalName,
				})
			}
			size, err := moveNodeBytes(node)
			if err != nil {
				return err
			}
			operationProgress.add(1, size)
		}
		if err := operationProgress.flush(); err != nil {
			return err
		}
		if !replaceOrMerge {
			if err := storeFileOperationUndoPlanTx(tx, operation.ID, plan); err != nil {
				return err
			}
		}
		return s.completeFileOperationTx(tx, operation)
	})
}

func (s *Server) executeQueuedBatchDelete(ctx context.Context, operation meta.FileOperation, refs []batchNodeRef) error {
	uid := operation.OwnerID
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		roots, err := batchLoadNodesTx(tx, uid, refs, true)
		if err != nil {
			return err
		}
		plan := fileOperationUndoPlan{Kind: fileOperationUndoKindDelete}
		operationProgress := newFileOperationProgressCoalescer(s, ctx, operation.ID)
		rootIDs := make([]uint64, 0, len(roots))
		for _, root := range roots {
			rootIDs = append(rootIDs, root.ID)
		}
		subtrees, err := activeSubtreeSummariesDB(tx, uid, rootIDs)
		if err != nil {
			return err
		}
		for index, ref := range refs {
			node := roots[index]
			if err := operationProgress.begin(node.Name); err != nil {
				return err
			}
			if node.Type == meta.NodeTypeFile && node.File == nil {
				return gorm.ErrRecordNotFound
			}
			subtree, ok := subtrees[node.ID]
			if !ok {
				return gorm.ErrRecordNotFound
			}
			protected, err := yikeManagedTargetInIDsDB(ctx, tx, uid, subtree.IDs)
			if err != nil {
				return err
			}
			if protected {
				return &batchMutationFailure{Index: index, ID: ref.ID, Status: http.StatusConflict, Code: "managed_source_target", Message: "managed Yike target path cannot be deleted"}
			}
			now := time.Now()
			if err := tx.Model(&meta.Share{}).
				Where("node_id IN ? AND owner_id = ? AND revoked_at IS NULL", subtree.IDs, uid).
				Update("revoked_at", &now).Error; err != nil {
				return err
			}
			if err := tx.Model(&meta.Node{}).
				Where("id IN ? AND owner_id = ? AND deleted_at IS NULL", subtree.IDs, uid).
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
			plan.Deletes = append(plan.Deletes, fileOperationUndoDelete{
				ID:       node.ID,
				Revision: ref.Revision + 1,
				Name:     node.Name,
			})
			operationProgress.add(1, subtree.Bytes)
		}
		if err := operationProgress.flush(); err != nil {
			return err
		}
		if err := storeFileOperationUndoPlanTx(tx, operation.ID, plan); err != nil {
			return err
		}
		return s.completeFileOperationTx(tx, operation)
	})
}

func (s *Server) cancelRunningFileOperation(ctx context.Context, ownerID uint64, operationID string) error {
	now := time.Now()
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var operation meta.FileOperation
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ?", operationID, ownerID).
			First(&operation).Error; err != nil {
			return err
		}
		if err := tx.Model(&meta.FileOperation{}).
			Where("id = ? AND owner_id = ? AND status IN ?", operationID, ownerID, []string{
				meta.FileOperationStatusRunning,
				meta.FileOperationStatusCancelRequested,
			}).
			Updates(map[string]any{
				"status":          meta.FileOperationStatusCancelled,
				"processed_items": 0,
				"processed_bytes": 0,
				"current_item":    "",
				"failed_item_id":  0,
				"failure_code":    "",
				"error":           "",
				"finished_at":     &now,
				"updated_at":      now,
			}).Error; err != nil {
			return err
		}
		if err := releaseFileOperationLineageReservationTx(tx, operation); err != nil {
			return err
		}
		return pruneFileOperationHistoryTx(tx, ownerID)
	})
}

func (s *Server) failFileOperation(ctx context.Context, ownerID uint64, operationID string, executionErr error) error {
	now := time.Now()
	message := executionErr.Error()
	failedItemID := uint64(0)
	failureCode := "internal_error"
	var failure *batchMutationFailure
	if errors.As(executionErr, &failure) {
		failedItemID = failure.ID
		if failure.Code != "" {
			failureCode = failure.Code
			message = failure.Code + ": " + failure.Message
		}
	}
	return s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var current meta.FileOperation
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Select("status", "type", "undo_of_id", "redo_of_id").
			Where("id = ? AND owner_id = ?", operationID, ownerID).
			First(&current).Error; err != nil {
			return err
		}
		if current.Status == meta.FileOperationStatusCancelRequested {
			if err := tx.Model(&meta.FileOperation{}).
				Where("id = ? AND owner_id = ?", operationID, ownerID).
				Updates(map[string]any{
					"status":          meta.FileOperationStatusCancelled,
					"processed_items": 0,
					"processed_bytes": 0,
					"current_item":    "",
					"failed_item_id":  0,
					"failure_code":    "",
					"error":           "",
					"finished_at":     &now,
					"updated_at":      now,
				}).Error; err != nil {
				return err
			}
			current.ID = operationID
			current.OwnerID = ownerID
			if err := releaseFileOperationLineageReservationTx(tx, current); err != nil {
				return err
			}
			return pruneFileOperationHistoryTx(tx, ownerID)
		}
		if err := tx.Model(&meta.FileOperation{}).
			Where("id = ? AND owner_id = ?", operationID, ownerID).
			Updates(map[string]any{
				"status":          meta.FileOperationStatusFailed,
				"processed_items": 0,
				"processed_bytes": 0,
				"failed_item_id":  failedItemID,
				"failure_code":    failureCode,
				"error":           message,
				"finished_at":     &now,
				"updated_at":      now,
			}).Error; err != nil {
			return err
		}
		current.ID = operationID
		current.OwnerID = ownerID
		if err := releaseFileOperationLineageReservationTx(tx, current); err != nil {
			return err
		}
		return pruneFileOperationHistoryTx(tx, ownerID)
	})
}
