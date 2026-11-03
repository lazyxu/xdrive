package api

import (
	"context"
	"fmt"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// The legacy Yike credential-refresh path can reparent a populated uid_*
// directory. Before doing so, prove that the entire active subtree belongs to
// the current Source. A stable UID-like folder name alone is not proof.
//
// This is also a concurrency barrier for Sources sharing an ancestor. The
// outer credential transaction must hold the current Source row's lock.
func verifyYikeTargetRelocationTx(
	ctx context.Context, tx *gorm.DB, source meta.Source, target meta.Node,
) error {
	if source.TargetNodeID == nil || *source.TargetNodeID != target.ID ||
		source.OwnerID == 0 || target.OwnerID != source.OwnerID || target.ParentID == nil {
		return errYikeTargetContainsData
	}

	var overlap bool
	if err := tx.WithContext(ctx).Raw(`
WITH RECURSIVE ancestors AS (
	SELECT id, parent_id FROM xd_nodes
	WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
	UNION
	SELECT n.id, n.parent_id
	FROM xd_nodes AS n JOIN ancestors AS p ON n.id = p.parent_id
	WHERE n.owner_id = ? AND n.deleted_at IS NULL
),
descendants AS (
	SELECT id FROM xd_nodes
	WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
	UNION
	SELECT n.id FROM xd_nodes AS n JOIN descendants AS p ON n.parent_id = p.id
	WHERE n.owner_id = ? AND n.deleted_at IS NULL
)
SELECT EXISTS (
	SELECT 1 FROM xd_sources AS other
	WHERE other.owner_id = ? AND other.id <> ?
	AND other.target_node_id IN (
		SELECT id FROM ancestors UNION SELECT id FROM descendants
	)
)`, target.ID, source.OwnerID, source.OwnerID,
		target.ID, source.OwnerID, source.OwnerID,
		source.OwnerID, source.ID).
		Scan(&overlap).Error; err != nil {
		return err
	}
	if overlap {
		return fmt.Errorf("%w: overlapping Source target", errYikeTargetContainsData)
	}

	var running bool
	if err := tx.WithContext(ctx).Raw(
		"SELECT EXISTS (SELECT 1 FROM xd_sync_runs WHERE source_id = ? AND status = ?)",
		source.ID, meta.SyncRunStatusRunning,
	).Scan(&running).Error; err != nil {
		return err
	}
	if running {
		return fmt.Errorf("%w: Source still has a running sync", errYikeTargetContainsData)
	}

	var unknown bool
	if err := tx.WithContext(ctx).Raw(`
WITH RECURSIVE tree AS (
	SELECT id, parent_id, name, type, revision,
		''::text AS relative_path, 0 AS depth
	FROM xd_nodes
	WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
	UNION ALL
	SELECT child.id, child.parent_id, child.name, child.type, child.revision,
		CASE WHEN parent.depth = 0 THEN child.name
			ELSE parent.relative_path || '/' || child.name END,
		parent.depth + 1
	FROM xd_nodes AS child JOIN tree AS parent ON child.parent_id = parent.id
	WHERE child.owner_id = ? AND child.deleted_at IS NULL AND parent.depth < 128
)
SELECT EXISTS (
	SELECT 1 FROM tree AS node
	LEFT JOIN xd_source_items AS item
		ON item.source_id = ? AND item.node_id = node.id
		AND item.path = node.relative_path
		AND item.kind = CASE WHEN node.type = 'dir' THEN 'directory' ELSE 'file' END
		AND item.state = ? AND item.node_revision = node.revision
	WHERE (node.depth > 0 AND item.id IS NULL)
		OR (node.depth = 128 AND EXISTS (
			SELECT 1 FROM xd_nodes AS deeper
			WHERE deeper.parent_id = node.id AND deeper.owner_id = ?
				AND deeper.deleted_at IS NULL
		))
)`, target.ID, source.OwnerID, source.OwnerID,
		source.ID, meta.SourceItemStateSynced, source.OwnerID).
		Scan(&unknown).Error; err != nil {
		return err
	}
	if unknown {
		return fmt.Errorf("%w: legacy target includes unverified user content", errYikeTargetContainsData)
	}
	return nil
}
