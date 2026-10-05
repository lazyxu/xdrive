package api

import (
	"errors"
	"fmt"
	"sort"
	"time"

	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type mirrorDeletionCandidate struct {
	Item meta.SourceItem
	Node meta.Node
}

// advanceMirrorMissingEvidenceTx advances only reliable Mirror deletion evidence
// and moves eligible local nodes to xDrive trash. It must be called only after
// the run's final status is known to be completed and complete_inventory=true.
//
// Evidence is tied to the exact Source revision and SyncMode snapshot that began
// the run. A source edited while a run is active cannot delete anything.
func advanceMirrorMissingEvidenceTx(
	tx *gorm.DB,
	source meta.Source,
	run meta.SyncRun,
	missingItems []meta.SourceItem,
	now time.Time,
) (int64, error) {
	if tx == nil ||
		source.SyncMode != meta.SourceSyncModeMirror ||
		run.SyncMode != meta.SourceSyncModeMirror ||
		source.Revision != run.SourceRevision {
		return 0, nil
	}

	eligible := make(map[uint64]meta.SourceItem)
	for _, item := range missingItems {
		fullScans, since, ready := sourcepkg.AdvanceMirrorMissingEvidence(
			item.MirrorMissingFullScans,
			item.MirrorMissingSince,
			now,
		)
		if err := tx.Model(&meta.SourceItem{}).
			Where("id = ? AND source_id = ?", item.ID, source.ID).
			Updates(map[string]any{
				"mirror_missing_full_scans": fullScans,
				"mirror_missing_since":      since,
				"updated_at":                now,
			}).Error; err != nil {
			return 0, fmt.Errorf("advance mirror deletion evidence for item %d: %w", item.ID, err)
		}
		if !ready || item.NodeID == nil || item.NodeRevision == 0 {
			continue
		}
		item.MirrorMissingFullScans = fullScans
		item.MirrorMissingSince = &since
		eligible[*item.NodeID] = item
	}

	// Scan-only mode may collect reliable evidence but is intentionally
	// non-destructive. The next successful complete sync run can act on mature
	// evidence after re-validating all local Node state.
	if run.Mode != meta.SourceRunModeSync || len(eligible) == 0 || run.TargetNodeID == nil {
		return 0, nil
	}

	valid := make(map[uint64]mirrorDeletionCandidate)
	nodeIDs := make([]uint64, 0, len(eligible))
	for nodeID := range eligible {
		nodeIDs = append(nodeIDs, nodeID)
	}
	sort.Slice(nodeIDs, func(i, j int) bool { return nodeIDs[i] < nodeIDs[j] })

	for _, nodeID := range nodeIDs {
		item := eligible[nodeID]
		var node meta.Node
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND owner_id = ? AND deleted_at IS NULL", nodeID, source.OwnerID).
			First(&node).Error
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			continue
		case err != nil:
			return 0, err
		}
		// A local mutation since the Source last committed this Node blocks
		// automatic deletion. Mirror never wins over unsynchronized local work.
		if node.Revision != item.NodeRevision ||
			!sourceKindMatchesNodeType(item.Kind, node.Type) {
			continue
		}
		relativePath, inside, err := sourceNodePathWithinTarget(
			tx,
			source.OwnerID,
			node.ID,
			*run.TargetNodeID,
		)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				continue
			}
			return 0, err
		}
		if !inside || relativePath != item.Path {
			continue
		}
		valid[nodeID] = mirrorDeletionCandidate{Item: item, Node: node}
	}
	if len(valid) == 0 {
		return 0, nil
	}

	// If a missing ancestor from the same Source is no longer locally valid
	// (for example because the user restored or edited that directory), its
	// descendants inherit that protection. This prevents a restored directory
	// from having unchanged child revisions auto-trashed on the next scan.
	ancestorProtected := func(candidate mirrorDeletionCandidate) (bool, error) {
		parentID := candidate.Node.ParentID
		for depth := 0; parentID != nil && depth < 10000; depth++ {
			if run.TargetNodeID != nil && *parentID == *run.TargetNodeID {
				return false, nil
			}
			if _, trackedMissingAncestor := eligible[*parentID]; trackedMissingAncestor {
				if _, stillValid := valid[*parentID]; !stillValid {
					return true, nil
				}
			}
			var parent meta.Node
			if err := tx.Select("id", "parent_id").
				Where("id = ? AND owner_id = ? AND deleted_at IS NULL", *parentID, source.OwnerID).
				First(&parent).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return true, nil
				}
				return false, err
			}
			parentID = parent.ParentID
		}
		return parentID != nil, nil
	}

	// A directory can be an automatic trash root only if every active Node in
	// its subtree is independently eligible for this same Source. This prevents
	// a remote directory deletion from trashing user-created or other-Source
	// content nested below it.
	safe := make(map[uint64]mirrorDeletionCandidate)
	for nodeID, candidate := range valid {
		protected, err := ancestorProtected(candidate)
		if err != nil {
			return 0, err
		}
		if protected {
			continue
		}
		if candidate.Node.Type != meta.NodeTypeDir {
			safe[nodeID] = candidate
			continue
		}
		subtree, err := activeSubtreeIDsDB(tx, source.OwnerID, nodeID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				continue
			}
			return 0, err
		}
		allEligible := true
		for _, descendantID := range subtree {
			if _, ok := valid[descendantID]; !ok {
				allEligible = false
				break
			}
		}
		if allEligible {
			safe[nodeID] = candidate
		}
	}
	if len(safe) == 0 {
		return 0, nil
	}

	refs := make([]batchNodeRef, 0, len(safe))
	for _, candidate := range safe {
		refs = append(refs, batchNodeRef{
			ID:       candidate.Node.ID,
			Revision: candidate.Node.Revision,
		})
	}
	sort.Slice(refs, func(i, j int) bool { return refs[i].ID < refs[j].ID })
	topLevel, err := topLevelBatchDeleteRefs(tx, source.OwnerID, refs)
	if err != nil {
		return 0, err
	}

	trashedSourceItems := make(map[uint64]struct{})
	for _, ref := range topLevel {
		candidate, ok := safe[ref.ID]
		if !ok {
			continue
		}
		ids, err := trashMirrorSourceSubtreeTx(
			tx,
			source.OwnerID,
			candidate.Node,
			now,
		)
		if err != nil {
			return 0, err
		}
		if err := auditpkg.Record(tx, auditpkg.Event{
			Action:      auditpkg.ActionSourceMirrorTrash,
			TargetType:  "node",
			TargetID:    fmt.Sprintf("%d", candidate.Node.ID),
			TargetLabel: candidate.Node.Name,
			Result:      auditpkg.ResultSuccess,
			Metadata: map[string]any{
				"source_id":          source.ID,
				"run_id":             run.ID,
				"external_id":        candidate.Item.ExternalID,
				"remote_path":        candidate.Item.Path,
				"missing_full_scans": candidate.Item.MirrorMissingFullScans,
				"missing_since":      candidate.Item.MirrorMissingSince,
				"subtree_nodes":      len(ids),
			},
		}); err != nil {
			return 0, fmt.Errorf("record mirror trash audit: %w", err)
		}
		for _, id := range ids {
			if item, ok := eligible[id]; ok {
				trashedSourceItems[item.ID] = struct{}{}
			}
		}
	}
	return int64(len(trashedSourceItems)), nil
}

