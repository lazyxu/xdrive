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

// Local Folder and iOS Photos use the same flat Push namespace. DeviceID is
// the authorization identity; the device's display name is only the default
// value of Source.Name and is never represented as a directory ancestor.
func createLocalPushManagedTargetTx(
	ctx context.Context, tx *gorm.DB, source meta.Source, device meta.ClientDevice,
) (meta.Node, error) {
	if source.Direction != meta.SourceDirectionPush ||
		(source.Kind != meta.SourceKindLocalFolder && source.Kind != meta.SourceKindIOSPhotos) {
		return meta.Node{}, errInvalidSourceConfig
	}
	return provisionManagedSourceTargetTx(ctx, tx, source, &device)
}

// DSM Push uses the same flat Push/<SourceName> namespace as every other
// device-backed Push Source. DeviceID and the persisted DSM Root proof carry
// identity and authorization; no device-named directory is created.
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
	name := sanitizeManagedTargetSegment(value)
	if name == "" || meta.ValidateName(name) != nil || !meta.ValidSourceName(name) {
		return fallback
	}
	return name
}

func sanitizeManagedTargetSegment(value string) string {
	value = strings.TrimSpace(value)
	var b strings.Builder
	for _, r := range value {
		switch {
		case r < 32:
			b.WriteRune('_')
		case strings.ContainsRune(`<>:"/\\|?*`, r):
			b.WriteRune('_')
		default:
			b.WriteRune(r)
		}
	}
	return strings.TrimRight(strings.TrimSpace(b.String()), " .")
}
