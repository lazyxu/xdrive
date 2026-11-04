package api

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Canonical Push device groups have a stable device-ID suffix. The display
// prefix is cosmetic; it is never an ownership or authorization proof.
func managedPushDeviceFolderName(device meta.ClientDevice) (string, error) {
	parsed, err := uuid.Parse(device.ID)
	if err != nil {
		return "", errInvalidSourceConfig
	}
	ident := strings.ReplaceAll(parsed.String(), "-", "")
	label := sanitizeYikeTargetSegment(device.Name)
	if label == "" {
		label = "设备"
	}
	// Leave enough UTF-8 space for the 12-character stable ID suffix.
	label = truncateUTF8Bytes(label, 255-1-12)
	if meta.ValidateName(label) != nil {
		label = "设备"
	}
	name := label + "_" + ident[:12]
	if err := meta.ValidateName(name); err != nil {
		return "", errInvalidSourceConfig
	}
	return name, nil
}

func createLocalPushManagedTargetTx(
	ctx context.Context, tx *gorm.DB, source meta.Source, device meta.ClientDevice,
) (meta.Node, error) {
	if !(isLocalFolderPush(source) || source.Kind == meta.SourceKindIOSPhotos &&
		source.Direction == meta.SourceDirectionPush && device.Platform == "ios") ||
		source.LocalCreatorDeviceID == nil || *source.LocalCreatorDeviceID != device.ID ||
		source.OwnerID == 0 || device.OwnerID != source.OwnerID || device.RevokedAt != nil ||
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

	parent := root
	ancestorIDs := []uint64{root.ID}
	for _, segment := range []string{yikeTargetRootName, "设备备份"} {
		parent, err = ensureOwnedChildDirectoryTx(ctx, tx, source.OwnerID, parent.ID, segment)
		if err != nil {
			if errors.Is(err, errYikeTargetPathConflict) || isDuplicate(err) {
				return meta.Node{}, errSourceManagedDirectoryOccupied
			}
			return meta.Node{}, err
		}
		ancestorIDs = append(ancestorIDs, parent.ID)
	}

	// The same device may add several Sources. It may reuse its own previously
	// server-provisioned device group, but an unproven same-name user folder
	// must never be claimed (even if the name contains a UUID).
	var group meta.Node
	err = tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("owner_id = ? AND parent_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL",
			source.OwnerID, parent.ID, groupName).Take(&group).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		parentID := parent.ID
		group = meta.Node{OwnerID: source.OwnerID, ParentID: &parentID, Name: groupName,
			Type: meta.NodeTypeDir, Revision: 1}
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
			Where("xd_sources.kind IN ? AND xd_sources.direction = ? AND xd_sources.target_managed = TRUE AND xd_sources.local_creator_device_id = ?",
				[]string{meta.SourceKindLocalFolder, meta.SourceKindIOSPhotos}, meta.SourceDirectionPush, device.ID).
			Count(&verified).Error; err != nil {
			return meta.Node{}, err
		}
		if verified != total {
			return meta.Node{}, errSourceManagedAncestorInUse
		}
	}
	ancestorIDs = append(ancestorIDs, group.ID)
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
	target := meta.Node{OwnerID: source.OwnerID, ParentID: &groupID, Name: source.Name,
		Type: meta.NodeTypeDir, Revision: 1}
	if err := tx.WithContext(ctx).Create(&target).Error; err != nil {
		if isDuplicate(err) {
			return meta.Node{}, errSourceManagedDirectoryOccupied
		}
		return meta.Node{}, err
	}
	return target, nil
}
