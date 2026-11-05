package api

import (
	"errors"
	"fmt"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	errSourceTargetMigrationRequired = errors.New("source target must be migrated before renaming")
	errSourceTargetNameConflict      = errors.New("managed source target name is occupied")
	errSourceTargetRenameActive      = errors.New("source has an active run; target rename is unsafe")
)

// renameManagedSourceTargetTx is part of PATCH /sources/:id's Source-locked
// transaction. Only a proven managed root may be renamed. A legacy Source may
// point at a user-owned mixed folder; renaming that folder is not authorized by
// the Source's display name. Its migration must establish exclusive ownership.
func renameManagedSourceTargetTx(tx *gorm.DB, source meta.Source, nextName string) error {
	if err := meta.ValidateName(nextName); err != nil {
		return errInvalidSourceConfig
	}
	if source.TargetNodeID == nil {
		// Yike's first, credential-validated target is bound later. In that
		// phase the leaf must be derived from the Source name, not nickname.
		if source.Kind == yikeSourceKind && source.Direction == meta.SourceDirectionPull {
			return nil
		}
		return errSourceTargetMigrationRequired
	}

	var target meta.Node
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			*source.TargetNodeID, source.OwnerID, meta.NodeTypeDir).
		Take(&target).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errSourceTargetMigrationRequired
		}
		return err
	}
	// Yike has a preexisting server-controlled target contract. Every other
	// Source needs explicit server-side management provenance; naming/path
	// resemblance must never turn a manually selected legacy folder into one.
	if !source.TargetManaged && source.Kind != yikeSourceKind {
		return errSourceTargetMigrationRequired
	}

	ancestors, err := managedSourceTargetAncestorIDsTx(tx, source, target)
	if err != nil {
		return err
	}
	// No other Source can own this root, its ancestors, or its descendants.
	var shared int64
	if err := tx.Model(&meta.Source{}).
		Where("owner_id = ? AND id <> ? AND target_node_id IN ?",
			source.OwnerID, source.ID, append(ancestors, target.ID)).
		Count(&shared).Error; err != nil {
		return err
	}
	if shared != 0 {
		return errSourceTargetMigrationRequired
	}
	if err := tx.Raw(`
WITH RECURSIVE descendants AS (
	SELECT id FROM xd_nodes WHERE id = ? AND owner_id = ? AND deleted_at IS NULL
	UNION ALL
	SELECT n.id FROM xd_nodes n JOIN descendants d ON n.parent_id = d.id
	WHERE n.owner_id = ? AND n.deleted_at IS NULL
)
SELECT COUNT(*) FROM xd_sources s JOIN descendants d ON s.target_node_id = d.id
WHERE s.owner_id = ? AND s.id <> ?`,
		target.ID, source.OwnerID, source.OwnerID, source.OwnerID, source.ID).
		Scan(&shared).Error; err != nil {
		return err
	}
	if shared != 0 {
		return errSourceTargetMigrationRequired
	}

	var running int64
	if err := tx.Model(&meta.SyncRun{}).
		Where("source_id = ? AND status = ?", source.ID, meta.SyncRunStatusRunning).
		Count(&running).Error; err != nil {
		return err
	}
	if running != 0 {
		return errSourceTargetRenameActive
	}

	leaf := nextName
	if source.Kind == yikeSourceKind {
		accountID, ok := managedYikeTargetAccountID(target.Name)
		if !ok {
			return errSourceTargetMigrationRequired
		}
		leaf = fmt.Sprintf("uid_%d_%s", accountID, nextName)
	}
	if err := meta.ValidateName(leaf); err != nil {
		return errInvalidSourceConfig
	}
	if leaf == target.Name {
		return nil
	}

	var collisions int64
	if err := tx.Model(&meta.Node{}).
		Where("owner_id = ? AND parent_id = ? AND id <> ? AND lower(name) = lower(?) AND deleted_at IS NULL",
			source.OwnerID, *target.ParentID, target.ID, leaf).
		Count(&collisions).Error; err != nil {
		return err
	}
	if collisions != 0 {
		return errSourceTargetNameConflict
	}
	changed := tx.Model(&meta.Node{}).
		Where("id = ? AND owner_id = ? AND revision = ? AND deleted_at IS NULL",
			target.ID, source.OwnerID, target.Revision).
		Updates(map[string]any{
			"name": leaf, "revision": gorm.Expr("revision + 1"), "updated_at": time.Now().UTC(),
		})
	if changed.Error != nil {
		if isDuplicate(changed.Error) {
			return errSourceTargetNameConflict
		}
		return changed.Error
	}
	if changed.RowsAffected != 1 {
		return errSourceTargetNameConflict
	}
	return nil
}

