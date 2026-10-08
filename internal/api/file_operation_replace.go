package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func fileOperationNameConflictNodeTx(tx *gorm.DB, uid, parentID uint64, name string, except uint64) (meta.Node, bool, error) {
	var node meta.Node
	query := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("owner_id = ? AND parent_id = ? AND deleted_at IS NULL AND lower(name) = lower(?)", uid, parentID, name)
	if except != 0 {
		query = query.Where("id <> ?", except)
	}
	if err := query.First(&node).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return meta.Node{}, false, nil
		}
		return meta.Node{}, false, err
	}
	return node, true, nil
}

func (s *Server) trashFileOperationConflictTx(ctx context.Context, tx *gorm.DB, uid uint64, target meta.Node, index int) error {
	ids, err := activeSubtreeIDsDB(tx, uid, target.ID)
	if err != nil {
		return err
	}
	protected, err := yikeManagedTargetInIDsDB(ctx, tx, uid, ids)
	if err != nil {
		return err
	}
	if protected {
		return &batchMutationFailure{Index: index, ID: target.ID, Status: http.StatusConflict, Code: "managed_source_target", Message: "managed source target cannot be replaced or merged"}
	}
	now := time.Now()
	if err := tx.Model(&meta.Share{}).Where("node_id IN ? AND owner_id = ? AND revoked_at IS NULL", ids, uid).
		Update("revoked_at", &now).Error; err != nil {
		return err
	}
	if err := tx.Model(&meta.Node{}).Where("id IN ? AND owner_id = ? AND deleted_at IS NULL", ids, uid).
		Updates(map[string]any{"deleted_at": &now, "trash_root_id": target.ID}).Error; err != nil {
		return err
	}
	result := tx.Model(&meta.Node{}).Where("id = ? AND owner_id = ? AND revision = ?", target.ID, uid, target.Revision).
		Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": now})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return &batchMutationFailure{Index: index, ID: target.ID, Status: http.StatusConflict, Code: "revision_conflict", Message: "replace target changed during operation"}
	}
	return nil
}

type fileOperationCopySourceSnapshot struct {
	rootID           uint64
	childrenByParent map[uint64][]meta.Node
}

func (snapshot *fileOperationCopySourceSnapshot) load(
	tx *gorm.DB,
	uid uint64,
) (map[uint64][]meta.Node, error) {
	if snapshot.childrenByParent != nil {
		return snapshot.childrenByParent, nil
	}
	childrenByParent, err := loadFileOperationCopySubtree(tx, uid, snapshot.rootID)
	if err != nil {
		return nil, err
	}
	snapshot.childrenByParent = childrenByParent
	return childrenByParent, nil
}

func (s *Server) copyNodeReplaceOrMergeTx(
	ctx context.Context,
	tx *gorm.DB,
	uid uint64,
	source meta.Node,
	parentID uint64,
	name string,
	relativePath string,
	hooks *copyNodeTxHooks,
	index int,
) (meta.Node, bool, error) {
	return s.copyNodeReplaceOrMergeTxLoaded(
		ctx, tx, uid, source, parentID, name, relativePath, hooks, index,
		&fileOperationCopySourceSnapshot{rootID: source.ID},
	)
}

func (s *Server) copyNodeReplaceOrMergeTxLoaded(
	ctx context.Context,
	tx *gorm.DB,
	uid uint64,
	source meta.Node,
	parentID uint64,
	name string,
	relativePath string,
	hooks *copyNodeTxHooks,
	index int,
	sourceSnapshot *fileOperationCopySourceSnapshot,
) (meta.Node, bool, error) {
	target, exists, err := fileOperationNameConflictNodeTx(tx, uid, parentID, name, 0)
	if err != nil {
		return meta.Node{}, false, err
	}
	if !exists {
		var childrenByParent map[uint64][]meta.Node
		if source.Type == meta.NodeTypeDir {
			childrenByParent, err = sourceSnapshot.load(tx, uid)
			if err != nil {
				return meta.Node{}, false, err
			}
		}
		copied, err := s.copyNodeTxWithHooksLoaded(
			tx, uid, source, parentID, name, relativePath, hooks, childrenByParent,
		)
		return copied, false, err
	}
	if source.Type == meta.NodeTypeDir && target.Type == meta.NodeTypeDir {
		protected, err := yikeManagedTargetInSubtreeDB(ctx, tx, uid, target.ID)
		if err != nil {
			return meta.Node{}, false, err
		}
		if protected {
			return meta.Node{}, false, &batchMutationFailure{Index: index, ID: target.ID, Status: http.StatusConflict, Code: "managed_source_target", Message: "managed source target cannot be replaced or merged"}
		}
		if hooks != nil && hooks.BeforeNode != nil {
			if err := hooks.BeforeNode(source, relativePath); err != nil {
				return meta.Node{}, false, err
			}
		}
		childrenByParent, err := sourceSnapshot.load(tx, uid)
		if err != nil {
			return meta.Node{}, false, err
		}
		for _, child := range childrenByParent[source.ID] {
			childPath := child.Name
			if relativePath != "" {
				childPath = relativePath + "/" + child.Name
			}
			if _, _, err := s.copyNodeReplaceOrMergeTxLoaded(
				ctx, tx, uid, child, target.ID, child.Name, childPath, hooks, index, sourceSnapshot,
			); err != nil {
				return meta.Node{}, false, err
			}
		}
		if hooks != nil && hooks.AfterNode != nil {
			if err := hooks.AfterNode(source, target, relativePath); err != nil {
				return meta.Node{}, false, err
			}
		}
		return target, true, nil
	}
	if err := s.trashFileOperationConflictTx(ctx, tx, uid, target, index); err != nil {
		return meta.Node{}, false, err
	}
	var childrenByParent map[uint64][]meta.Node
	if source.Type == meta.NodeTypeDir {
		childrenByParent, err = sourceSnapshot.load(tx, uid)
		if err != nil {
			return meta.Node{}, false, err
		}
	}
	copied, err := s.copyNodeTxWithHooksLoaded(
		tx, uid, source, parentID, name, relativePath, hooks, childrenByParent,
	)
	return copied, true, err
}

