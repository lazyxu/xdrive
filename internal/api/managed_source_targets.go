package api

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Managed Source target paths are derived from stable Node IDs. No complete
// cloud path is persisted in Source; SourceItem.Path remains source-relative.
const (
	managedSourceTopDirectory  = "同步文件夹"
	managedSourcePushDirectory = "设备备份"
	managedSourcePullDirectory = "远程拉取"
)

var errManagedTargetConflict = errors.New("managed Source target is occupied or inconsistent")

func managedSourceTargetLeaf(source meta.Source) (string, error) {
	if source.ID == 0 {
		return "", errManagedTargetConflict
	}
	suffix := " [s" + strconv.FormatUint(source.ID, 10) + "]"
	stem := sanitizeYikeTargetSegment(source.Name)
	if stem == "" {
		stem = "来源"
	}
	stem = truncateUTF8Bytes(stem, 255-len(suffix))
	name := stem + suffix
	if err := meta.ValidateName(name); err != nil {
		return "", fmt.Errorf("%w: invalid Source directory name", errManagedTargetConflict)
	}
	return name, nil
}

// The device label is organizational only, NEVER an identity or authorization
// proof. The owning SourceID and verified device credentials remain mandatory.
func managedSourceTargetCategories(source meta.Source, trustedDeviceName string) []string {
	if source.Direction == meta.SourceDirectionPush {
		kind := "NAS"
		if source.Kind == meta.SourceKindLocalFolder {
			kind = sanitizeYikeTargetSegment(trustedDeviceName)
			if kind == "" {
				kind = "设备"
			}
		}
		return []string{managedSourceTopDirectory, managedSourcePushDirectory, kind}
	}
	kind := "其他来源"
	switch source.Kind {
	case "synology_photos":
		kind = "Synology Photos"
	case "synology_files":
		kind = "Synology Files"
	case "yike_photos":
		kind = "一刻相册"
	}
	return []string{managedSourceTopDirectory, managedSourcePullDirectory, kind}
}

func managedSourceTargetParentTx(
	ctx context.Context, tx *gorm.DB, source meta.Source,
) (meta.Node, error) {
	if tx == nil || source.OwnerID == 0 || source.ID == 0 {
		return meta.Node{}, errManagedTargetConflict
	}
	var root meta.Node
	if err := tx.WithContext(ctx).Where(
		"owner_id = ? AND parent_id IS NULL AND type = ? AND deleted_at IS NULL",
		source.OwnerID, meta.NodeTypeDir,
	).First(&root).Error; err != nil {
		return meta.Node{}, fmt.Errorf("%w: no active Owner root: %v", errManagedTargetConflict, err)
	}
	deviceName := ""
	if source.Kind == meta.SourceKindLocalFolder && source.LocalCreatorDeviceID != nil {
		var device meta.ClientDevice
		if err := tx.WithContext(ctx).Where(
			"id = ? AND owner_id = ? AND revoked_at IS NULL",
			*source.LocalCreatorDeviceID, source.OwnerID,
		).First(&device).Error; err != nil {
			return meta.Node{}, fmt.Errorf("%w: creating device missing/revoked", errManagedTargetConflict)
		}
		deviceName = device.Name
	}
	current := root
	for _, name := range managedSourceTargetCategories(source, deviceName) {
		// Deterministic category directories can be reused. The Source leaf
		// below cannot be adopted from existing arbitrary user data.
		next, err := ensureOwnedChildDirectoryTx(ctx, tx, source.OwnerID, current.ID, name)
		if err != nil {
			return meta.Node{}, fmt.Errorf("%w: category %s: %v", errManagedTargetConflict, name, err)
		}
		current = next
	}
	return current, nil
}

// A new Source gets a fresh, exclusive real Node. The inserted Node and the
// Source.TargetNodeID update must be committed in the SAME transaction.
func createManagedSourceTargetTx(
	ctx context.Context, tx *gorm.DB, source meta.Source,
) (meta.Node, error) {
	if source.Kind == yikeSourceKind {
		// Yike's externally verified account UID is required first; its
		// specialized binding path handles target initialization.
		return meta.Node{}, errManagedTargetConflict
	}
	parent, err := managedSourceTargetParentTx(ctx, tx, source)
	if err != nil {
		return meta.Node{}, err
	}
	leaf, err := managedSourceTargetLeaf(source)
	if err != nil {
		return meta.Node{}, err
	}
	var existing meta.Node
	err = tx.WithContext(ctx).Where(
		"owner_id = ? AND parent_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL",
		source.OwnerID, parent.ID, leaf,
	).Take(&existing).Error
	switch {
	case err == nil:
		return meta.Node{}, errManagedTargetConflict
	case !errors.Is(err, gorm.ErrRecordNotFound):
		return meta.Node{}, err
	}
	target := meta.Node{
		OwnerID: source.OwnerID, ParentID: &parent.ID,
		Name: leaf, Type: meta.NodeTypeDir, Revision: 1,
	}
	if err := tx.WithContext(ctx).Create(&target).Error; err != nil {
		if isDuplicate(err) {
			return meta.Node{}, errManagedTargetConflict
		}
		return meta.Node{}, err
	}
	return target, nil
}

