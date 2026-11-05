package api

import (
	"context"
	"errors"
	"fmt"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// createSynologyPushManagedTargetTx creates a new DSM Photos Push target under
// the canonical Push/<device>/<source> namespace. Device display names are
// cosmetic; the stable ClientDevice UUID is the authorization identity.
func createSynologyPushManagedTargetTx(
	ctx context.Context, tx *gorm.DB, source meta.Source, device meta.ClientDevice,
) (meta.Node, error) {
	if source.Kind != synologySourceKind || source.Direction != meta.SourceDirectionPush ||
		source.OwnerID == 0 || device.OwnerID != source.OwnerID || device.Platform != "synology" ||
		device.RevokedAt != nil || source.DeviceID == nil || *source.DeviceID != device.ID ||
		meta.ValidateName(source.Name) != nil {
		return meta.Node{}, errInvalidSourceConfig
	}
	groupName, err := managedPushDeviceFolderName(device)
	if err != nil {
		return meta.Node{}, err
	}
	var root meta.Node
	if err := tx.WithContext(ctx).
		Where("owner_id = ? AND parent_id IS NULL AND type = ? AND deleted_at IS NULL",
			source.OwnerID, meta.NodeTypeDir).Take(&root).Error; err != nil {
		return meta.Node{}, fmt.Errorf("load Owner root: %w", err)
	}
	syncRoot, err := ensureManagedSourceDirectoryTx(ctx, tx, source.OwnerID, root.ID, yikeTargetRootName)
	if err != nil {
		return meta.Node{}, err
	}
	pushRoot, err := ensureManagedSourceDirectoryTx(ctx, tx, source.OwnerID, syncRoot.ID, "Push")
	if err != nil {
		return meta.Node{}, err
	}

	var group meta.Node
	err = tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("owner_id = ? AND parent_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL",
			source.OwnerID, pushRoot.ID, groupName).Take(&group).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		parentID := pushRoot.ID
		group = meta.Node{
			OwnerID: source.OwnerID, ParentID: &parentID, Name: groupName,
			Type: meta.NodeTypeDir, Revision: 1,
		}
		if err := tx.WithContext(ctx).Create(&group).Error; err != nil {
			if isDuplicate(err) {
				return meta.Node{}, errSourceManagedDirectoryOccupied
			}
			return meta.Node{}, err
		}
	case err != nil:
		return meta.Node{}, err
	default:
		if group.Type != meta.NodeTypeDir {
			return meta.Node{}, errSourceManagedDirectoryOccupied
		}
		var total, verified int64
		joins := tx.WithContext(ctx).Model(&meta.Source{}).
			Joins("JOIN xd_nodes AS n ON n.id = xd_sources.target_node_id").
			Where("xd_sources.owner_id = ? AND n.parent_id = ? AND n.deleted_at IS NULL",
				source.OwnerID, group.ID)
		if err := joins.Count(&total).Error; err != nil {
			return meta.Node{}, err
		}
		if total == 0 {
			return meta.Node{}, errSourceManagedDirectoryOccupied
		}
		if err := tx.WithContext(ctx).Model(&meta.Source{}).
			Joins("JOIN xd_nodes AS n ON n.id = xd_sources.target_node_id").
			Where("xd_sources.owner_id = ? AND n.parent_id = ? AND n.deleted_at IS NULL",
				source.OwnerID, group.ID).
			Where("xd_sources.direction = ? AND xd_sources.target_managed = TRUE AND (xd_sources.device_id = ? OR xd_sources.local_creator_device_id = ?)",
				meta.SourceDirectionPush, device.ID, device.ID).
			Count(&verified).Error; err != nil {
			return meta.Node{}, err
		}
		if verified != total {
			return meta.Node{}, errSourceManagedAncestorInUse
		}
	}

	ancestorIDs := []uint64{root.ID, syncRoot.ID, pushRoot.ID, group.ID}
	var overlapping int64
	if err := tx.WithContext(ctx).Model(&meta.Source{}).
		Where("owner_id = ? AND id <> ? AND target_node_id IN ?",
			source.OwnerID, source.ID, ancestorIDs).Count(&overlapping).Error; err != nil {
		return meta.Node{}, err
	}
	if overlapping != 0 {
		return meta.Node{}, errSourceManagedAncestorInUse
	}
	var conflicts int64
	if err := tx.WithContext(ctx).Model(&meta.Node{}).
		Where("owner_id = ? AND parent_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL",
			source.OwnerID, group.ID, source.Name).Count(&conflicts).Error; err != nil {
		return meta.Node{}, err
	}
	if conflicts != 0 {
		return meta.Node{}, errSourceManagedDirectoryOccupied
	}
	groupID := group.ID
	target := meta.Node{
		OwnerID: source.OwnerID, ParentID: &groupID, Name: source.Name,
		Type: meta.NodeTypeDir, Revision: 1,
	}
	if err := tx.WithContext(ctx).Create(&target).Error; err != nil {
		if isDuplicate(err) {
			return meta.Node{}, errSourceManagedDirectoryOccupied
		}
		return meta.Node{}, err
	}
	return target, nil
}


// ensureManagedSourceDirectoryTx creates a reserved Source namespace directory
// only when absent. An existing same-name folder is reusable only if it
// already contains at least one server-provisioned TargetManaged Source;
// ordinary user folders are never adopted by name alone.
func ensureManagedSourceDirectoryTx(
	ctx context.Context, tx *gorm.DB, ownerID, parentID uint64, name string,
) (meta.Node, error) {
	var existing meta.Node
	err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("owner_id = ? AND parent_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL",
			ownerID, parentID, name).
		First(&existing).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		parent := parentID
		created := meta.Node{
			OwnerID: ownerID, ParentID: &parent, Name: name,
			Type: meta.NodeTypeDir, Revision: 1,
		}
		if err := tx.WithContext(ctx).Create(&created).Error; err != nil {
			if isDuplicate(err) {
				return meta.Node{}, errSourceManagedDirectoryOccupied
			}
			return meta.Node{}, err
		}
		return created, nil
	case err != nil:
		return meta.Node{}, err
	}
	if existing.Type != meta.NodeTypeDir {
		return meta.Node{}, errSourceManagedDirectoryOccupied
	}
	var managedCount int64
	if err := tx.WithContext(ctx).Raw(`
WITH RECURSIVE descendants AS (
	SELECT id FROM xd_nodes WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
	UNION ALL
	SELECT child.id FROM xd_nodes AS child
	JOIN descendants AS parent ON child.parent_id = parent.id
	WHERE child.owner_id = ? AND child.deleted_at IS NULL
)
SELECT COUNT(*) FROM xd_sources AS source
JOIN descendants AS node ON node.id = source.target_node_id
WHERE source.owner_id = ? AND source.target_managed = TRUE`,
		existing.ID, ownerID, ownerID, ownerID).Scan(&managedCount).Error; err != nil {
		return meta.Node{}, err
	}
	if managedCount == 0 {
		return meta.Node{}, errSourceManagedDirectoryOccupied
	}
	return existing, nil
}
