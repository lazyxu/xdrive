package api

import (
	"context"
	"errors"
	"fmt"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

var (
	errSourceManagedDirectoryOccupied = errors.New("managed Source destination is occupied")
	errSourceManagedAncestorInUse     = errors.New("managed Source ancestor is targeted by another Source")
)

// createSynologyPullManagedTargetTx is only called inside the transaction
// creating a new Source. It does NOT claim a user-provided target_node_id.
// Ancestors may already exist as ordinary directories (and their legitimate
// read-only shares retain their real inheritance semantics); the leaf must
// always be newly created and exclusively owned by this Source.
func createSynologyPullManagedTargetTx(
	ctx context.Context, tx *gorm.DB, source meta.Source,
) (meta.Node, error) {
	if !isSynologyPullSource(source) {
		return meta.Node{}, errInvalidSourceConfig
	}
	if err := meta.ValidateName(source.Name); err != nil {
		return meta.Node{}, errInvalidSourceConfig
	}

	var root meta.Node
	if err := tx.WithContext(ctx).
		Where("owner_id = ? AND parent_id IS NULL AND type = ? AND deleted_at IS NULL",
			source.OwnerID, meta.NodeTypeDir).
		Take(&root).Error; err != nil {
		return meta.Node{}, fmt.Errorf("load owner root: %w", err)
	}
	connector := "Synology Photos"
	if source.Kind == synologyFilesSourceKind {
		connector = "Synology Files"
	}
	parent := root
	parentIDs := []uint64{root.ID}
	for _, name := range []string{yikeTargetRootName, "远程拉取", connector} {
		child, err := ensureOwnedChildDirectoryTx(ctx, tx, source.OwnerID, parent.ID, name)
		if err != nil {
			if errors.Is(err, errYikeTargetPathConflict) || isDuplicate(err) {
				return meta.Node{}, errSourceManagedDirectoryOccupied
			}
			return meta.Node{}, err
		}
		parent = child
		parentIDs = append(parentIDs, parent.ID)
	}

	// A manually selected legacy target at any ancestor would create an
	// overlapping Source subtree. Never silently nest our managed root there.
	var count int64
	if err := tx.WithContext(ctx).Model(&meta.Source{}).
		Where("owner_id = ? AND id <> ? AND target_node_id IN ?",
			source.OwnerID, source.ID, parentIDs).
		Count(&count).Error; err != nil {
		return meta.Node{}, err
	}
	if count != 0 {
		return meta.Node{}, errSourceManagedAncestorInUse
	}
	if err := tx.WithContext(ctx).Model(&meta.Node{}).
		Where("owner_id = ? AND parent_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL",
			source.OwnerID, parent.ID, source.Name).
		Count(&count).Error; err != nil {
		return meta.Node{}, err
	}
	if count != 0 {
		return meta.Node{}, errSourceManagedDirectoryOccupied
	}
	leafParentID := parent.ID
	target := meta.Node{
		OwnerID: source.OwnerID, ParentID: &leafParentID,
		Name: source.Name, Type: meta.NodeTypeDir, Revision: 1,
	}
	if err := tx.WithContext(ctx).Create(&target).Error; err != nil {
		if isDuplicate(err) {
			return meta.Node{}, errSourceManagedDirectoryOccupied
		}
		return meta.Node{}, err
	}
	return target, nil
}
