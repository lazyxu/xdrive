package main

import (
	"fmt"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// verifyLegacyYikeTargetOwnershipTx runs before an old uid_* root is
// reparented. The folder name and a matching account number do not prove
// ownership of arbitrary files already present under that folder.
//
// This deliberately does not try to split ambiguous trees: on uncertainty,
// the upgrade keeps every original Node, FileVersion, Share and CAS reference
// where it is, and the calling migration pauses the Source for a reviewed
// migration instead of silently moving ordinary files.
func verifyLegacyYikeTargetOwnershipTx(
	tx *gorm.DB,
	source meta.Source,
	legacyRoot, connector, target meta.Node,
) error {
	if source.ID == 0 || source.OwnerID == 0 || source.TargetNodeID == nil ||
		*source.TargetNodeID != target.ID || target.ID == 0 ||
		connector.ID == 0 || legacyRoot.ID == 0 ||
		target.OwnerID != source.OwnerID || connector.OwnerID != source.OwnerID ||
		legacyRoot.OwnerID != source.OwnerID {
		return fmt.Errorf("%w: inconsistent Source/Node ownership", errLegacyYikeTargetMigrationBlocked)
	}

	// Before reparenting an entire clean legacy root, freeze its exact
	// Node revision and check pending owner writers just as the mixed-root
	// splitter does. Being fully SourceItem-owned does not prove that a
	// previously created upload/queued Files operation is already finished.
	// The Source itself was FOR UPDATE locked by migrateLegacyYikeTargets.
	var currentTarget meta.Node
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			target.ID, source.OwnerID, meta.NodeTypeDir).
		Take(&currentTarget).Error; err != nil {
		return fmt.Errorf("%w: clean legacy target cannot be locked: %v", errLegacyYikeTargetMigrationBlocked, err)
	}
	if currentTarget.Revision != target.Revision || currentTarget.Name != target.Name ||
		currentTarget.ParentID == nil || target.ParentID == nil ||
		*currentTarget.ParentID != *target.ParentID {
		return fmt.Errorf("%w: clean legacy target changed before migration", errLegacyYikeTargetMigrationBlocked)
	}

	var pending int64
	if err := tx.Model(&meta.UploadSession{}).
		Where("owner_id = ? AND status = ? AND expires_at > ?",
			source.OwnerID, meta.UploadStatusActive, time.Now().UTC()).
		Count(&pending).Error; err != nil {
		return err
	}
	if pending != 0 {
		return fmt.Errorf("%w: an Owner upload is still active", errLegacyYikeTargetMigrationBlocked)
	}
	if err := tx.Model(&meta.FileOperation{}).
		Where("owner_id = ? AND status IN ?", source.OwnerID, []string{
			meta.FileOperationStatusQueued,
			meta.FileOperationStatusRunning,
			meta.FileOperationStatusCancelRequested,
		}).Count(&pending).Error; err != nil {
		return err
	}
	if pending != 0 {
		return fmt.Errorf("%w: an Owner Files operation is not terminal", errLegacyYikeTargetMigrationBlocked)
	}

	// Another Source bound to the old ancestor OR any of its descendants
	// cannot be silently detached by reparenting this root.
	var overlapping bool
	if err := tx.Raw(`
WITH RECURSIVE subtree AS (
	SELECT n.id FROM xd_nodes AS n
	WHERE n.id = ? AND n.owner_id = ? AND n.deleted_at IS NULL
	UNION
	SELECT child.id FROM xd_nodes AS child JOIN subtree AS parent ON child.parent_id = parent.id
	WHERE child.owner_id = ? AND child.deleted_at IS NULL
)
SELECT EXISTS (
	SELECT 1 FROM xd_sources AS other
	WHERE other.owner_id = ? AND other.id <> ?
	AND (
		other.target_node_id IN (?, ?)
		OR other.target_node_id IN (SELECT id FROM subtree)
	)
)`, target.ID, source.OwnerID, source.OwnerID,
		source.OwnerID, source.ID, connector.ID, legacyRoot.ID).
		Scan(&overlapping).Error; err != nil {
		return err
	}
	if overlapping {
		return fmt.Errorf("%w: another Source overlaps the legacy target tree", errLegacyYikeTargetMigrationBlocked)
	}

	var activeRun bool
	if err := tx.Raw(`
SELECT EXISTS (
	SELECT 1 FROM xd_sync_runs WHERE source_id = ? AND status = ?
)`, source.ID, meta.SyncRunStatusRunning).Scan(&activeRun).Error; err != nil {
		return err
	}
	if activeRun {
		return fmt.Errorf("%w: an active sync run still owns this target", errLegacyYikeTargetMigrationBlocked)
	}

	// Check every active descendant, including nested directories, WITHOUT
	// filtering by OwnerID. Historical cross-Owner edges can remain after
	// installing the NOT VALID parent/Owner FK; hiding them could falsely
	// certify an old root and allow unsafe in-place reparenting.
	// Every descendant must belong to the Source Owner, with a matching
	// SourceItem NodeID, relative path, type, sync state and Node revision.
	// Stop at 128 ancestors and refuse deeper paths, rather than silently
	// treating an unvisited descendant as proven.
	var unproven bool
	if err := tx.Raw(`
WITH RECURSIVE tree AS (
	SELECT id, parent_id, owner_id, name, type, revision,
		''::text AS relative_path, 0 AS depth
	FROM xd_nodes
	WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
	UNION ALL
	SELECT child.id, child.parent_id, child.owner_id, child.name, child.type, child.revision,
		CASE WHEN parent.depth = 0 THEN child.name
			ELSE parent.relative_path || '/' || child.name END,
		parent.depth + 1
	FROM xd_nodes AS child JOIN tree AS parent ON child.parent_id = parent.id
	WHERE child.deleted_at IS NULL AND parent.depth < 128
)
SELECT EXISTS (
	SELECT 1 FROM tree AS n
	LEFT JOIN xd_source_items AS item
		ON item.source_id = ? AND item.node_id = n.id
		AND item.path = n.relative_path
		AND item.kind = CASE WHEN n.type = 'dir' THEN 'directory' ELSE 'file' END
		AND item.state = ?
		AND item.node_revision = n.revision
	WHERE (n.depth > 0 AND (n.owner_id <> ? OR item.id IS NULL))
		OR (n.depth = 128 AND EXISTS (
			SELECT 1 FROM xd_nodes AS deeper
			WHERE deeper.parent_id = n.id AND deeper.deleted_at IS NULL
		))
)`, target.ID, source.OwnerID,
		source.ID, meta.SourceItemStateSynced, source.OwnerID).
		Scan(&unproven).Error; err != nil {
		return err
	}
	if unproven {
		return fmt.Errorf("%w: untracked, modified or mixed directory content", errLegacyYikeTargetMigrationBlocked)
	}
	return nil
}
