package api

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
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

// Only new canonical Source roots are renamed. Legacy mixed targets must be
// migrated before changing their real folder name, not renamed in-place.
func renameCanonicalManagedSourceTargetTx(
	ctx context.Context, tx *gorm.DB, source meta.Source, newSourceName string,
) error {
	if source.TargetNodeID == nil || source.Kind == yikeSourceKind {
		return nil
	}
	parent, err := managedSourceTargetParentTx(ctx, tx, source)
	if err != nil {
		return err
	}
	var target meta.Node
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ? AND owner_id = ? AND deleted_at IS NULL",
			*source.TargetNodeID, source.OwnerID).
		Take(&target).Error; err != nil {
		return err
	}
	if target.ParentID == nil || *target.ParentID != parent.ID {
		// Legacy location. The startup migration owns relocation and can
		// report conflicts. Do not rename a mixed ordinary directory here.
		return nil
	}
	renamed := source
	renamed.Name = newSourceName
	newName, err := managedSourceTargetLeaf(renamed)
	if err != nil {
		return err
	}
	if strings.EqualFold(target.Name, newName) && target.Name == newName {
		return nil
	}
	var conflicts int64
	if err := tx.WithContext(ctx).Model(&meta.Node{}).
		Where("owner_id = ? AND parent_id = ? AND id <> ? AND deleted_at IS NULL AND lower(name) = lower(?)",
			source.OwnerID, parent.ID, target.ID, newName).
		Count(&conflicts).Error; err != nil {
		return err
	}
	if conflicts != 0 {
		return errManagedTargetConflict
	}
	now := time.Now().UTC()
	return tx.WithContext(ctx).Model(&meta.Node{}).
		Where("id = ? AND owner_id = ? AND deleted_at IS NULL", target.ID, source.OwnerID).
		Updates(map[string]any{
			"name": newName,
			"revision": gorm.Expr("revision + 1"),
			"updated_at": now,
		}).Error
}
