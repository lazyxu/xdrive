package maintenance

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	MediaDerivedRepairModeRebuild = "rebuild"
	MediaDerivedRepairModeDelete  = "delete"
)

type MediaDerivedRepairAction struct {
	OwnerID uint64   `json:"owner_id,omitempty"`
	NodeID  uint64   `json:"node_id"`
	Mode    string   `json:"mode"`
	Reasons []string `json:"reasons"`
	Applied bool     `json:"applied"`
}

var repairableMediaDerivedReasons = map[string]struct{}{
	"derived_resource_asset_identifier_mismatch": {},
	"derived_resource_file_missing":              {},
	"derived_resource_kind_invalid":              {},
	"derived_resource_metadata_missing":          {},
	"derived_resource_motion_kind_mismatch":      {},
	"derived_resource_node_deleted":              {},
	"derived_resource_node_missing":              {},
	"derived_resource_node_type_mismatch":        {},
	"derived_resource_owner_mismatch":            {},
	"derived_resource_parent_container_mismatch": {},
	"derived_resource_range_invalid":             {},
	"derived_resource_revision_stale":            {},
	"derived_resource_role_invalid":              {},
	"derived_resource_sha_stale":                 {},
	"derived_resource_still_kind_mismatch":       {},
	"livp_motion_resource_count_invalid":         {},
	"livp_resource_asset_identifier_mismatch":    {},
	"livp_resource_count_invalid":                {},
	"livp_still_resource_count_invalid":          {},
}

func planMediaDerivedRepairs(
	ctx context.Context,
	db *gorm.DB,
	issues []MediaIntegrityIssue,
) ([]MediaDerivedRepairAction, []MediaIntegrityIssue, error) {
	type pending struct {
		ownerID uint64
		nodeID  uint64
		reasons map[string]struct{}
	}
	byNode := make(map[uint64]*pending)
	skipped := make([]MediaIntegrityIssue, 0, len(issues))

	for _, issue := range issues {
		if _, ok := repairableMediaDerivedReasons[issue.Reason]; !ok || issue.NodeID == 0 {
			skipped = append(skipped, issue)
			continue
		}
		value := byNode[issue.NodeID]
		if value == nil {
			value = &pending{
				ownerID: issue.OwnerID,
				nodeID:  issue.NodeID,
				reasons: make(map[string]struct{}),
			}
			byNode[issue.NodeID] = value
		}
		if value.ownerID == 0 {
			value.ownerID = issue.OwnerID
		}
		value.reasons[issue.Reason] = struct{}{}
	}

	nodeIDs := make([]uint64, 0, len(byNode))
	for nodeID := range byNode {
		nodeIDs = append(nodeIDs, nodeID)
	}
	sort.Slice(nodeIDs, func(i, j int) bool { return nodeIDs[i] < nodeIDs[j] })

	actions := make([]MediaDerivedRepairAction, 0, len(nodeIDs))
	for _, nodeID := range nodeIDs {
		value := byNode[nodeID]
		action, ok, err := classifyMediaDerivedRepair(ctx, db, value.ownerID, nodeID)
		if err != nil {
			return nil, nil, err
		}
		if !ok {
			for _, issue := range issues {
				if issue.NodeID == nodeID {
					if _, repairable := repairableMediaDerivedReasons[issue.Reason]; repairable {
						skipped = append(skipped, issue)
					}
				}
			}
			continue
		}
		action.Reasons = make([]string, 0, len(value.reasons))
		for reason := range value.reasons {
			action.Reasons = append(action.Reasons, reason)
		}
		sort.Strings(action.Reasons)
		actions = append(actions, action)
	}
	sort.Slice(actions, func(i, j int) bool {
		if actions[i].OwnerID != actions[j].OwnerID {
			return actions[i].OwnerID < actions[j].OwnerID
		}
		return actions[i].NodeID < actions[j].NodeID
	})
	sortMediaIntegrityIssues(skipped)
	return actions, skipped, nil
}

