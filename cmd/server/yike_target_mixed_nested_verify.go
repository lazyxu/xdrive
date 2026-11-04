package main

import (
	"fmt"
	"sort"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const maxLegacyYikeNestedBranchNodes = 10000
const maxLegacyYikeNestedBranches = 64

type legacyYikeNestedNode struct {
	ID           uint64
	ParentID     *uint64
	Name         string
	Type         string
	Revision     uint64
	RelativePath string
	Depth        int
}

// listLegacyYikeNestedBranchTx returns an immutable tree inventory, not a list
// of candidates for unconditional movement. A branch is movable only when every
// active Node has a matching, synced SourceItem and every row remains unchanged
// after its transactional row lock is acquired.
func listLegacyYikeNestedBranchTx(tx *gorm.DB, source meta.Source, top meta.Node) ([]legacyYikeNestedNode, error) {
	var nodes []legacyYikeNestedNode
	err := tx.Raw(`
WITH RECURSIVE tree AS (
 SELECT id, parent_id, name, type, revision, name::text AS relative_path, 1 AS depth
 FROM xd_nodes WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
 UNION ALL
 SELECT n.id, n.parent_id, n.name, n.type, n.revision,
  tree.relative_path || '/' || n.name, tree.depth + 1
 FROM xd_nodes AS n JOIN tree ON n.parent_id = tree.id
 WHERE n.owner_id = ? AND n.deleted_at IS NULL AND tree.depth < 128
)
SELECT * FROM tree ORDER BY id LIMIT ?`, top.ID, source.OwnerID, source.OwnerID, maxLegacyYikeNestedBranchNodes+1).Scan(&nodes).Error
	if err != nil {
		return nil, err
	}
	if len(nodes) == 0 || len(nodes) > maxLegacyYikeNestedBranchNodes {
		return nil, fmt.Errorf("%w: nested legacy branch inventory exceeds safe bound", errLegacyYikeTargetMigrationBlocked)
	}
	return nodes, nil
}

func sameLegacyYikeNestedInventory(a, b []legacyYikeNestedNode) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i].ID != b[i].ID || a[i].Name != b[i].Name || a[i].Type != b[i].Type ||
			a[i].Revision != b[i].Revision || a[i].RelativePath != b[i].RelativePath ||
			a[i].Depth != b[i].Depth || a[i].ParentID == nil || b[i].ParentID == nil ||
			*a[i].ParentID != *b[i].ParentID {
			return false
		}
	}
	return true
}

// verifyLegacyYikeOwnedNestedBranchTx fails closed if *any* descendant is
// ordinary, untracked, modified, owned by another Source, or too deep. The
// entire tracked top-level directory may then move as one stable Node; all
// descendant NodeIDs, relative SourceItem paths, FileVersions and CAS stay put.
// Untracked sibling directories remain blocked by the caller rather than
// splitting a subtree whose ordinary Share/permission boundary is unknown.
func verifyLegacyYikeOwnedNestedBranchTx(
	tx *gorm.DB, source meta.Source, top meta.Node, items map[uint64]meta.SourceItem,
) ([]uint64, error) {
	blocked := func(reason string) ([]uint64, error) {
		return nil, fmt.Errorf("%w: %s", errLegacyYikeTargetMigrationBlocked, reason)
	}
	if top.Type != meta.NodeTypeDir || top.ParentID == nil || top.OwnerID != source.OwnerID {
		return blocked("nested legacy branch has invalid identity")
	}
	before, err := listLegacyYikeNestedBranchTx(tx, source, top)
	if err != nil {
		return nil, err
	}
	ids := make([]uint64, 0, len(before))
	seen := make(map[uint64]bool, len(before))
	for _, entry := range before {
		if entry.Depth >= 128 || entry.Revision == 0 ||
			(entry.Type != meta.NodeTypeDir && entry.Type != meta.NodeTypeFile) || seen[entry.ID] {
			return blocked("nested legacy branch is cyclic, too deep or invalid")
		}
		seen[entry.ID] = true
		ids = append(ids, entry.ID)
		item, ok := items[entry.ID]
		kind := meta.SourceItemKindFile
		if entry.Type == meta.NodeTypeDir {
			kind = meta.SourceItemKindDirectory
		}
		if !ok || item.State != meta.SourceItemStateSynced || item.Kind != kind ||
			item.Path != entry.RelativePath || item.NodeRevision != entry.Revision {
			return blocked("nested legacy branch contains unverified SourceItem/Node ownership")
		}
	}
	if len(before) == 0 || !seen[top.ID] {
		return blocked("nested legacy branch root is missing")
	}
	// Lock nodes in deterministic order; this also fences new children through
	// their directory parent's foreign-key lock until commit. Inventory is
	// scanned again after all locks to detect intervening moves and inserts.
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	for start := 0; start < len(ids); start += 512 {
		end := start + 512
		if end > len(ids) {
			end = len(ids)
		}
		var locked []meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("owner_id = ? AND deleted_at IS NULL AND id IN ?", source.OwnerID, ids[start:end]).
			Order("id ASC").Find(&locked).Error; err != nil {
			return nil, err
		}
		if len(locked) != end-start {
			return blocked("nested legacy branch changed before node locks")
		}
		// SourceItem state/path/revision are also decision inputs: freeze the
		// exact rows rather than accepting an obsolete pre-lock snapshot.
		var lockedItems []meta.SourceItem
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("source_id = ? AND node_id IN ?", source.ID, ids[start:end]).
			Order("id ASC").Find(&lockedItems).Error; err != nil {
			return nil, err
		}
		if len(lockedItems) != end-start {
			return blocked("nested legacy SourceItems changed before row locks")
		}
		for _, item := range lockedItems {
			old, ok := items[*item.NodeID]
			if !ok || old.ID != item.ID || old.State != item.State ||
				old.Kind != item.Kind || old.Path != item.Path ||
				old.NodeRevision != item.NodeRevision {
				return blocked("nested legacy SourceItem identity changed before locks")
			}
		}
	}
	after, err := listLegacyYikeNestedBranchTx(tx, source, top)
	if err != nil {
		return nil, err
	}
	if !sameLegacyYikeNestedInventory(before, after) {
		return blocked("nested legacy branch changed during ownership verification")
	}
	for start := 0; start < len(ids); start += 512 {
		end := start + 512
		if end > len(ids) {
			end = len(ids)
		}
		var foreign bool
		if err := tx.Raw(`SELECT EXISTS (
 SELECT 1 FROM xd_source_items WHERE source_id <> ? AND node_id IN ?
)`, source.ID, ids[start:end]).Scan(&foreign).Error; err != nil {
			return nil, err
		}
		if foreign {
			return blocked("another SourceItem claims a nested legacy child")
		}
	}
	return ids, nil
}
