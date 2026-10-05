package maintenance

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/mediagroup"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photoasset"
	"gorm.io/gorm"
)

type MediaRepairAction struct {
	OwnerID    uint64   `json:"owner_id,omitempty"`
	NodeID     uint64   `json:"node_id"`
	StorageKey string   `json:"storage_key,omitempty"`
	Reasons    []string `json:"reasons"`
	Applied    bool     `json:"applied"`
}

type MediaRelationRepairAction struct {
	OwnerID  uint64   `json:"owner_id"`
	GroupIDs []uint64 `json:"group_ids,omitempty"`
	Reasons  []string `json:"reasons"`
	Applied  bool     `json:"applied"`
}

type MediaRepairReport struct {
	DryRun          bool                        `json:"dry_run"`
	Before          MediaVerifyReport           `json:"before"`
	After           MediaVerifyReport           `json:"after"`
	Actions         []MediaRepairAction         `json:"actions"`
	RelationActions []MediaRelationRepairAction `json:"relation_actions,omitempty"`
	DerivedActions  []MediaDerivedRepairAction  `json:"derived_actions,omitempty"`
	ThumbnailGC     *MediaThumbnailGCReport     `json:"thumbnail_gc,omitempty"`
	Skipped         []MediaIntegrityIssue       `json:"skipped,omitempty"`
}

const mediaRepairBatchSize = 1000

var repairableThumbnailReasons = map[string]struct{}{
	"thumbnail_metadata_without_key":   {},
	"thumbnail_key_invalid":            {},
	"thumbnail_mime_invalid":           {},
	"thumbnail_dimensions_invalid":     {},
	"thumbnail_storage_missing":        {},
	"thumbnail_storage_unreadable":     {},
	"thumbnail_storage_not_regular":    {},
	"thumbnail_storage_empty":          {},
	"thumbnail_storage_format_invalid": {},
}

var repairableMediaRelationReasons = map[string]struct{}{
	"group_empty":                            {},
	"group_evidence_missing":                 {},
	"group_kind_invalid":                     {},
	"group_item_node_deleted":                {},
	"group_item_node_missing":                {},
	"group_item_node_type_mismatch":          {},
	"group_item_ordinal_invalid":             {},
	"group_item_owner_mismatch":              {},
	"group_item_role_missing":                {},
	"local_relation_projection_stale":        {},
	"live_photo_asset_identifier_mismatch":   {},
	"live_photo_evidence_key_invalid":        {},
	"live_photo_container_count_invalid":     {},
	"live_photo_duplicate_ordinal":           {},
	"live_photo_evidence_identifier_missing": {},
	"live_photo_metadata_missing":            {},
	"live_photo_motion_count_invalid":        {},
	"live_photo_motion_kind_mismatch":        {},
	"live_photo_role_invalid":                {},
	"live_photo_still_count_invalid":         {},
	"live_photo_still_kind_mismatch":         {},
}

// RepairMedia repairs only deterministic xDrive-local derived state.
//
// Thumbnail repair clears invalid thumbnail metadata so the cache can be rebuilt
// on demand. Relationship repair re-runs the connector-neutral local-evidence
// MediaGroup projection and then re-projects PhotoAsset state for affected
// owners. Neither path changes original Node/File/CAS content, Source state, or
// any remote provider. User-managed PhotoMetadata fields remain owned by the
// Photo domain reconciler and are not overwritten by technical re-projection.
func RepairMedia(
	ctx context.Context,
	db *gorm.DB,
	storageRoot string,
	dryRun bool,
) (MediaRepairReport, error) {
	var report MediaRepairReport
	report.DryRun = dryRun
	if db == nil {
		return report, fmt.Errorf("media repair database is unavailable")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	before, err := VerifyMediaWithStorageRoot(db.WithContext(ctx), storageRoot)
	if err != nil {
		return report, err
	}
	report.Before = before
	report.Actions, report.RelationActions, report.Skipped = planMediaRepair(before)
	report.DerivedActions, report.Skipped, err = planMediaDerivedRepairs(
		ctx,
		db,
		report.Skipped,
	)
	if err != nil {
		return report, err
	}
	if dryRun ||
		(len(report.Actions) == 0 &&
			len(report.RelationActions) == 0 &&
			len(report.DerivedActions) == 0) {
		report.After = before
		return report, nil
	}

	if len(report.Actions) != 0 {
		nodeIDs := make([]uint64, 0, len(report.Actions))
		for _, action := range report.Actions {
			nodeIDs = append(nodeIDs, action.NodeID)
		}
		now := time.Now().UTC()
		if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			for start := 0; start < len(nodeIDs); start += mediaRepairBatchSize {
				end := start + mediaRepairBatchSize
				if end > len(nodeIDs) {
					end = len(nodeIDs)
				}
				if err := tx.Model(&meta.MediaMetadata{}).
					Where("node_id IN ?", nodeIDs[start:end]).
					Updates(map[string]any{
						"thumbnail_key":       "",
						"thumbnail_mime_type": "",
						"thumbnail_width":     0,
						"thumbnail_height":    0,
						"updated_at":          now,
					}).Error; err != nil {
					return fmt.Errorf("reset thumbnail metadata: %w", err)
				}
			}
			return nil
		}); err != nil {
			return report, err
		}
		for index := range report.Actions {
			report.Actions[index].Applied = true
		}
	}

	for index := range report.RelationActions {
		action := &report.RelationActions[index]
		if err := mediagroup.ReconcileOwnerLocalGroups(ctx, db, action.OwnerID); err != nil {
			return report, fmt.Errorf("rebuild media relations for owner %d: %w", action.OwnerID, err)
		}
		if _, err := photoasset.ReconcileOwner(ctx, db, action.OwnerID); err != nil {
			return report, fmt.Errorf("rebuild photo assets for owner %d: %w", action.OwnerID, err)
		}
		action.Applied = true
	}

	derivedOwners := make(map[uint64]struct{})
	for index := range report.DerivedActions {
		action := &report.DerivedActions[index]
		if err := applyMediaDerivedRepair(ctx, db, *action); err != nil {
			return report, fmt.Errorf(
				"%s media derived resources for node %d: %w",
				action.Mode,
				action.NodeID,
				err,
			)
		}
		action.Applied = true
		if action.OwnerID != 0 {
			derivedOwners[action.OwnerID] = struct{}{}
		}
	}
	orderedDerivedOwners := make([]uint64, 0, len(derivedOwners))
	for ownerID := range derivedOwners {
		orderedDerivedOwners = append(orderedDerivedOwners, ownerID)
	}
	sort.Slice(orderedDerivedOwners, func(i, j int) bool {
		return orderedDerivedOwners[i] < orderedDerivedOwners[j]
	})
	for _, ownerID := range orderedDerivedOwners {
		if _, err := photoasset.ReconcileOwner(ctx, db, ownerID); err != nil {
			return report, fmt.Errorf(
				"rebuild photo assets after derived-resource repair for owner %d: %w",
				ownerID,
				err,
			)
		}
	}

	after, err := VerifyMediaWithStorageRoot(db.WithContext(ctx), storageRoot)
	if err != nil {
		return report, err
	}
	report.After = after
	return report, nil
}

