package maintenance

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type SourceRepairAction struct {
	SourceID       uint64   `json:"source_id"`
	SourceItemID   uint64   `json:"source_item_id"`
	ExternalID     string   `json:"external_id,omitempty"`
	PreviousNodeID uint64   `json:"previous_node_id,omitempty"`
	Reasons        []string `json:"reasons"`
	Applied        bool     `json:"applied"`
}

type SourceRepairReport struct {
	DryRun  bool                 `json:"dry_run"`
	Before  SourceVerifyReport   `json:"before"`
	After   SourceVerifyReport   `json:"after"`
	Actions []SourceRepairAction `json:"actions"`
	Skipped []SourceBindingIssue `json:"skipped,omitempty"`
}

var repairableSourceBindingReasons = map[string]struct{}{
	"synced_without_node": {},
	"bound_node_missing":  {},
	"node_owner_mismatch": {},
	"node_deleted":        {},
	"node_type_mismatch":  {},
}

// RepairSources detaches only bindings that are provably invalid from local
// Source/Node state. It never guesses a replacement Node from path, size,
// timestamps, hashes, or provider semantics. The stable SourceItem ExternalID
// is preserved so the next complete scan can create/rebind the item normally.
//
// File/CAS corruption, target-directory problems, identity conflicts, and
// collection/metadata issues remain read-only verifier findings until they have
// a separately proven repair contract.
func RepairSources(
	ctx context.Context,
	db *gorm.DB,
	dryRun bool,
) (SourceRepairReport, error) {
	var report SourceRepairReport
	report.DryRun = dryRun
	if db == nil {
		return report, fmt.Errorf("source repair database is unavailable")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	before, err := VerifySources(db.WithContext(ctx))
	if err != nil {
		return report, err
	}
	report.Before = before
	report.Actions, report.Skipped = planSourceRepair(before)
	if dryRun || len(report.Actions) == 0 {
		report.After = before
		return report, nil
	}

	now := time.Now().UTC()
	if err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for index := range report.Actions {
			action := &report.Actions[index]
			var item meta.SourceItem
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("id = ? AND source_id = ?", action.SourceItemID, action.SourceID).
				First(&item).Error; err != nil {
				return fmt.Errorf("load source item %d for repair: %w", action.SourceItemID, err)
			}
			if strings.TrimSpace(item.ExternalID) != strings.TrimSpace(action.ExternalID) {
				return fmt.Errorf("source item %d identity changed during repair", action.SourceItemID)
			}
			if action.PreviousNodeID == 0 {
				if item.NodeID != nil {
					return fmt.Errorf("source item %d binding changed during repair", action.SourceItemID)
				}
			} else if item.NodeID == nil || *item.NodeID != action.PreviousNodeID {
				return fmt.Errorf("source item %d binding changed during repair", action.SourceItemID)
			}

			state := item.State
			switch state {
			case meta.SourceItemStateSynced, meta.SourceItemStatePending, meta.SourceItemStateError:
				state = meta.SourceItemStatePending
			}
			if err := tx.Model(&meta.SourceItem{}).
				Where("id = ? AND source_id = ?", item.ID, item.SourceID).
				Updates(map[string]any{
					"node_id":       nil,
					"node_revision": 0,
					"state":         state,
					"last_error":    "",
					"updated_at":    now,
				}).Error; err != nil {
				return fmt.Errorf("detach invalid source binding %d: %w", item.ID, err)
			}
			action.Applied = true
		}
		return nil
	}); err != nil {
		return report, err
	}

	after, err := VerifySources(db.WithContext(ctx))
	if err != nil {
		return report, err
	}
	report.After = after
	return report, nil
}

func planSourceRepair(
	report SourceVerifyReport,
) ([]SourceRepairAction, []SourceBindingIssue) {
	type pendingAction struct {
		action  SourceRepairAction
		reasons map[string]struct{}
	}
	byItem := make(map[uint64]*pendingAction)
	skipped := make([]SourceBindingIssue, 0)

	for _, issue := range report.Issues {
		_, repairable := repairableSourceBindingReasons[issue.Reason]
		if !repairable || issue.SourceItemID == 0 {
			skipped = append(skipped, issue)
			continue
		}
		pending := byItem[issue.SourceItemID]
		if pending == nil {
			pending = &pendingAction{
				action: SourceRepairAction{
					SourceID:       issue.SourceID,
					SourceItemID:   issue.SourceItemID,
					ExternalID:     issue.ExternalID,
					PreviousNodeID: issue.NodeID,
				},
				reasons: make(map[string]struct{}),
			}
			byItem[issue.SourceItemID] = pending
		}
		if pending.action.SourceID == 0 {
			pending.action.SourceID = issue.SourceID
		}
		if pending.action.ExternalID == "" {
			pending.action.ExternalID = issue.ExternalID
		}
		if pending.action.PreviousNodeID == 0 {
			pending.action.PreviousNodeID = issue.NodeID
		}
		pending.reasons[issue.Reason] = struct{}{}
	}

	actions := make([]SourceRepairAction, 0, len(byItem))
	for _, pending := range byItem {
		pending.action.Reasons = make([]string, 0, len(pending.reasons))
		for reason := range pending.reasons {
			pending.action.Reasons = append(pending.action.Reasons, reason)
		}
		sort.Strings(pending.action.Reasons)
		actions = append(actions, pending.action)
	}
	sort.Slice(actions, func(i, j int) bool {
		if actions[i].SourceID != actions[j].SourceID {
			return actions[i].SourceID < actions[j].SourceID
		}
		return actions[i].SourceItemID < actions[j].SourceItemID
	})
	sortSourceBindingIssues(skipped)
	return actions, skipped
}
