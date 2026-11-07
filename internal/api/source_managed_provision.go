package api

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

var (
	errSourceManagedDirectoryOccupied = errors.New("managed Source destination is occupied")
	errSourceManagedAncestorInUse     = errors.New("managed Source ancestor is targeted by another Source")
	errSourceManagedDeviceMismatch    = errors.New("managed Push Source device binding is invalid")
)

// provisionManagedSourceTargetTx is the single Server provisioning contract
// for every managed Push and Pull Source. Callers create the Source and invoke
// this function in the same transaction, after locking the Owner row. The
// device argument is mandatory for Push and must be nil for Pull.
func provisionManagedSourceTargetTx(
	ctx context.Context, tx *gorm.DB, source meta.Source, device *meta.ClientDevice,
) (meta.Node, error) {
	if tx == nil || source.ID == 0 || source.OwnerID == 0 || meta.ValidateName(source.Name) != nil {
		return meta.Node{}, errInvalidSourceConfig
	}

	segments := make([]string, 0, 3)
	switch source.Direction {
	case meta.SourceDirectionPush:
		if device == nil || device.ID == "" || device.OwnerID != source.OwnerID ||
			device.RevokedAt != nil || source.DeviceID == nil || *source.DeviceID != device.ID {
			return meta.Node{}, errSourceManagedDeviceMismatch
		}
		expectedPlatform := ""
		switch source.Kind {
		case meta.SourceKindLocalFolder:
			expectedPlatform = device.Platform
			if expectedPlatform != "windows" && expectedPlatform != "linux" && expectedPlatform != "darwin" {
				return meta.Node{}, errSourceManagedDeviceMismatch
			}
		case meta.SourceKindIOSPhotos:
			expectedPlatform = "ios"
		case synologySourceKind:
			expectedPlatform = "synology"
		case meta.SourceKindAndroidPhotos:
			expectedPlatform = "android"
		default:
			return meta.Node{}, errInvalidSourceConfig
		}
		if device.Platform != expectedPlatform {
			return meta.Node{}, errSourceManagedDeviceMismatch
		}
		if source.LocalCreatorDeviceID != nil && *source.LocalCreatorDeviceID != device.ID {
			return meta.Node{}, errSourceManagedDeviceMismatch
		}
		segments = []string{yikeTargetRootName, "Push"}

	case meta.SourceDirectionPull:
		if device != nil {
			return meta.Node{}, errInvalidSourceConfig
		}
		connector := ""
		switch source.Kind {
		case yikeSourceKind:
			connector = "Yike Photos"
		case synologySourceKind:
			connector = "Synology Photos"
		case synologyFilesSourceKind:
			connector = "Synology Files"
		default:
			return meta.Node{}, errInvalidSourceConfig
		}
		segments = []string{yikeTargetRootName, "Pull", connector}

	default:
		return meta.Node{}, errInvalidSourceConfig
	}

	var root meta.Node
	if err := tx.WithContext(ctx).
		Where("owner_id = ? AND parent_id IS NULL AND type = ? AND deleted_at IS NULL",
			source.OwnerID, meta.NodeTypeDir).
		Take(&root).Error; err != nil {
		return meta.Node{}, fmt.Errorf("load Owner root: %w", err)
	}

	parent := root
	ancestorIDs := []uint64{root.ID}
	for _, segment := range segments {
		child, err := ensureOwnedChildDirectoryTx(ctx, tx, source.OwnerID, parent.ID, segment)
		if err != nil {
			if errors.Is(err, errYikeTargetPathConflict) || isDuplicate(err) {
				return meta.Node{}, errSourceManagedDirectoryOccupied
			}
			return meta.Node{}, err
		}
		parent = child
		ancestorIDs = append(ancestorIDs, parent.ID)
	}

	if source.Direction == meta.SourceDirectionPush {
		// The device's display name is descriptive; its full UUID and
		// server-pinned group Node ID are the only stable group identity.
		// Never adopt a pre-existing ordinary folder with the same name.
		group, err := ensureManagedPushDeviceGroupTx(ctx, tx, source.OwnerID, parent, *device)
		if err != nil {
			return meta.Node{}, err
		}
		parent = group
		ancestorIDs = append(ancestorIDs, group.ID)
	}

	// A legacy or manually configured Source may target one of the fixed
	// ancestors. Never create a nested managed Source below another Source.
	var overlapping int64
	if err := tx.WithContext(ctx).Model(&meta.Source{}).
		Where("owner_id = ? AND id <> ? AND target_node_id IN ?",
			source.OwnerID, source.ID, ancestorIDs).
		Count(&overlapping).Error; err != nil {
		return meta.Node{}, err
	}
	if overlapping != 0 {
		return meta.Node{}, errSourceManagedAncestorInUse
	}

	// The final leaf is never adopted, even when it is an empty ordinary
	// directory with the expected name. Only this transaction may create it.
	var occupied meta.Node
	err := tx.WithContext(ctx).
		Where("owner_id = ? AND parent_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL",
			source.OwnerID, parent.ID, source.Name).
		Take(&occupied).Error
	if err == nil {
		return meta.Node{}, errSourceManagedDirectoryOccupied
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return meta.Node{}, err
	}

	parentID := parent.ID
	target := meta.Node{
		OwnerID: source.OwnerID, ParentID: &parentID,
		Name: source.Name, Type: meta.NodeTypeDir, Revision: 1,
	}
	if err := tx.WithContext(ctx).Create(&target).Error; err != nil {
		if isDuplicate(err) {
			return meta.Node{}, errSourceManagedDirectoryOccupied
		}
		return meta.Node{}, err
	}

	// Verify the actual Node ancestry, not a client path or a display name.
	verifiedAncestors, err := managedSourceTargetAncestorIDsTx(tx, source, target)
	if err != nil {
		return meta.Node{}, errSourceManagedAncestorInUse
	}
	verifiedAncestors = append(verifiedAncestors, target.ID)
	if err := tx.WithContext(ctx).Model(&meta.Source{}).
		Where("owner_id = ? AND id <> ? AND target_node_id IN ?",
			source.OwnerID, source.ID, verifiedAncestors).
		Count(&overlapping).Error; err != nil {
		return meta.Node{}, err
	}
	if overlapping != 0 {
		return meta.Node{}, errSourceManagedAncestorInUse
	}

	return target, nil
}