func planMediaRepair(
	report MediaVerifyReport,
) ([]MediaRepairAction, []MediaRelationRepairAction, []MediaIntegrityIssue) {
	type pendingThumbnail struct {
		action  MediaRepairAction
		reasons map[string]struct{}
	}
	type pendingRelation struct {
		action   MediaRelationRepairAction
		reasons  map[string]struct{}
		groupIDs map[uint64]struct{}
	}

	byNode := make(map[uint64]*pendingThumbnail)
	byOwner := make(map[uint64]*pendingRelation)
	var skipped []MediaIntegrityIssue

	for _, issue := range report.Issues {
		if _, repairable := repairableThumbnailReasons[issue.Reason]; repairable && issue.NodeID != 0 {
			pending := byNode[issue.NodeID]
			if pending == nil {
				pending = &pendingThumbnail{
					action: MediaRepairAction{
						OwnerID: issue.OwnerID, NodeID: issue.NodeID,
						StorageKey: strings.TrimSpace(issue.StorageKey),
					},
					reasons: make(map[string]struct{}),
				}
				byNode[issue.NodeID] = pending
			}
			if pending.action.OwnerID == 0 {
				pending.action.OwnerID = issue.OwnerID
			}
			if pending.action.StorageKey == "" {
				pending.action.StorageKey = strings.TrimSpace(issue.StorageKey)
			}
			pending.reasons[issue.Reason] = struct{}{}
			continue
		}

		if _, repairable := repairableMediaRelationReasons[issue.Reason]; repairable && issue.OwnerID != 0 {
			pending := byOwner[issue.OwnerID]
			if pending == nil {
				pending = &pendingRelation{
					action:   MediaRelationRepairAction{OwnerID: issue.OwnerID},
					reasons:  make(map[string]struct{}),
					groupIDs: make(map[uint64]struct{}),
				}
				byOwner[issue.OwnerID] = pending
			}
			pending.reasons[issue.Reason] = struct{}{}
			if issue.GroupID != 0 {
				pending.groupIDs[issue.GroupID] = struct{}{}
			}
			continue
		}

		skipped = append(skipped, issue)
	}

	actions := make([]MediaRepairAction, 0, len(byNode))
	for _, pending := range byNode {
		pending.action.Reasons = make([]string, 0, len(pending.reasons))
		for reason := range pending.reasons {
			pending.action.Reasons = append(pending.action.Reasons, reason)
		}
		sort.Strings(pending.action.Reasons)
		actions = append(actions, pending.action)
	}
	sort.Slice(actions, func(i, j int) bool {
		if actions[i].OwnerID != actions[j].OwnerID {
			return actions[i].OwnerID < actions[j].OwnerID
		}
		return actions[i].NodeID < actions[j].NodeID
	})

	relationActions := make([]MediaRelationRepairAction, 0, len(byOwner))
	for _, pending := range byOwner {
		pending.action.Reasons = make([]string, 0, len(pending.reasons))
		for reason := range pending.reasons {
			pending.action.Reasons = append(pending.action.Reasons, reason)
		}
		sort.Strings(pending.action.Reasons)
		pending.action.GroupIDs = make([]uint64, 0, len(pending.groupIDs))
		for groupID := range pending.groupIDs {
			pending.action.GroupIDs = append(pending.action.GroupIDs, groupID)
		}
		sort.Slice(pending.action.GroupIDs, func(i, j int) bool {
			return pending.action.GroupIDs[i] < pending.action.GroupIDs[j]
		})
		relationActions = append(relationActions, pending.action)
	}
	sort.Slice(relationActions, func(i, j int) bool {
		return relationActions[i].OwnerID < relationActions[j].OwnerID
	})

	sortMediaIntegrityIssues(skipped)
	return actions, relationActions, skipped
}