func bindCreatedManagedTargetTx(
	ctx context.Context, tx *gorm.DB, source *meta.Source,
) error {
	if source == nil || source.TargetNodeID != nil {
		return errManagedTargetConflict
	}
	target, err := createManagedSourceTargetTx(ctx, tx, *source)
	if err != nil {
		return err
	}
	if err := tx.WithContext(ctx).Model(&meta.Source{}).
		Where("id = ? AND owner_id = ? AND target_node_id IS NULL",
			source.ID, source.OwnerID).
		Update("target_node_id", target.ID).Error; err != nil {
		return err
	}
	source.TargetNodeID = &target.ID
	return nil
}

// canonicalManagedSourceTargetTx checks the actual ancestor Node identities
// without creating anything. Category names describe layout only; SourceID
// and TargetNodeID provide durable ownership, including renamed devices.
func canonicalManagedSourceTargetTx(
	ctx context.Context, tx *gorm.DB, source meta.Source,
) (bool, error) {
	if source.TargetNodeID == nil {
		return false, nil
	}
	var target meta.Node
	if err := tx.WithContext(ctx).Where(
		"id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
		*source.TargetNodeID, source.OwnerID, meta.NodeTypeDir,
	).First(&target).Error; err != nil {
		return false, err
	}
	if target.ParentID == nil {
		return false, nil
	}
	names := []string{managedSourceTopDirectory, managedSourcePullDirectory}
	if source.Direction == meta.SourceDirectionPush {
		names = []string{managedSourceTopDirectory, managedSourcePushDirectory}
	}
	currentID := *target.ParentID
	for index := len(names) - 1; index >= 0; index-- {
		// The last category (device or connector) is not part of names.
		if index == len(names)-1 {
			var category meta.Node
			if err := tx.WithContext(ctx).Where(
				"id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
				currentID, source.OwnerID, meta.NodeTypeDir,
			).First(&category).Error; err != nil {
				return false, err
			}
			if category.ParentID == nil {
				return false, nil
			}
			currentID = *category.ParentID
		}
		var parent meta.Node
		if err := tx.WithContext(ctx).Where(
			"id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			currentID, source.OwnerID, meta.NodeTypeDir,
		).First(&parent).Error; err != nil {
			return false, err
		}
		if parent.Name != names[index] {
			return false, nil
		}
		if parent.ParentID == nil {
			return false, nil
		}
		currentID = *parent.ParentID
	}
	return true, nil
}

// These writes intentionally never change SourceItem.Path, SourceItem.NodeID,
// any file content/CAS ref or a historical SyncRun's target snapshot.
func renameYikeManagedTargetTx(
	ctx context.Context, tx *gorm.DB, source meta.Source, newName string,
) error {
	if source.TargetNodeID == nil {
		return nil
	}
	var target meta.Node
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND owner_id = ? AND deleted_at IS NULL",
			*source.TargetNodeID, source.OwnerID).First(&target).Error; err != nil {
		return err
	}
	accountID, ok := managedYikeTargetAccountID(target.Name)
	if !ok || target.ParentID == nil {
		return errManagedTargetConflict
	}
	leaf, err := yikeManagedTargetLeaf(accountID, newName)
	if err != nil {
		return err
	}
	return renameManagedTargetLeafTx(ctx, tx, source.OwnerID, target, leaf)
}

func renameManagedTargetLeafTx(
	ctx context.Context, tx *gorm.DB, ownerID uint64, target meta.Node, leaf string,
) error {
	if target.Name == leaf {
		return nil
	}
	if target.ParentID == nil {
		return errManagedTargetConflict
	}
	var count int64
	if err := tx.WithContext(ctx).Model(&meta.Node{}).Where(
		"owner_id = ? AND parent_id = ? AND id <> ? AND deleted_at IS NULL AND lower(name) = lower(?)",
		ownerID, *target.ParentID, target.ID, leaf,
	).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return errManagedTargetConflict
	}
	result := tx.WithContext(ctx).Model(&meta.Node{}).Where(
		"id = ? AND owner_id = ? AND deleted_at IS NULL AND revision = ?",
		target.ID, ownerID, target.Revision,
	).Updates(map[string]any{
		"name": leaf, "revision": gorm.Expr("revision + 1"), "updated_at": time.Now().UTC(),
	})
	if result.Error != nil {
		if isDuplicate(result.Error) {
			return errManagedTargetConflict
		}
		return result.Error
	}
	if result.RowsAffected != 1 {
		return errManagedTargetConflict
	}
	return nil
}

// Only new canonical Source roots are renamed. Legacy mixed targets must be
// migrated before changing their real folder name, not renamed in-place.
func renameCanonicalManagedSourceTargetTx(
	ctx context.Context, tx *gorm.DB, source meta.Source, newSourceName string,
) error {
	if source.TargetNodeID == nil {
		return nil
	}
	if source.Kind == yikeSourceKind {
		return renameYikeManagedTargetTx(ctx, tx, source, newSourceName)
	}
	isCanonical, err := canonicalManagedSourceTargetTx(ctx, tx, source)
	if err != nil {
		return err
	}
	if !isCanonical {
		// The original mixed target must be migrated first, not arbitrarily
		// renamed and mistakenly converted to a managed ordinary directory.
		return nil
	}
	var target meta.Node
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND owner_id = ? AND deleted_at IS NULL",
			*source.TargetNodeID, source.OwnerID).First(&target).Error; err != nil {
		return err
	}
	renamed := source
	renamed.Name = newSourceName
	newName, err := managedSourceTargetLeaf(renamed)
	if err != nil {
		return err
	}
	return renameManagedTargetLeafTx(ctx, tx, source.OwnerID, target, newName)
}
