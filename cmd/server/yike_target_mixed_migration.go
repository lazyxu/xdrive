package main

import (
	"errors"
	"fmt"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const maxLegacyYikeMixedChildren = 100000

type legacyYikeVerifiedChild struct {
	node meta.Node
	item meta.SourceItem
}

// splitLegacyYikeMixedTargetTx moves only fully SourceItem-verified top-level
// file Nodes or whole, exclusively tracked nested directory branches. Untracked
// ordinary directories and partly owned nested branches still fail closed.
// The original root and its direct Share bindings remain untouched.
func splitLegacyYikeMixedTargetTx(
	tx *gorm.DB, source meta.Source, legacyRoot, connector, target meta.Node,
) error {
	blocked := func(reason string) error {
		return fmt.Errorf("%w: %s", errLegacyYikeTargetMigrationBlocked, reason)
	}
	if source.ID == 0 || source.OwnerID == 0 || source.TargetNodeID == nil ||
		*source.TargetNodeID != target.ID || source.Kind != "yike_photos" ||
		source.Direction != meta.SourceDirectionPull || legacyRoot.ParentID == nil ||
		connector.ParentID == nil || *connector.ParentID != legacyRoot.ID ||
		target.ParentID == nil || *target.ParentID != connector.ID ||
		target.OwnerID != source.OwnerID || connector.OwnerID != source.OwnerID ||
		legacyRoot.OwnerID != source.OwnerID || target.Type != meta.NodeTypeDir {
		return blocked("legacy Yike source/tree identity is inconsistent")
	}

	// Lock the old root before classifying children, so new children cannot be
	// inserted through its FK while a split is being committed.
	var current meta.Node
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			target.ID, source.OwnerID, meta.NodeTypeDir).Take(&current).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return blocked("legacy Yike target no longer exists")
		}
		return err
	}
	if current.Revision != target.Revision || current.Name != target.Name ||
		current.ParentID == nil || *current.ParentID != connector.ID {
		return blocked("legacy Yike target changed while preparing migration")
	}

	// A second Source rooted inside this subtree or at any old ancestor is
	// allowed to retain its original scope, not silently inherit a split.
	var overlap bool
	if err := tx.Raw(
		"WITH RECURSIVE ancestors AS ("+
			" SELECT id, parent_id, ARRAY[id]::bigint[] AS visited FROM xd_nodes"+
			" WHERE id = ? AND owner_id = ? AND deleted_at IS NULL"+
			" UNION ALL SELECT p.id, p.parent_id, a.visited || p.id"+
			" FROM xd_nodes p JOIN ancestors a ON p.id = a.parent_id"+
			" WHERE p.owner_id = ? AND p.deleted_at IS NULL AND NOT p.id = ANY(a.visited)"+
			"), descendants AS ("+
			" SELECT id FROM xd_nodes WHERE id = ? AND owner_id = ? AND deleted_at IS NULL"+
			" UNION SELECT n.id FROM xd_nodes n JOIN descendants d ON n.parent_id = d.id"+
			" WHERE n.owner_id = ? AND n.deleted_at IS NULL"+
			") SELECT EXISTS (SELECT 1 FROM xd_sources s WHERE s.owner_id = ?"+
			" AND s.id <> ? AND (s.target_node_id IN (SELECT id FROM ancestors)"+
			" OR s.target_node_id IN (SELECT id FROM descendants)))",
		target.ID, source.OwnerID, source.OwnerID,
		target.ID, source.OwnerID, source.OwnerID, source.OwnerID, source.ID,
	).Scan(&overlap).Error; err != nil {
		return err
	}
	if overlap {
		return blocked("another Source owns an overlapping legacy target")
	}

	var running int64
	if err := tx.Model(&meta.SyncRun{}).
		Where("source_id = ? AND status = ?", source.ID, meta.SyncRunStatusRunning).
		Count(&running).Error; err != nil {
		return err
	}
	if running != 0 {
		return blocked("Source has an active sync run")
	}
	// Be deliberately conservative until operation-scoped fencing is available:
	// any in-flight Owner upload/batch mutation may contain an old Node ID.
	var busy int64
	if err := tx.Model(&meta.UploadSession{}).
		Where("owner_id = ? AND status = ? AND expires_at > ?",
			source.OwnerID, meta.UploadStatusActive, time.Now().UTC()).
		Count(&busy).Error; err != nil {
		return err
	}
	if busy != 0 {
		return blocked("Owner has an active upload session")
	}
	if err := tx.Model(&meta.FileOperation{}).
		Where("owner_id = ? AND status IN ?", source.OwnerID, []string{
			meta.FileOperationStatusQueued, meta.FileOperationStatusRunning,
			meta.FileOperationStatusCancelRequested,
		}).Count(&busy).Error; err != nil {
		return err
	}
	if busy != 0 {
		return blocked("Owner has an unfinished Files operation")
	}

	var children []meta.Node
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("owner_id = ? AND parent_id = ? AND deleted_at IS NULL",
			source.OwnerID, target.ID).Order("id ASC").
		Limit(maxLegacyYikeMixedChildren + 1).Find(&children).Error; err != nil {
		return err
	}
	if len(children) == 0 || len(children) > maxLegacyYikeMixedChildren {
		return blocked("empty or oversized mixed legacy target")
	}
	for _, child := range children {
		if child.Revision == 0 || (child.Type != meta.NodeTypeFile && child.Type != meta.NodeTypeDir) {
			return blocked("invalid legacy content needs reviewed migration")
		}
	}

	var foreignClaims bool
	if err := tx.Raw(
		"SELECT EXISTS (SELECT 1 FROM xd_source_items i"+
			" JOIN xd_nodes n ON n.id = i.node_id"+
			" WHERE i.source_id <> ? AND (n.id = ? OR n.parent_id = ?)"+
			" AND n.owner_id = ? AND n.deleted_at IS NULL)",
		source.ID, target.ID, target.ID, source.OwnerID,
	).Scan(&foreignClaims).Error; err != nil {
		return err
	}
	if foreignClaims {
		return blocked("another SourceItem references a legacy child")
	}

	var items []meta.SourceItem
	if err := tx.Where("source_id = ?", source.ID).
		Limit(maxLegacyYikeMixedChildren + 1).Find(&items).Error; err != nil {
		return err
	}
	if len(items) > maxLegacyYikeMixedChildren {
		return blocked("too many legacy SourceItems for an atomic split")
	}
	byNode := make(map[uint64]meta.SourceItem, len(items))
	for _, item := range items {
		if item.NodeID == nil {
			if item.State == meta.SourceItemStateSynced {
				return blocked("synced SourceItem lost its stable Node ID")
			}
			continue
		}
		if _, duplicate := byNode[*item.NodeID]; duplicate {
			return blocked("multiple SourceItems refer to the same Node")
		}
		byNode[*item.NodeID] = item

	}
	verified := make([]legacyYikeVerifiedChild, 0, len(children))
	covered := make(map[uint64]bool, len(items))
	ordinary := 0
	nestedBranches := 0
	for _, child := range children {
		item, known := byNode[child.ID]
		if !known {
			// An untracked directory might contain another user's files or a
			// partially tracked subtree; preserving its old Share scope alone
			// is not enough to prove that no Source child is stranded.
			if child.Type == meta.NodeTypeDir {
				return blocked("untracked legacy directory requires reviewed split")
			}
			ordinary++
			continue
		}
		kind := meta.SourceItemKindFile
		if child.Type == meta.NodeTypeDir {
			kind = meta.SourceItemKindDirectory
		}
		if item.State != meta.SourceItemStateSynced || item.Kind != kind ||
			item.Path != child.Name || item.NodeRevision != child.Revision {
			return blocked("SourceItem ownership, path or revision is unverified")
		}
		if child.Type == meta.NodeTypeDir {
			nestedBranches++
			if nestedBranches > maxLegacyYikeNestedBranches {
				return blocked("too many nested branches for atomic migration")
			}
			ids, err := verifyLegacyYikeOwnedNestedBranchTx(tx, source, child, byNode)
			if err != nil {
				return err
			}
			for _, id := range ids {
				covered[id] = true
			}
		} else {
			covered[child.ID] = true
		}
		verified = append(verified, legacyYikeVerifiedChild{node: child, item: item})
	}
	// A synced SourceItem outside the retained relative tree would be lost
	// during rebinding, even if all observed children otherwise looked safe.
	for _, item := range items {
		if item.State == meta.SourceItemStateSynced {
			if item.NodeID == nil || !covered[*item.NodeID] {
				return blocked("synced SourceItem is outside verified legacy subtree")
			}
		}
	}
	if ordinary == 0 || len(verified) == 0 {
		return blocked("legacy target is not a proven mixed Source root")
	}

	// The old root must be a direct child of the actual Owner root. Never
	// manufacture a canonical parent beneath another Source's managed tree.
	var ownerRoot meta.Node
	if err := tx.Where("id = ? AND owner_id = ? AND type = ? AND parent_id IS NULL AND deleted_at IS NULL",
		*legacyRoot.ParentID, source.OwnerID, meta.NodeTypeDir).Take(&ownerRoot).Error; err != nil {
		return blocked("legacy Source ancestry is not canonical")
	}
	syncRoot, err := ensureMigrationDirectory(tx, source.OwnerID, ownerRoot.ID, yikeTargetRootName)
	if err != nil {
		return err
	}
	syncConnector, err := ensureMigrationDirectory(tx, source.OwnerID, syncRoot.ID, yikeTargetConnectorName)
	if err != nil {
		return err
	}
	var owners int64
	if err := tx.Model(&meta.Source{}).
		Where("owner_id = ? AND id <> ? AND target_node_id IN ?",
			source.OwnerID, source.ID, []uint64{ownerRoot.ID, syncRoot.ID, syncConnector.ID}).
		Count(&owners).Error; err != nil {
		return err
	}
	if owners != 0 {
		return blocked("new Source ancestor is targeted by another Source")
	}
	var occupied int64
	if err := tx.Model(&meta.Node{}).
		Where("owner_id = ? AND parent_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL",
			source.OwnerID, syncConnector.ID, target.Name).
		Count(&occupied).Error; err != nil {
		return err
	}
	if occupied != 0 {
		return blocked("new managed target leaf is occupied")
	}
	parentID := syncConnector.ID
	next := meta.Node{OwnerID: source.OwnerID, ParentID: &parentID,
		Name: target.Name, Type: meta.NodeTypeDir, Revision: 1}
	if err := tx.Create(&next).Error; err != nil {
		return err
	}

	now := time.Now().UTC()
	for _, entry := range verified {
		child := entry.node
		moved := tx.Model(&meta.Node{}).
			Where("id = ? AND owner_id = ? AND parent_id = ? AND revision = ? AND deleted_at IS NULL",
				child.ID, source.OwnerID, target.ID, child.Revision).
			Updates(map[string]any{
				"parent_id": next.ID, "revision": gorm.Expr("revision + 1"), "updated_at": now,
			})
		if moved.Error != nil {
			return moved.Error
		}
		if moved.RowsAffected != 1 {
			return blocked("claimed child changed during split")
		}
		saved := tx.Model(&meta.SourceItem{}).
			Where("id = ? AND source_id = ? AND node_id = ? AND node_revision = ?",
				entry.item.ID, source.ID, child.ID, child.Revision).
			Updates(map[string]any{
				"node_revision": child.Revision + 1, "updated_at": now,
			})
		if saved.Error != nil {
			return saved.Error
		}
		if saved.RowsAffected != 1 {
			return blocked("SourceItem revision changed during split")
		}
	}
	updated := tx.Model(&meta.Source{}).
		Where("id = ? AND owner_id = ? AND revision = ? AND target_node_id = ?",
			source.ID, source.OwnerID, source.Revision, target.ID).
		Updates(map[string]any{
			"target_node_id": next.ID, "target_managed": true,
			"revision": gorm.Expr("revision + 1"), "last_error": "", "updated_at": now,
		})
	if updated.Error != nil {
		return updated.Error
	}
	if updated.RowsAffected != 1 {
		return blocked("Source binding changed during split")
	}
	// Share.NodeID, TokenHash, FileVersion and CAS never change here.
	return nil
}