func moveFileOperationNodeTx(tx *gorm.DB, uid uint64, node meta.Node, parentID uint64, index int) (meta.Node, error) {
	now := time.Now()
	result := tx.Model(&meta.Node{}).
		Where("id = ? AND owner_id = ? AND revision = ? AND deleted_at IS NULL", node.ID, uid, node.Revision).
		Updates(map[string]any{"parent_id": parentID, "revision": gorm.Expr("revision + 1"), "updated_at": now})
	if result.Error != nil {
		if isDuplicate(result.Error) {
			return meta.Node{}, &batchMutationFailure{Index: index, ID: node.ID, Status: http.StatusConflict, Code: "name_conflict", Message: "name already exists in target directory"}
		}
		return meta.Node{}, result.Error
	}
	if result.RowsAffected != 1 {
		var current meta.Node
		if err := tx.Where("id = ? AND owner_id = ?", node.ID, uid).First(&current).Error; err == nil {
			return meta.Node{}, &batchMutationFailure{Index: index, ID: node.ID, Status: http.StatusConflict, Code: "revision_conflict", Message: "node revision changed", CurrentRevision: current.Revision}
		}
		return meta.Node{}, &batchMutationFailure{Index: index, ID: node.ID, Status: http.StatusNotFound, Code: "node_not_found", Message: "node not found"}
	}
	node.ParentID = &parentID
	node.Revision++
	node.UpdatedAt = now
	return node, nil
}

func removeMergedSourceDirectoryTx(tx *gorm.DB, uid uint64, sourceID, targetID uint64, index int) error {
	var activeChildren int64
	if err := tx.Model(&meta.Node{}).Where("owner_id = ? AND parent_id = ? AND deleted_at IS NULL", uid, sourceID).
		Count(&activeChildren).Error; err != nil {
		return err
	}
	if activeChildren != 0 {
		return &batchMutationFailure{Index: index, ID: sourceID, Status: http.StatusConflict, Code: "merge_conflict", Message: "source directory still contains active children after merge"}
	}
	if err := tx.Model(&meta.Node{}).Where("owner_id = ? AND parent_id = ? AND deleted_at IS NOT NULL", uid, sourceID).
		Update("parent_id", targetID).Error; err != nil {
		return err
	}
	result := tx.Where("id = ? AND owner_id = ? AND deleted_at IS NULL", sourceID, uid).Delete(&meta.Node{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return &batchMutationFailure{Index: index, ID: sourceID, Status: http.StatusConflict, Code: "revision_conflict", Message: "merged source directory changed during operation"}
	}
	return nil
}

func (s *Server) moveNodeReplaceOrMergeTx(ctx context.Context, tx *gorm.DB, uid uint64, source meta.Node, parentID uint64, index int) (meta.Node, bool, error) {
	target, exists, err := fileOperationNameConflictNodeTx(tx, uid, parentID, source.Name, source.ID)
	if err != nil {
		return meta.Node{}, false, err
	}
	if !exists {
		moved, err := moveFileOperationNodeTx(tx, uid, source, parentID, index)
		return moved, false, err
	}
	if source.Type == meta.NodeTypeDir && target.Type == meta.NodeTypeDir {
		protected, err := yikeManagedTargetInSubtreeDB(ctx, tx, uid, target.ID)
		if err != nil {
			return meta.Node{}, false, err
		}
		if protected {
			return meta.Node{}, false, &batchMutationFailure{Index: index, ID: target.ID, Status: http.StatusConflict, Code: "managed_source_target", Message: "managed source target cannot be replaced or merged"}
		}
		var children []meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("owner_id = ? AND parent_id = ? AND deleted_at IS NULL", uid, source.ID).
			Order("type ASC, name ASC").Find(&children).Error; err != nil {
			return meta.Node{}, false, err
		}
		for _, child := range children {
			if _, _, err := s.moveNodeReplaceOrMergeTx(ctx, tx, uid, child, target.ID, index); err != nil {
				return meta.Node{}, false, err
			}
		}
		if err := removeMergedSourceDirectoryTx(tx, uid, source.ID, target.ID, index); err != nil {
			return meta.Node{}, false, err
		}
		return target, true, nil
	}
	if err := s.trashFileOperationConflictTx(ctx, tx, uid, target, index); err != nil {
		return meta.Node{}, false, err
	}
	moved, err := moveFileOperationNodeTx(tx, uid, source, parentID, index)
	return moved, true, err
}