// Return all ancestor Node IDs after verifying the exact canonical hierarchy.
// A Source-created marker alone cannot authorize a rename outside that tree.
func managedSourceTargetAncestorIDsTx(tx *gorm.DB, source meta.Source, target meta.Node) ([]uint64, error) {
	names, err := managedSourceTargetAncestorNamesTx(tx, source, target)
	if err != nil {
		return nil, err
	}
	if target.ParentID == nil {
		return nil, errSourceTargetMigrationRequired
	}
	parentID := *target.ParentID
	ancestors := make([]uint64, 0, len(names)+1)
	for _, name := range names {
		var parent meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
				parentID, source.OwnerID, meta.NodeTypeDir).
			Take(&parent).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, errSourceTargetMigrationRequired
			}
			return nil, err
		}
		if name != "" && parent.Name != name {
			return nil, errSourceTargetMigrationRequired
		}
		if parent.ParentID == nil {
			return nil, errSourceTargetMigrationRequired
		}
		ancestors = append(ancestors, parent.ID)
		parentID = *parent.ParentID
	}
	var ownerRoot meta.Node
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("id = ? AND owner_id = ? AND type = ? AND parent_id IS NULL AND deleted_at IS NULL",
			parentID, source.OwnerID, meta.NodeTypeDir).
		Take(&ownerRoot).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errSourceTargetMigrationRequired
		}
		return nil, err
	}
	return append(ancestors, ownerRoot.ID), nil
}

// Select the exact accepted hierarchy from the real Node ancestors. The new
// Push/Pull namespaces are canonical; old prefixes remain readable for
// already-existing Sources, but no code moves those targets.
func managedSourceTargetAncestorNamesTx(tx *gorm.DB, source meta.Source, target meta.Node) ([]string, error) {
	if target.ParentID == nil {
		return nil, errSourceTargetMigrationRequired
	}
	var leafParent meta.Node
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			*target.ParentID, source.OwnerID, meta.NodeTypeDir).
		Take(&leafParent).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errSourceTargetMigrationRequired
		}
		return nil, err
	}
	if leafParent.ParentID == nil {
		return nil, errSourceTargetMigrationRequired
	}
	var namespace meta.Node
	if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			*leafParent.ParentID, source.OwnerID, meta.NodeTypeDir).
		Take(&namespace).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errSourceTargetMigrationRequired
		}
		return nil, err
	}

	switch source.Direction {
	case meta.SourceDirectionPush:
		switch source.Kind {
		case meta.SourceKindLocalFolder, meta.SourceKindIOSPhotos, synologySourceKind, "android_photos":
		default:
			return nil, errSourceTargetMigrationRequired
		}
		if namespace.Name != "Push" && namespace.Name != "设备备份" {
			return nil, errSourceTargetMigrationRequired
		}
		return []string{"", namespace.Name, yikeTargetRootName}, nil

	case meta.SourceDirectionPull:
		switch source.Kind {
		case yikeSourceKind:
			if leafParent.Name == "Yike Photos" && namespace.Name == "Pull" {
				return []string{"Yike Photos", "Pull", yikeTargetRootName}, nil
			}
			if leafParent.Name == yikeTargetConnectorName && namespace.Name == yikeTargetRootName {
				return []string{yikeTargetConnectorName, yikeTargetRootName}, nil
			}
		case synologySourceKind:
			if leafParent.Name == "Synology Photos" && (namespace.Name == "Pull" || namespace.Name == "远程拉取") {
				return []string{leafParent.Name, namespace.Name, yikeTargetRootName}, nil
			}
		case synologyFilesSourceKind:
			if leafParent.Name == "Synology Files" && (namespace.Name == "Pull" || namespace.Name == "远程拉取") {
				return []string{leafParent.Name, namespace.Name, yikeTargetRootName}, nil
			}
		}
	}
	return nil, errSourceTargetMigrationRequired
}
