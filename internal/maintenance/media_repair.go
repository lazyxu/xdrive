package maintenance

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

type MediaRepairAction struct {
	OwnerID    uint64   `json:"owner_id,omitempty"`
	NodeID     uint64   `json:"node_id"`
	StorageKey string   `json:"storage_key,omitempty"`
	Reasons    []string `json:"reasons"`
	Applied    bool     `json:"applied"`
}

type MediaRepairReport struct {
	DryRun  bool                  `json:"dry_run"`
	Before  MediaVerifyReport     `json:"before"`
	After   MediaVerifyReport     `json:"after"`
	Actions []MediaRepairAction   `json:"actions"`
	Skipped []MediaIntegrityIssue `json:"skipped,omitempty"`
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

// RepairMedia resets only deterministic, locally-derived thumbnail metadata.
// It never changes original files, CAS metadata, media relationships, Source
// state, or remote providers. Existing cache objects are deliberately retained:
// thumbnail keys can be shared by identical content and the next thumbnail
// request will atomically overwrite/rebuild the derived cache as needed.
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
	report.Actions, report.Skipped = planMediaRepair(before)
	if dryRun || len(report.Actions) == 0 {
		report.After = before
		return report, nil
	}

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

	after, err := VerifyMediaWithStorageRoot(db.WithContext(ctx), storageRoot)
	if err != nil {
		return report, err
	}
	report.After = after
	return report, nil
}

func planMediaRepair(
	report MediaVerifyReport,
) ([]MediaRepairAction, []MediaIntegrityIssue) {
	type pendingAction struct {
		action  MediaRepairAction
		reasons map[string]struct{}
	}
	byNode := make(map[uint64]*pendingAction)
	var skipped []MediaIntegrityIssue
	for _, issue := range report.Issues {
		if _, repairable := repairableThumbnailReasons[issue.Reason]; !repairable || issue.NodeID == 0 {
			skipped = append(skipped, issue)
			continue
		}
		pending := byNode[issue.NodeID]
		if pending == nil {
			pending = &pendingAction{
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
	sortMediaIntegrityIssues(skipped)
	return actions, skipped
}
