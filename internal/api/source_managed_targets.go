package api

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	errManagedTargetUnavailable = errors.New("managed source target unavailable")
	errManagedTargetOccupied    = errors.New("managed source target already occupied")
)

const (
	managedSyncRoot       = "同步文件夹"
	managedPushRoot       = "设备备份"
	managedPullRoot       = "远程拉取"
	managedTargetNameSize = 255
)

// Source.Name is a user-facing label, not a persisted absolute path. A target
// directory receives a stable, unique leaf name when the Source is created.
// Later renaming Source.Name MUST NOT rename this Node (decision 5A).
func managedTargetLeaf(source meta.Source) string {
	suffix := fmt.Sprintf(" [s%d]", source.ID)
	name := strings.TrimSpace(sanitizeYikeTargetSegment(source.Name))
	if name == "" {
		name = "来源"
	}
	name = truncateUTF8Bytes(name, managedTargetNameSize-len([]byte(suffix)))
	return name + suffix
}

func managedTargetDeviceLeaf(device meta.ClientDevice) string {
	name := strings.TrimSpace(sanitizeYikeTargetSegment(device.Name))
	if name == "" {
		name = "设备"
	}
	id := strings.ReplaceAll(device.ID, "-", "")
	if len(id) > 12 {
		id = id[:12]
	}
	suffix := " [" + id + "]"
	name = truncateUTF8Bytes(name, managedTargetNameSize-len([]byte(suffix)))
	return name + suffix
}

func managedTargetCategory(source meta.Source) string {
	switch source.Kind {
	case synologySourceKind:
		return "Synology Photos"
	case synologyFilesSourceKind:
		return "Synology Files"
	default:
		// ValidSourceKind is restricted to lowercase ASCII identifier chars.
		return source.Kind
	}
}

// managedTargetParentTx ensures only the system-owned grouping directories.
// It deliberately never claims an existing user directory as the Source leaf.
func managedTargetParentTx(
	ctx context.Context, tx *gorm.DB, source meta.Source, device *meta.ClientDevice,
) (meta.Node, error) {
	if tx == nil || source.OwnerID == 0 || source.ID == 0 {
		return meta.Node{}, errManagedTargetUnavailable
	}
	var ownerRoot meta.Node
	if err := tx.WithContext(ctx).Where(
		"owner_id = ? AND parent_id IS NULL AND type = ? AND deleted_at IS NULL",
		source.OwnerID, meta.NodeTypeDir,
	).Take(&ownerRoot).Error; err != nil {
		return meta.Node{}, err
	}
	parts := []string{managedSyncRoot}
	switch source.Direction {
	case meta.SourceDirectionPush:
		parts = append(parts, managedPushRoot)
		if source.Kind == meta.SourceKindLocalFolder {
			if device == nil || device.OwnerID != source.OwnerID {
				return meta.Node{}, errManagedTargetUnavailable
			}
			parts = append(parts, managedTargetDeviceLeaf(*device))
		} else {
			parts = append(parts, managedTargetCategory(source))
		}
	case meta.SourceDirectionPull:
		parts = append(parts, managedPullRoot, managedTargetCategory(source))
	default:
		return meta.Node{}, errManagedTargetUnavailable
	}
	parent := ownerRoot
	for _, name := range parts {
		node, err := ensureOwnedChildDirectoryTx(ctx, tx, source.OwnerID, parent.ID, name)
		if err != nil {
			return meta.Node{}, err
		}
		parent = node
	}
	return parent, nil
}

// createManagedSourceTargetTx is invoked in the same DB transaction as the new
// Source insert. A pre-existing leaf is NOT adopted, even if empty, because
// its owner-visible identity and Shares may predate this Source.
func createManagedSourceTargetTx(
	ctx context.Context, tx *gorm.DB, source *meta.Source, device *meta.ClientDevice,
) error {
	if source == nil || source.ID == 0 || source.TargetNodeID != nil ||
		source.Kind == yikeSourceKind {
		return errManagedTargetUnavailable
	}
	parent, err := managedTargetParentTx(ctx, tx, *source, device)
	if err != nil {
		return err
	}
	name := managedTargetLeaf(*source)
	if err := meta.ValidateName(name); err != nil {
		return err
	}
	var existing meta.Node
	err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("owner_id = ? AND parent_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL",
			source.OwnerID, parent.ID, name).Take(&existing).Error
	if err == nil {
		return errManagedTargetOccupied
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	target := meta.Node{
		OwnerID: source.OwnerID, ParentID: &parent.ID,
		Name: name, Type: meta.NodeTypeDir, Revision: 1,
	}
	if err := tx.WithContext(ctx).Create(&target).Error; err != nil {
		return err
	}
	result := tx.Model(&meta.Source{}).Where(
		"id = ? AND owner_id = ? AND target_node_id IS NULL",
		source.ID, source.OwnerID,
	).Updates(map[string]any{
		"target_node_id": target.ID,
		"updated_at":     time.Now().UTC(),
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return errManagedTargetUnavailable
	}
	source.TargetNodeID = &target.ID
	return nil
}

// managedSourceTargetsInSubtreeTx prevents moving/deleting a directory that
// contains ANY active managed Source root. It applies to every Push/Pull
// connector, not only the historical Yike-specific guard.
func managedSourceTargetsInSubtreeTx(
	ctx context.Context, tx *gorm.DB, ownerID, nodeID uint64,
) (bool, error) {
	if tx == nil || ownerID == 0 || nodeID == 0 {
		return false, errManagedTargetUnavailable
	}
	if !tx.Migrator().HasTable(&meta.Source{}) {
		return false, nil
	}
	var count int64
	err := tx.WithContext(ctx).Raw(
		"WITH RECURSIVE descendants AS ("+
			" SELECT id FROM xd_nodes WHERE id = ? AND owner_id = ? AND deleted_at IS NULL"+
			" UNION ALL SELECT n.id FROM xd_nodes n JOIN descendants d ON n.parent_id = d.id"+
			" WHERE n.owner_id = ? AND n.deleted_at IS NULL"+
			") SELECT COUNT(*) FROM xd_sources s JOIN descendants d ON d.id = s.target_node_id"+
			" WHERE s.owner_id = ? AND s.status <> ?",
		nodeID, ownerID, ownerID, ownerID, meta.SourceStatusArchived,
	).Scan(&count).Error
	return count > 0, err
}