func trashMirrorSourceSubtreeTx(
	tx *gorm.DB,
	ownerID uint64,
	root meta.Node,
	now time.Time,
) ([]uint64, error) {
	if tx == nil || root.ID == 0 || root.ParentID == nil {
		return nil, errSourceExecutionConflict
	}
	ids, err := activeSubtreeIDsDB(tx, ownerID, root.ID)
	if err != nil {
		return nil, err
	}

	// Lock the complete active subtree before changing visibility.
	var locked []meta.Node
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id IN ? AND owner_id = ? AND deleted_at IS NULL", ids, ownerID).
		Order("id ASC").
		Find(&locked).Error; err != nil {
		return nil, err
	}
	if len(locked) != len(ids) {
		return nil, errSourceExecutionConflict
	}
	currentRootFound := false
	for _, node := range locked {
		if node.ID == root.ID {
			currentRootFound = true
			if node.Revision != root.Revision || node.ParentID == nil {
				return nil, errSourceExecutionConflict
			}
		}
	}
	if !currentRootFound {
		return nil, errSourceExecutionConflict
	}

	if err := tx.Model(&meta.Share{}).
		Where("node_id IN ? AND owner_id = ? AND revoked_at IS NULL", ids, ownerID).
		Update("revoked_at", &now).Error; err != nil {
		return nil, err
	}
	if err := tx.Model(&meta.Node{}).
		Where("id IN ? AND owner_id = ? AND deleted_at IS NULL", ids, ownerID).
		Updates(map[string]any{
			"deleted_at":    &now,
			"trash_root_id": root.ID,
		}).Error; err != nil {
		return nil, err
	}
	result := tx.Model(&meta.Node{}).
		Where("id = ? AND owner_id = ? AND revision = ?", root.ID, ownerID, root.Revision).
		Updates(map[string]any{
			"revision":   gorm.Expr("revision + 1"),
			"updated_at": now,
		})
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, errSourceExecutionConflict
	}
	return ids, nil
}
