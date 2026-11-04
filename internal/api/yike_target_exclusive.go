package api

import (
	"context"
	"errors"
	"fmt"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// createExclusiveYikeManagedTargetTx is the first-bind path only. Unlike the
// legacy fixture helper, it MUST NOT claim an existing directory, even when
// that directory is empty and happens to have a uid_* name.
func createExclusiveYikeManagedTargetTx(
	ctx context.Context, tx *gorm.DB, source meta.Source, identity sourceCredentialTestDTO,
) (meta.Node, error) {
	accountID, err := yikeAccountID(identity)
	if err != nil {
		return meta.Node{}, err
	}
	leaf, err := yikeManagedTargetLeaf(accountID, identity.AccountName)
	if err != nil {
		return meta.Node{}, err
	}
	parent, err := ensureYikeManagedParentTx(ctx, tx, source.OwnerID)
	if err != nil {
		return meta.Node{}, err
	}

	var existing meta.Node
	err = tx.WithContext(ctx).Where(
		"owner_id = ? AND parent_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL",
		source.OwnerID, parent.ID, leaf,
	).Take(&existing).Error
	if err == nil {
		var otherYike int64
		if err := tx.WithContext(ctx).Model(&meta.Source{}).
			Where("owner_id = ? AND id <> ? AND kind = ? AND target_node_id = ?",
				source.OwnerID, source.ID, yikeSourceKind, existing.ID).
			Count(&otherYike).Error; err != nil {
			return meta.Node{}, err
		}
		if otherYike != 0 {
			return meta.Node{}, errYikeAccountAlreadyConfigured
		}
		if existing.Type != meta.NodeTypeDir {
			return meta.Node{}, errYikeTargetPathConflict
		}
		var children int64
		if err := tx.WithContext(ctx).Model(&meta.Node{}).
			Where("owner_id = ? AND parent_id = ? AND deleted_at IS NULL",
				source.OwnerID, existing.ID).
			Count(&children).Error; err != nil {
			return meta.Node{}, err
		}
		if children != 0 {
			return meta.Node{}, errYikeTargetContainsData
		}
		// Even an empty ordinary folder can carry direct Shares, favorites,
		// user expectations, or be concurrently filled. Never take it over.
		return meta.Node{}, errYikeTargetPathConflict
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return meta.Node{}, err
	}

	parentID := parent.ID
	target := meta.Node{
		OwnerID: source.OwnerID, ParentID: &parentID,
		Name: leaf, Type: meta.NodeTypeDir, Revision: 1,
	}
	// No "on conflict read existing" fallback. A concurrent normal Files
	// mkdir winning the same unique name must cause the whole bind to fail.
	if err := tx.WithContext(ctx).Create(&target).Error; err != nil {
		if isDuplicate(err) {
			return meta.Node{}, errYikeTargetPathConflict
		}
		return meta.Node{}, err
	}
	ancestors, err := managedSourceTargetAncestorIDsTx(tx, source, target)
	if err != nil {
		return meta.Node{}, errYikeTargetPathConflict
	}
	var conflictingSource int64
	if err := tx.WithContext(ctx).Model(&meta.Source{}).
		Where("owner_id = ? AND id <> ? AND target_node_id IN ?",
			source.OwnerID, source.ID, append(ancestors, target.ID)).
		Count(&conflictingSource).Error; err != nil {
		return meta.Node{}, err
	}
	if conflictingSource != 0 {
		return meta.Node{}, errYikeTargetPathConflict
	}
	return target, nil
}

// verifiedLegacyYikeTargetLocationTx only recognizes the prior server-owned
// layout /来源/一刻相册/uid_*. A uid_-looking ordinary folder in another
// directory cannot be moved merely because its descendants are empty.
func verifiedLegacyYikeTargetLocationTx(
	ctx context.Context, tx *gorm.DB, source meta.Source, target meta.Node,
) (bool, error) {
	if target.ParentID == nil || target.OwnerID != source.OwnerID {
		return false, nil
	}
	var connector meta.Node
	err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "SHARE"}).
		Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			*target.ParentID, source.OwnerID, meta.NodeTypeDir).
		Take(&connector).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if connector.Name != yikeTargetConnectorName || connector.ParentID == nil {
		return false, nil
	}
	var legacyRoot meta.Node
	err = tx.WithContext(ctx).Clauses(clause.Locking{Strength: "SHARE"}).
		Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			*connector.ParentID, source.OwnerID, meta.NodeTypeDir).
		Take(&legacyRoot).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if legacyRoot.Name != yikeLegacyTargetRootName || legacyRoot.ParentID == nil {
		return false, nil
	}
	var ownerRoot meta.Node
	err = tx.WithContext(ctx).Clauses(clause.Locking{Strength: "SHARE"}).
		Where("id = ? AND owner_id = ? AND type = ? AND parent_id IS NULL AND deleted_at IS NULL",
			*legacyRoot.ParentID, source.OwnerID, meta.NodeTypeDir).
		Take(&ownerRoot).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if ownerRoot.ID == 0 {
		return false, fmt.Errorf("invalid owner root")
	}
	return true, nil
}