func classifyMediaDerivedRepair(
	ctx context.Context,
	db *gorm.DB,
	fallbackOwnerID, nodeID uint64,
) (MediaDerivedRepairAction, bool, error) {
	action := MediaDerivedRepairAction{
		OwnerID: fallbackOwnerID,
		NodeID:  nodeID,
		Mode:    MediaDerivedRepairModeDelete,
	}
	if db == nil || nodeID == 0 {
		return action, false, nil
	}
	if ctx == nil {
		ctx = context.Background()
	}

	var node meta.Node
	err := db.WithContext(ctx).Where("id = ?", nodeID).First(&node).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		return action, true, nil
	case err != nil:
		return action, false, fmt.Errorf("load derived-resource node %d: %w", nodeID, err)
	}
	action.OwnerID = node.OwnerID
	if node.DeletedAt != nil || node.Type != meta.NodeTypeFile {
		return action, true, nil
	}

	var file meta.File
	err = db.WithContext(ctx).Where("node_id = ?", nodeID).First(&file).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		return action, true, nil
	case err != nil:
		return action, false, fmt.Errorf("load derived-resource file %d: %w", nodeID, err)
	}

	var row meta.MediaMetadata
	err = db.WithContext(ctx).Where("node_id = ?", nodeID).First(&row).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		return action, true, nil
	case err != nil:
		return action, false, fmt.Errorf("load derived-resource metadata %d: %w", nodeID, err)
	}
	if row.ContainerKind != mediapkg.ContainerKindLIVP {
		return action, true, nil
	}

	// A LIVP parent that is itself stale or invalid must be re-indexed first.
	// Derived repair must not conceal corruption in canonical MediaMetadata.
	if row.OwnerID != node.OwnerID ||
		row.NodeRevision != node.Revision ||
		!strings.EqualFold(strings.TrimSpace(row.SHA256), strings.TrimSpace(file.SHA256)) ||
		row.MediaKind != meta.MediaKindImage ||
		row.MIMEType != mediapkg.LIVPMIMEType ||
		row.IndexState != meta.MediaIndexStateReady ||
		strings.TrimSpace(row.LivePhotoAssetIdentifier) == "" ||
		row.DerivedResourceVersion < 1 {
		return action, false, nil
	}
	descriptor, err := mediapkg.ParseLIVPContainerDescriptor(row.ContainerJSON)
	if err != nil {
		return action, false, nil
	}
	if descriptor.AssetIdentifier != strings.TrimSpace(row.LivePhotoAssetIdentifier) {
		return action, false, nil
	}
	if !validLIVPDescriptorRanges(descriptor, file.Size) {
		return action, false, nil
	}

	action.Mode = MediaDerivedRepairModeRebuild
	return action, true, nil
}

