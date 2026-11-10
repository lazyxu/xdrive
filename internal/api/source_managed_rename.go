package api

import (
	"errors"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	errSourceTargetMigrationRequired = errors.New("source target is not a current managed destination")
	errSourceTargetNameConflict      = errors.New("managed source target name is occupied")
	errSourceTargetRenameActive      = errors.New("source has an active run; target rename is unsafe")
)

func ensureManagedSourceNameAvailableTx(tx *gorm.DB, source meta.Source, nextName string) error {
	var count int64
	if err := tx.Model(&meta.Source{}).
		Where("owner_id = ? AND direction = ? AND id <> ? AND lower(name) = lower(?)",
			source.OwnerID, source.Direction, source.ID, nextName).
		Count(&count).Error; err != nil {
		return err
	}
	if count != 0 {
		return errSourceTargetNameConflict
	}
	return nil
}

// A destination rename is refused while any run, active UploadSession, or
// uncommitted device operation can still settle against its stable TargetNodeID.
func requireSourceTargetRenameQuiescentTx(tx *gorm.DB, source meta.Source, target meta.Node) error {
	if source.RunRequestedAt != nil {
		return errSourceTargetRenameActive
	}
	var count int64
	if err := tx.Model(&meta.SyncRun{}).
		Where("source_id = ? AND status = ?", source.ID, meta.SyncRunStatusRunning).
		Count(&count).Error; err != nil {
		return err
	}
	if count != 0 {
		return errSourceTargetRenameActive
	}
	if tx.Migrator().HasTable(&meta.UploadSession{}) {
		if err := tx.Model(&meta.UploadSession{}).
			Where("owner_id = ? AND status = ? AND (source_id = ? OR source_target_id = ? OR source_run_id IN (SELECT id FROM xd_sync_runs WHERE source_id = ?))",
				source.OwnerID, "active", source.ID, target.ID, source.ID).
			Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return errSourceTargetRenameActive
		}
	}
	if tx.Migrator().HasTable(&meta.LocalPushCommonUploadOperation{}) {
		if err := tx.Model(&meta.LocalPushCommonUploadOperation{}).
			Where("owner_id = ? AND source_id = ? AND state IN ?",
				source.OwnerID, source.ID,
				[]string{"reserved", "bound"}).
			Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return errSourceTargetRenameActive
		}
	}
	if tx.Migrator().HasTable(&meta.LocalPushOperationIntent{}) {
		if err := tx.Model(&meta.LocalPushOperationIntent{}).
			Where("owner_id = ? AND source_id = ? AND state = ? AND expires_at > ?",
				source.OwnerID, source.ID, "reserved", time.Now().UTC()).
			Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return errSourceTargetRenameActive
		}
	}
	// A native Local Push may hold a staged original without an active
	// SourceRun, generic UploadSession or common Upload Operation. The device
	// cannot finish that original safely after a Source/Node rename changes
	// its Source revision. The Source row lock serializes this check against
	// Stage admission and transitions, which also lock the Source.
	if tx.Migrator().HasTable(&meta.LocalPushStaging{}) {
		if err := tx.Model(&meta.LocalPushStaging{}).
			Where("owner_id = ? AND source_id = ? AND status IN ? AND expires_at > ?",
				source.OwnerID, source.ID,
				[]string{localPushStageReserved, localPushStageWriting, localPushStageReady},
				time.Now().UTC()).Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return errSourceTargetRenameActive
		}
	}
	// A live quota reservation can survive a failed or cancelled Stage until
	// it is explicitly released, committed, or expires. Do not rename while
	// its unsettled original still holds Source/Target-bound capacity.
	if tx.Migrator().HasTable(&meta.LocalPushQuotaHold{}) {
		if err := tx.Model(&meta.LocalPushQuotaHold{}).
			Where("owner_id = ? AND source_id = ? AND released_at IS NULL AND committed_at IS NULL AND expires_at > ?",
				source.OwnerID, source.ID, time.Now().UTC()).Count(&count).Error; err != nil {
			return err
		}
		if count != 0 {
			return errSourceTargetRenameActive
		}
	}
	return nil
}

// Rename only current, server-provisioned Push/Pull targets. No old-layout
// directory adoption, relocation or uid_* compatibility is supported.
func renameManagedSourceTargetTx(tx *gorm.DB, source meta.Source, nextName string) error {
	if err := meta.ValidateName(nextName); err != nil {
		return errInvalidSourceConfig
	}
	if source.TargetNodeID == nil || !source.TargetManaged {
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
	// Every Source kind uses the same server-managed target provenance.

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

	if err := requireSourceTargetRenameQuiescentTx(tx, source, target); err != nil {
		return err
	}

	leaf := nextName
	if err := meta.ValidateName(leaf); err != nil {
		return errInvalidSourceConfig
	}
	if leaf == target.Name {
		return nil
	}
	if err := ensureManagedSourceNameAvailableTx(tx, source, nextName); err != nil {
		return err
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

// Accept only current canonical managed Push/Pull target ancestors.
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
		case meta.SourceKindLocalFolder, meta.SourceKindIOSPhotos, meta.SourceKindAndroidPhotos, synologySourceKind:
			if leafParent.Name == "Push" && namespace.Name == yikeTargetRootName {
				return []string{"Push", yikeTargetRootName}, nil
			}
		}
	case meta.SourceDirectionPull:
		var connector string
		switch source.Kind {
		case yikeSourceKind:
			connector = yikePullTargetConnectorName
		case synologySourceKind:
			connector = "Synology Photos"
		case synologyFilesSourceKind:
			connector = "Synology Files"
		}
		if connector != "" && leafParent.Name == connector &&
			namespace.Name == yikePullTargetRootName {
			return []string{connector, yikePullTargetRootName, yikeTargetRootName}, nil
		}
	}
	return nil, errSourceTargetMigrationRequired
}