// managedPushDeviceFolderName is only a display label. Never authorize by name.
func managedPushDeviceFolderName(device meta.ClientDevice) string {
	return managedTargetSuggestion(device.Name, "设备") + "_" + device.ID
}

// ensureManagedPushDeviceGroupTx is called with the Owner and Device row
// already locked. The group is created with the first Source, or reused
// solely by the stable server-pinned Node ID.
func ensureManagedPushDeviceGroupTx(
	ctx context.Context, tx *gorm.DB, ownerID uint64, pushRoot meta.Node, device meta.ClientDevice,
) (meta.Node, error) {
	if device.OwnerID != ownerID || device.ID == "" || device.RevokedAt != nil {
		return meta.Node{}, errSourceManagedDeviceMismatch
	}
	if device.ManagedPushNodeID != nil {
		var existing meta.Node
		if err := tx.WithContext(ctx).Where(
			"id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
			*device.ManagedPushNodeID, ownerID, meta.NodeTypeDir,
		).Take(&existing).Error; err != nil {
			return meta.Node{}, errSourceManagedDirectoryOccupied
		}
		if existing.ParentID == nil || *existing.ParentID != pushRoot.ID ||
			!strings.HasSuffix(existing.Name, "_"+device.ID) {
			return meta.Node{}, errSourceManagedDeviceMismatch
		}
		return existing, nil
	}
	name := managedPushDeviceFolderName(device)
	if meta.ValidateName(name) != nil {
		return meta.Node{}, errInvalidSourceConfig
	}
	var occupied meta.Node
	err := tx.WithContext(ctx).Where(
		"owner_id = ? AND parent_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL",
		ownerID, pushRoot.ID, name,
	).Take(&occupied).Error
	if err == nil {
		return meta.Node{}, errSourceManagedDirectoryOccupied
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return meta.Node{}, err
	}
	parentID := pushRoot.ID
	group := meta.Node{
		OwnerID: ownerID, ParentID: &parentID, Name: name,
		Type: meta.NodeTypeDir, Revision: 1,
	}
	if err := tx.WithContext(ctx).Create(&group).Error; err != nil {
		if isDuplicate(err) {
			return meta.Node{}, errSourceManagedDirectoryOccupied
		}
		return meta.Node{}, err
	}
	updated := tx.WithContext(ctx).Model(&meta.ClientDevice{}).
		Where("id = ? AND owner_id = ? AND revoked_at IS NULL AND managed_push_node_id IS NULL",
			device.ID, ownerID).
		Update("managed_push_node_id", group.ID)
	if updated.Error != nil {
		return meta.Node{}, updated.Error
	}
	if updated.RowsAffected != 1 {
		return meta.Node{}, errSourceManagedDeviceMismatch
	}
	return group, nil
}

// Local Folder and iOS Photos use the same device-grouped Push namespace.
// Stable Device ID and group Node ID bind the ancestor across Sources.
func createLocalPushManagedTargetTx(
	ctx context.Context, tx *gorm.DB, source meta.Source, device meta.ClientDevice,
) (meta.Node, error) {
	if source.Direction != meta.SourceDirectionPush ||
		(source.Kind != meta.SourceKindLocalFolder && source.Kind != meta.SourceKindIOSPhotos) {
		return meta.Node{}, errInvalidSourceConfig
	}
	return provisionManagedSourceTargetTx(ctx, tx, source, &device)
}

// Historical DSM Push remains a compatibility path; the DSM MVP uses
// local_folder in its owning Agent. Any new device-scoped Push Source uses
// Push/<DeviceName>_<DeviceID>/<SourceName> without name-based authority.
func createSynologyPushManagedTargetTx(
	ctx context.Context, tx *gorm.DB, source meta.Source, device meta.ClientDevice,
) (meta.Node, error) {
	if source.Kind != synologySourceKind || source.Direction != meta.SourceDirectionPush {
		return meta.Node{}, errInvalidSourceConfig
	}
	return provisionManagedSourceTargetTx(ctx, tx, source, &device)
}

// All Server-executed Pull connectors share one provisioning contract.
func createSynologyPullManagedTargetTx(
	ctx context.Context, tx *gorm.DB, source meta.Source,
) (meta.Node, error) {
	if source.Direction != meta.SourceDirectionPull ||
		(source.Kind != synologySourceKind && source.Kind != synologyFilesSourceKind && source.Kind != yikeSourceKind) {
		return meta.Node{}, errInvalidSourceConfig
	}
	return provisionManagedSourceTargetTx(ctx, tx, source, nil)
}

// managedTargetSuggestion converts provider/device display names into a
// portable final folder segment. The caller supplies a stable fallback when
// the remote service does not publish a usable display name.
func managedTargetSuggestion(value, fallback string) string {
	name := sanitizeYikeTargetSegment(value)
	if name == "" || meta.ValidateName(name) != nil || !meta.ValidSourceName(name) {
		return fallback
	}
	return name
}