func applyMediaDerivedRepair(
	ctx context.Context,
	db *gorm.DB,
	action MediaDerivedRepairAction,
) error {
	if db == nil {
		return fmt.Errorf("media derived repair database is unavailable")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	switch action.Mode {
	case MediaDerivedRepairModeDelete:
		return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			current, ok, err := classifyMediaDerivedRepair(
				ctx,
				tx,
				action.OwnerID,
				action.NodeID,
			)
			if err != nil {
				return err
			}
			if !ok || current.Mode != MediaDerivedRepairModeDelete {
				return fmt.Errorf(
					"derived-resource parent changed during delete repair for node %d",
					action.NodeID,
				)
			}
			return tx.Where("node_id = ?", action.NodeID).
				Delete(&meta.MediaDerivedResource{}).Error
		})
	case MediaDerivedRepairModeRebuild:
	default:
		return fmt.Errorf("unsupported media derived repair mode %q", action.Mode)
	}

	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var node meta.Node
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", action.NodeID).
			First(&node).Error; err != nil {
			return fmt.Errorf("lock derived-resource node %d: %w", action.NodeID, err)
		}
		var file meta.File
		if err := tx.Where("node_id = ?", action.NodeID).First(&file).Error; err != nil {
			return fmt.Errorf("load derived-resource file %d: %w", action.NodeID, err)
		}
		var row meta.MediaMetadata
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("node_id = ?", action.NodeID).
			First(&row).Error; err != nil {
			return fmt.Errorf("lock derived-resource metadata %d: %w", action.NodeID, err)
		}
		if node.OwnerID != action.OwnerID ||
			node.DeletedAt != nil ||
			node.Type != meta.NodeTypeFile ||
			row.OwnerID != node.OwnerID ||
			row.NodeRevision != node.Revision ||
			!strings.EqualFold(strings.TrimSpace(row.SHA256), strings.TrimSpace(file.SHA256)) ||
			row.MediaKind != meta.MediaKindImage ||
			row.MIMEType != mediapkg.LIVPMIMEType ||
			row.ContainerKind != mediapkg.ContainerKindLIVP ||
			row.IndexState != meta.MediaIndexStateReady ||
			row.DerivedResourceVersion < 1 {
			return fmt.Errorf("LIVP parent changed during derived-resource repair for node %d", action.NodeID)
		}

		descriptor, err := mediapkg.ParseLIVPContainerDescriptor(row.ContainerJSON)
		if err != nil {
			return fmt.Errorf("parse LIVP descriptor for node %d: %w", action.NodeID, err)
		}
		if descriptor.AssetIdentifier != strings.TrimSpace(row.LivePhotoAssetIdentifier) ||
			!validLIVPDescriptorRanges(descriptor, file.Size) {
			return fmt.Errorf("LIVP descriptor changed during derived-resource repair for node %d", action.NodeID)
		}

		now := time.Now().UTC()
		rows := []meta.MediaDerivedResource{
			{
				NodeID: action.NodeID, Role: meta.MediaDerivedResourceRoleStill,
				OwnerID: node.OwnerID, NodeRevision: node.Revision, SHA256: file.SHA256,
				Name: descriptor.Still.Name, MediaKind: meta.MediaKindImage,
				MIMEType: descriptor.Still.MIMEType, ByteOffset: descriptor.Still.Offset,
				ByteSize: descriptor.Still.Size, AssetIdentifier: descriptor.AssetIdentifier,
				CreatedAt: now, UpdatedAt: now,
			},
			{
				NodeID: action.NodeID, Role: meta.MediaDerivedResourceRoleMotion,
				OwnerID: node.OwnerID, NodeRevision: node.Revision, SHA256: file.SHA256,
				Name: descriptor.Motion.Name, MediaKind: meta.MediaKindVideo,
				MIMEType: descriptor.Motion.MIMEType, ByteOffset: descriptor.Motion.Offset,
				ByteSize: descriptor.Motion.Size, AssetIdentifier: descriptor.AssetIdentifier,
				CreatedAt: now, UpdatedAt: now,
			},
		}
		if err := tx.Where("node_id = ?", action.NodeID).
			Delete(&meta.MediaDerivedResource{}).Error; err != nil {
			return fmt.Errorf("clear stale derived resources for node %d: %w", action.NodeID, err)
		}
		if err := tx.Create(&rows).Error; err != nil {
			return fmt.Errorf("rebuild derived resources for node %d: %w", action.NodeID, err)
		}
		return nil
	})
}

func validLIVPDescriptorRanges(
	descriptor mediapkg.LIVPContainerDescriptor,
	fileSize int64,
) bool {
	resources := []mediapkg.LIVPContainerResourceDescriptor{
		descriptor.Still,
		descriptor.Motion,
	}
	for _, resource := range resources {
		if resource.Offset < 0 || resource.Size <= 0 ||
			resource.Offset > fileSize ||
			resource.Size > fileSize-resource.Offset {
			return false
		}
	}
	stillEnd := descriptor.Still.Offset + descriptor.Still.Size
	motionEnd := descriptor.Motion.Offset + descriptor.Motion.Size
	return stillEnd <= descriptor.Motion.Offset ||
		motionEnd <= descriptor.Still.Offset
}
