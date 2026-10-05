package maintenance

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type SourceRunRepairAction struct {
	SourceID     uint64    `json:"source_id"`
	RunID        string    `json:"run_id"`
	HeartbeatAt  time.Time `json:"heartbeat_at"`
	TargetStatus string    `json:"target_status"`
	Applied      bool      `json:"applied"`
}

func planSourceRunRepairs(
	ctx context.Context,
	db *gorm.DB,
	issues []SourceBindingIssue,
) ([]SourceRunRepairAction, []SourceBindingIssue, error) {
	type key struct {
		sourceID uint64
		runID    string
	}
	candidates := make(map[key]struct{})
	skipped := make([]SourceBindingIssue, 0, len(issues))
	for _, issue := range issues {
		if issue.Reason != "stale_running_run" || issue.RunID == "" {
			skipped = append(skipped, issue)
			continue
		}
		candidates[key{sourceID: issue.SourceID, runID: issue.RunID}] = struct{}{}
	}

	keys := make([]key, 0, len(candidates))
	for candidate := range candidates {
		keys = append(keys, candidate)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].sourceID != keys[j].sourceID {
			return keys[i].sourceID < keys[j].sourceID
		}
		return keys[i].runID < keys[j].runID
	})

	actions := make([]SourceRunRepairAction, 0, len(keys))
	for _, candidate := range keys {
		var run meta.SyncRun
		err := db.WithContext(ctx).
			Where("id = ? AND source_id = ?", candidate.runID, candidate.sourceID).
			First(&run).Error
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			for _, issue := range issues {
				if issue.RunID == candidate.runID &&
					issue.SourceID == candidate.sourceID &&
					issue.Reason == "stale_running_run" {
					skipped = append(skipped, issue)
				}
			}
			continue
		case err != nil:
			return nil, nil, fmt.Errorf("load stale source run %q: %w", candidate.runID, err)
		}
		now := time.Now().UTC()
		if !sourcepkg.SyncRunStale(run, now) {
			for _, issue := range issues {
				if issue.RunID == candidate.runID &&
					issue.SourceID == candidate.sourceID &&
					issue.Reason == "stale_running_run" {
					skipped = append(skipped, issue)
				}
			}
			continue
		}
		status := meta.SyncRunStatusFailed
		if run.CancelRequestedAt != nil {
			status = meta.SyncRunStatusCancelled
		}
		actions = append(actions, SourceRunRepairAction{
			SourceID:     candidate.sourceID,
			RunID:        candidate.runID,
			HeartbeatAt:  sourcepkg.SyncRunHeartbeatAt(run),
			TargetStatus: status,
		})
	}
	sortSourceBindingIssues(skipped)
	return actions, skipped, nil
}

func applySourceRunRepair(
	ctx context.Context,
	db *gorm.DB,
	action SourceRunRepairAction,
) error {
	if db == nil {
		return fmt.Errorf("source run repair database is unavailable")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	now := time.Now().UTC()
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var run meta.SyncRun
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND source_id = ?", action.RunID, action.SourceID).
			First(&run).Error; err != nil {
			return fmt.Errorf("lock source run %q: %w", action.RunID, err)
		}
		if !sourcepkg.SyncRunStale(run, now) {
			return fmt.Errorf("source run %q is no longer stale", action.RunID)
		}
		status := meta.SyncRunStatusFailed
		errorText := "stale source run repaired"
		if run.CancelRequestedAt != nil {
			status = meta.SyncRunStatusCancelled
			errorText = "stale cancelled source run repaired"
		}
		if status != action.TargetStatus {
			return fmt.Errorf("source run %q cancellation state changed during repair", action.RunID)
		}
		finished := now
		return tx.Model(&meta.SyncRun{}).
			Where("id = ? AND source_id = ?", run.ID, run.SourceID).
			Updates(map[string]any{
				"status":                status,
				"error":                 errorText,
				"active_transfer_path":  "",
				"active_transfer_bytes": 0,
				"active_transfer_total": 0,
				"finished_at":           &finished,
				"updated_at":            now,
			}).Error
	})
}
